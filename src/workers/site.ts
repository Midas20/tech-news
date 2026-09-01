// The reader, as a Cloudflare Worker.
//
// ONE HANDLER, TWO RUNTIMES. `src/ui/server.ts` already exports `handle(req,
// res)` and routes forty-eight paths through it. Reimplementing those here
// would mean two route tables that agree on the day they are written and drift
// forever after -- and the one that drifts unnoticed would be the one on the
// public internet. So this file is an ADAPTER and nothing else: it turns a
// `Request` into the two objects the existing handler expects, and turns what
// the handler writes back into a `Response`.
//
// The surface that needs shimming is genuinely small. The handler uses
// `res.writeHead` and `res.end`, and reads `req.method`, `req.headers`,
// `req.url` and `req.socket` -- nothing streaming, nothing else.
//
// ---------------------------------------------------------------------------
// THE TWO GUARDS, AND WHY THEY ARE FORCED ON RATHER THAN INHERITED
//
// Both of the protections added when this was bound to a public address are
// derived from `HOST`, which does not exist in a Worker. Left to default they
// would BOTH silently disarm at exactly the moment they matter most:
//
//   PUBLIC   comes from `HOST !== '127.0.0.1'`. Unset, PUBLIC is false, and
//            /admin -- which runs on the database owner connection and bypasses
//            row-level security by design -- would be served to the open
//            internet with no token at all.
//
//   isLoopback  reads `req.socket.remoteAddress`. There is no socket here, so
//            it is undefined, and undefined is correctly NOT loopback: every
//            write route is refused. That is the behaviour we want, and it is
//            worth stating that it is load-bearing rather than incidental.
//
// `HOST` is therefore set as a var in wrangler.site.toml. A deploy that forgets
// it is a data breach, so there is also a startup assertion below.

import { neonConfig } from '@neondatabase/serverless';
import { handle } from '../ui/server.ts';

// NEON NEEDS TO BE TOLD WHAT A WEBSOCKET IS.
//
// src/ui/db.ts calls `pool.connect()` and then `client.query()`, which is a
// real session and therefore a real WebSocket. Node has no global WebSocket so
// the driver is configured explicitly wherever it is used; in a Worker the
// global exists, but the driver still has to be handed it. Without this line
// every page that touches the database fails at connect() -- and /healthz,
// which touches nothing, would keep answering 200 and make it look fine.
//
// neonConfig is a module-level singleton, so setting it here configures the
// pools that db.ts creates later.
if (typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket;

// AND THEN DO NOT USE IT, FOR ORDINARY QUERIES.
//
// Single statements go over HTTP instead of the socket. A Worker isolate is
// reused between requests but its sockets are not guaranteed to survive, and a
// pool cached in a module global hands out a dead one on the fourth request --
// measured, on /stacks: 200, 200, 200, 500, 500, 500. A stateless request has
// nothing to go stale. The WebSocket constructor above stays configured for
// anything that genuinely needs a session.
neonConfig.poolQueryViaFetch = true;

export interface Env {
  DATABASE_URL?: string;
  DATABASE_APP_URL?: string;
  ADMIN_TOKEN?: string;
  HOST?: string;
  [key: string]: string | undefined;
}

/** What `res.writeHead`/`res.end` wrote, collected instead of streamed. */
interface Captured {
  status: number;
  headers: Record<string, string>;
  body: BodyInit | null;
}

function shimResponse(done: (c: Captured) => void) {
  const captured: Captured = { status: 200, headers: {}, body: null };
  let finished = false;
  return {
    writeHead(status: number, headers?: Record<string, string | number>) {
      // GUARDED, and this is not symmetry for its own sake.
      //
      // Without it: the handler renders a page, calls writeHead(200) and
      // end(html), and the promise below resolves with THIS object. If
      // anything then rejects late -- a pool teardown, a stray await -- the
      // catch calls writeHead(500) and mutates the very object the Response is
      // about to be built from. What ships is a perfectly rendered page with a
      // 500 on it. /sources/intel and /reports did exactly that on the first
      // deploy, and the body looked so correct that the status read like a
      // database error.
      if (finished) return this;
      captured.status = status;
      for (const [k, v] of Object.entries(headers ?? {})) captured.headers[k] = String(v);
      return this;
    },
    end(body?: string | Uint8Array) {
      if (finished) return this;
      finished = true;
      captured.body = body === undefined ? null : (body as BodyInit);
      // A snapshot, so nothing that happens afterwards can reach it.
      done({ status: captured.status, headers: { ...captured.headers }, body: captured.body });
      return this;
    },
    setHeader(k: string, v: string | number) {
      if (finished) return this;
      captured.headers[k] = String(v);
      return this;
    },
    get finished() { return finished; },
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // The guard that must not be inherited. Stated here as well as in config,
    // because a var can be dropped by an edit to a toml file and nothing else
    // in this system would notice.
    if (!env.HOST || env.HOST === '127.0.0.1' || env.HOST === 'localhost') {
      return new Response(
        'Refusing to serve: HOST is not set to a public value, so the admin guard '
        + 'would treat this Worker as a loopback bind and serve the database owner '
        + 'connection without a token. Set HOST in wrangler.site.toml.',
        { status: 500, headers: { 'content-type': 'text/plain' } });
    }

    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => { headers[k] = v; });

    // COMPRESSION IS THE EDGE'S JOB HERE, NOT THE APPLICATION'S.
    //
    // server.ts negotiates on accept-encoding and returns a gzipped or brotli
    // body with the matching Content-Encoding -- exactly right when it owns the
    // socket. Handed to `new Response()` with that header still set, workerd
    // encodes it a SECOND time, and what arrives is a gzip stream wrapped in a
    // gzip stream. `curl --compressed` peels one layer off and finds binary
    // underneath, which is how this was caught before it shipped.
    //
    // Dropping the header the negotiation reads is the smallest correct fix:
    // the handler produces identity, and Cloudflare compresses on the way out
    // as it does for every other Worker response.
    delete headers['accept-encoding'];

    // The handler rebuilds a URL as `http://<host>`, so it cannot see that this
    // request arrived over TLS -- and the session cookie's `Secure` flag is
    // decided from exactly that. Stated here, from the real request, because
    // the Worker genuinely is https and nothing else can tell it so.
    headers['x-forwarded-proto'] = url.protocol === 'https:' ? 'https' : 'http';

    const body = request.method === 'GET' || request.method === 'HEAD'
      ? '' : await request.text();

    const req = {
      method: request.method,
      // The handler parses this against a dummy base, so a path+query is what
      // it wants rather than an absolute URL.
      url: url.pathname + url.search,
      headers,
      // No socket, so no loopback, so no writes. See the note above.
      socket: { remoteAddress: undefined as string | undefined },
      // readBody() async-iterates the request. Unreachable for now -- every
      // mutating route is refused before it -- but a shim that lies about its
      // shape is a trap for whoever adds the next route.
      async *[Symbol.asyncIterator]() { if (body) yield new TextEncoder().encode(body); },
      on() { return this; },
    };

    const captured = await new Promise<Captured>((resolve) => {
      const res = shimResponse(resolve);
      void Promise.resolve(
        handle(req as never, res as never),
      ).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        // A rejection AFTER the response was captured cannot change it, and
        // must not be swallowed either -- it is the only trace of a fault that
        // the page itself hides. `wrangler tail` is where it surfaces.
        if (res.finished) {
          console.error(`late error after response was sent: ${message}`);
          return;
        }
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(`error: ${message}`);
      });
    });

    return new Response(captured.body, {
      status: captured.status,
      headers: captured.headers,
    });
  },
};
