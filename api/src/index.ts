import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { html } from '@elysiajs/html';
import { rateLimit } from './middleware/rateLimit';
import { ratesRoutes } from './routes/rates';
import { readFileSync } from 'fs';
import { join } from 'path';

const isProduction = process.env.NODE_ENV === 'production';
let allowedOrigins: string[] | true;

if (process.env.ALLOWED_ORIGINS) {
  allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim());
} else if (isProduction) {
  throw new Error('ALLOWED_ORIGINS must be set in production');
} else {
  allowedOrigins = ['*'];
}

const app = new Elysia()
  .use(cors({
    origin: allowedOrigins,
    methods: ['GET'],
    headers: ['Content-Type'],
    credentials: allowedOrigins === true,
  }))
  .use(html())
  .use(rateLimit())
  .use(ratesRoutes)
  .get('/health', () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }))
  .get('/', async () => {
    try {
      const indexPath = join(process.cwd(), 'public/index.html');
      const html = readFileSync(indexPath, 'utf-8');
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    } catch {
      return new Response('<html><body><h1>Treasury Dashboard</h1><p>Frontend not found. Please build the frontend first.</p></body></html>', {
        headers: { 'Content-Type': 'text/html' },
      });
    }
  });

const port = parseInt(process.env.PORT || '3000');

app.listen(port, () => {
  console.log(`Treasury API running at http://0.0.0.0:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Rate limit: ${process.env.RATE_LIMIT_MAX || '100'} requests per ${(parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000') / 1000).toFixed(0)} seconds`);
});

export { app };
