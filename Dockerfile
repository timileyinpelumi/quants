# One image for web, indexer, keeper and migrate; compose picks the command.
ARG BUN_IMAGE=oven/bun:1.3.14-slim
ARG NODE_IMAGE=node:22.21.1-bookworm-slim

FROM ${NODE_IMAGE} AS node

FROM ${BUN_IMAGE} AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM ${BUN_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM ${BUN_IMAGE} AS build
# next build runs under Node because Bun crashes when Next's build workers exit
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_X_URL
ENV NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_X_URL=$NEXT_PUBLIC_X_URL \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=3072
RUN bun run build && rm -rf .next/cache

FROM ${BUN_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --chown=bun:bun package.json tsconfig.json next.config.ts ./
COPY --from=prod-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun db ./db
COPY --chown=bun:bun src ./src
COPY --chown=bun:bun scripts ./scripts
COPY --chown=bun:bun public ./public
COPY --chown=bun:bun assets ./assets
COPY --from=build --chown=bun:bun /app/.next ./.next
USER bun
EXPOSE 3000
CMD ["bun", "--bun", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
