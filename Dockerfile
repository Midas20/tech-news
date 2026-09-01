# NewsTrack, as one container: web server and scheduler.
#
# There is no build step, and that is deliberate rather than lazy. Node 22 runs
# TypeScript directly with --experimental-strip-types: it erases the types and
# executes the result, so what runs in production is the file that is in the
# repository. A bundler here would add a build artefact to debug through and
# would buy nothing -- this is a server, not something shipped to a browser.

FROM node:22-slim

# tini, because the default PID 1 in a container does not forward signals. Every
# deploy is a SIGTERM, and src/main.ts has a graceful shutdown that never runs if
# the signal does not arrive: the request in flight is dropped and the scheduler
# leaves a job claimed until its lease expires.
RUN apt-get update && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a code change does not reinstall them. `npm ci` rather
# than `npm install`: the lockfile is the version list, and a deploy that
# silently picks up a new minor version of a parser is a deploy that cannot be
# reproduced.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY migrations ./migrations
COPY seeds ./seeds
COPY scripts ./scripts
COPY src ./src

# Not root. Nothing here writes to disk -- the archive is in Postgres -- so the
# process needs no more than the ability to open a socket.
USER node

ENV NODE_ENV=production \
    ROLE=all \
    HOST=0.0.0.0 \
    PORT=3000
EXPOSE 3000

# Liveness only: /healthz answers without touching the database, on purpose. A
# health check that fails when Postgres blips gets the container killed during
# exactly the outage it should be riding out. Whether the DATABASE is healthy is
# a different question, and /admin/health is where it is asked.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--experimental-strip-types", "src/main.ts"]
