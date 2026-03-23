import type { Config } from 'drizzle-kit';

const user = process.env.POSTGRES_USER;
const password = process.env.POSTGRES_PASSWORD;

if (!user || !password) {
  throw new Error('POSTGRES_USER and POSTGRES_PASSWORD environment variables must be set');
}

export default {
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: `postgres://${user}:${encodeURIComponent(password)}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'treasury'}`,
  },
} satisfies Config;
