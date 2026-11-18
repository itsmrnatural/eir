# syntax=docker/dockerfile:1
#
# BUILD CONTEXT MUST BE THE REPOSITORY ROOT (the server imports ../../db and ../../fhir):
#   docker build -f server/Dockerfile -t hc-server .
# docker-compose.yml:  build: { context: ., dockerfile: server/Dockerfile }
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# 1) server dependencies (cached layer). Run `npm install` once in server/ and commit
#    package-lock.json to get reproducible `npm ci` builds; without it, `npm install` is used.
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# 2) sibling packages; install their deps only if they have a package.json
COPY db/ ./db/
COPY fhir/ ./fhir/
RUN for d in db fhir; do \
      if [ -f "$d/package.json" ]; then \
        (cd "$d" && if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi); \
      fi; \
    done

# 3) server source
COPY server/src ./server/src

WORKDIR /app/server
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-4000}/healthz" >/dev/null || exit 1
CMD ["node", "src/index.js"]
