FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS runner
COPY package.json ./
COPY drizzle.config.ts ./
COPY public ./public
COPY src ./src
COPY dist ./dist
COPY node_modules ./node_modules

RUN groupadd --gid 1001 appgroup && useradd --uid 1001 --gid appgroup --shell /bin/false --create-home appuser
USER appuser

EXPOSE 3000

CMD ["bun", "run", "dist/index.js"]
