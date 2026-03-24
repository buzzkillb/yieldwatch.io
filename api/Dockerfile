FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN BUN_INSTALL_CACHE_DIR=/tmp/bun-cache bun install

FROM base AS builder
COPY --from=deps /app/node_modules /app/node_modules
COPY . .
RUN bun run build

FROM base AS runner
WORKDIR /app
COPY --from=builder /app/src ./src
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/public ./public

RUN groupadd -f -g 1001 appgroup && useradd -o -u 1001 -g appgroup -s /bin/false -m appuser 2>/dev/null || true
USER appuser

EXPOSE 3000

CMD ["bun", "run", "dist/index.js"]
