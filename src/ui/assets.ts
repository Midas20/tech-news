// The stylesheet and the script, as files instead of as page weight.
//
// WHAT THIS FIXES
//
// Every page inlined the whole design system and every behaviour: measured on
// the overview page, 58,843 bytes of CSS and 25,199 of JavaScript, in the HTML,
// on every single navigation. It cost nothing locally, which is exactly why it
// survived -- on a loopback socket 84KB is a rounding error, and on a deployed
// site it is the difference between a page that appears and a page that arrives.
//
// The same bytes served as two files with content-hashed names are fetched once
// and then never again: the URL contains a hash of the content, so the response
// can say `immutable` truthfully, and the browser stops asking. Change the CSS
// and the URL changes with it, so there is no cache to bust and no version query
// string to remember to bump.
//
// ONE SCRIPT, NOT NINE
//
// The nine behaviours were nine separate <script> blocks. Each is already an
// IIFE -- they have to be, since classic scripts share one global scope -- so
// concatenating them in the same order is exactly equivalent, and it is one
// request rather than nine.
//
// Compression happens once, here, at startup. These files never change while the
// process lives, so compressing them per request would be work repeated a
// thousand times for an identical answer.

import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import {
  CSS, KEYS_JS, READ_JS, SUGGEST_JS, FACET_JS, REGISTRY_JS, FAV_JS, LIVE_JS,
  COMBO_JS, TRACK_JS,
} from './theme.ts';

export interface Asset {
  /** `/_/app.1a2b3c4d.css` -- the hash is of the content, so it is safe forever. */
  url: string;
  type: string;
  raw: Buffer;
  gzip: Buffer;
  brotli: Buffer;
}

/**
 * Script order is load-bearing and is the order they appeared in the page.
 *
 * KEYS first because the keyboard layer reads what the others render; LIVE last
 * because it starts a poll and should not do so until everything it might
 * refresh exists.
 */
const SCRIPTS = [KEYS_JS, READ_JS, SUGGEST_JS, FACET_JS, REGISTRY_JS, TRACK_JS,
  FAV_JS, LIVE_JS, COMBO_JS];

function build(name: string, ext: string, type: string, body: string): Asset {
  const raw = Buffer.from(body, 'utf8');
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 10);
  return {
    url: `/_/${name}.${hash}.${ext}`,
    type,
    raw,
    // Level 9 for both: this runs once at startup for two files, so the usual
    // reason to prefer a cheaper level -- per-request cost -- does not exist.
    gzip: gzipSync(raw, { level: 9 }),
    brotli: brotliCompressSync(raw, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
    }),
  };
}

export const STYLESHEET = build('app', 'css', 'text/css; charset=utf-8', CSS);
export const SCRIPT = build('app', 'js', 'text/javascript; charset=utf-8', SCRIPTS.join('\n'));

const BY_URL = new Map<string, Asset>([
  [STYLESHEET.url, STYLESHEET],
  [SCRIPT.url, SCRIPT],
]);

export function findAsset(pathname: string): Asset | undefined {
  return BY_URL.get(pathname);
}

/** Whether a path is one of ours, hash or not -- so a stale URL 404s cleanly. */
export function isAssetPath(pathname: string): boolean {
  return pathname.startsWith('/_/');
}

/**
 * Which encoding to send, given what the client said it takes.
 *
 * Brotli first: on this CSS it is meaningfully smaller than gzip and every
 * browser that supports HTTP/2 supports it. Identity is always available,
 * because a client that asks for nothing must still get an answer.
 */
export function negotiate(acceptEncoding: string | undefined): 'br' | 'gzip' | null {
  const accept = (acceptEncoding ?? '').toLowerCase();
  if (accept.includes('br')) return 'br';
  if (accept.includes('gzip')) return 'gzip';
  return null;
}

export function bodyFor(asset: Asset, encoding: 'br' | 'gzip' | null): Buffer {
  if (encoding === 'br') return asset.brotli;
  if (encoding === 'gzip') return asset.gzip;
  return asset.raw;
}

/** What the page head should point at. */
export const ASSET_URLS = { css: STYLESHEET.url, js: SCRIPT.url };

/** For the startup line, so the saving is visible rather than asserted. */
export function assetSummary(): string {
  const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`;
  return `assets: ${kb(STYLESHEET.raw.length)} css + ${kb(SCRIPT.raw.length)} js `
    + `-> ${kb(STYLESHEET.brotli.length + SCRIPT.brotli.length)} brotli, cached forever`;
}
