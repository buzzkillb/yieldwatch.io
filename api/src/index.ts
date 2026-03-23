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

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'",
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

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
  .onBeforeHandle(({ set }) => {
    for (const [key, value] of Object.entries(securityHeaders)) {
      set.headers[key] = value;
    }
  })
  .get('/health', () => ({
    status: 'ok',
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
  })
  .get('/api-docs', async () => {
    try {
      const docsPath = join(process.cwd(), 'public/api-docs.html');
      const html = readFileSync(docsPath, 'utf-8');
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    } catch {
      return new Response('<html><body><h1>API Documentation</h1><p>Documentation not found.</p></body></html>', {
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
