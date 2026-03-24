FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS runner
COPY package.json ./
COPY drizzle.config.ts ./
COPY public ./public
COPY src ./src
COPY dist ./dist
COPY node_modules ./node_modules

RUN groupadd -f -g 1001 appgroup && useradd -o -u 1001 -g appgroup -s /bin/false -m appuser 2>/dev/null || true
USER appuser

EXPOSE 3000

CMD ["bun", "run", "dist/index.js"]
