import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const user = process.env.POSTGRES_USER;
const password = process.env.POSTGRES_PASSWORD;
const host = process.env.POSTGRES_HOST || 'localhost';
const port = process.env.POSTGRES_PORT || '5432';
const database = process.env.POSTGRES_DB || 'treasury';

if (!user || !password) {
  throw new Error('POSTGRES_USER and POSTGRES_PASSWORD environment variables must be set');
}

const connectionString = `postgres://${user}:${password}@${host}:${port}/${database}`;

const client = postgres(connectionString);
export const db = drizzle(client, { schema });

export { schema };
