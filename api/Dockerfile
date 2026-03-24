FROM oven/bun:1
WORKDIR /app
COPY package.json drizzle.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
COPY dist ./dist
COPY node_modules ./node_modules
USER appuser
EXPOSE 3000
CMD ["bun", "run", "dist/index.js"]
