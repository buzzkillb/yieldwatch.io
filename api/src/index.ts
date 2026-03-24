import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { html } from '@elysiajs/html';
import { rateLimit } from './middleware/rateLimit';
import { ratesRoutes } from './routes/rates';
import { db, schema } from './db';
import { desc, asc } from 'drizzle-orm';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';

const isProduction = process.env.NODE_ENV === 'production';
let allowedOrigins: string[] | true;

if (process.env.ALLOWED_ORIGINS) {
  allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim());
} else if (isProduction) {
  throw new Error('ALLOWED_ORIGINS must be set in production');
} else {
  allowedOrigins = ['*'];
}

// NOTE: 'unsafe-inline' is required for Chart.js dynamic initialization in the dashboard.
  // Consider migrating to CSP nonces in future refactoring for improved XSS protection.
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
  })
  .get('/og', async () => {
    try {
      const latestData = await db
        .select()
        .from(schema.yieldCurveRates)
        .orderBy(desc(schema.yieldCurveRates.date), asc(schema.yieldCurveRates.maturity))
        .limit(14);

      if (latestData.length === 0) {
        return new Response(generateOgSvg('No Data', 'U.S. Treasury Yield Curve', 'No data available'), {
          headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
        });
      }

      const latestDate = latestData[0].date;
      const todayRates = latestData
        .filter(r => r.date === latestDate)
        .map(r => ({ maturity: r.maturity, rate: parseFloat(r.rate) }));

      const dateFormatted = new Date(latestDate + 'T00:00:00Z').toLocaleDateString('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      return new Response(generateOgSvg(todayRates, dateFormatted), {
        headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
      });
    } catch (error) {
      console.error('OG image error:', error);
      return new Response(generateOgSvg('Error', 'U.S. Treasury Yield Curve', 'Failed to generate image'), {
        headers: { 'Content-Type': 'image/svg+xml' },
      });
    }
  })
  .get('/og.png', async () => {
    const pngPath = join(process.cwd(), 'public/og.png');
    if (existsSync(pngPath)) {
      const png = readFileSync(pngPath);
      return new Response(png, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
      });
    }
    return new Response('OG image not yet generated', { status: 404 });
  })
  .get('/api/daily-summary', async () => {
    const latestSummary = await db
      .select()
      .from(schema.dailySummaries)
      .orderBy(desc(schema.dailySummaries.date))
      .limit(1);

    if (latestSummary.length === 0) {
      return new Response('', { status: 204 });
    }

    return new Response(latestSummary[0].summary, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
    });
  })
  

function generateOgSvg(data: { maturity: string; rate: number }[] | string, date?: string, errorMsg?: string): string {
  if (typeof data === 'string' || errorMsg) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
      <rect fill="#0a0a0f" width="1200" height="630"/>
      <text x="600" y="315" font-family="system-ui, sans-serif" font-size="32" fill="#6366f1" text-anchor="middle">No Data</text>
    </svg>`;
  }

  const maturities = ['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR'];
  const ratesMap = new Map(data.map(d => [d.maturity, d.rate]));
  const rates = maturities.map(m => ({ maturity: m, rate: ratesMap.get(m) || 0 }));
  const maxRate = Math.max(...rates.map(r => r.rate));
  const minRate = Math.min(...rates.map(r => r.rate));
  const rateRange = maxRate - minRate || 1;

  const chartX = 50;
  const chartY = 50;
  const chartW = 1100;
  const chartH = 530;
  const pointSpacing = chartW / (rates.length - 1);

  let pathD = '';
  rates.forEach((r, i) => {
    const x = chartX + i * pointSpacing;
    const y = chartY + chartH - ((r.rate - minRate + 0.5) / (rateRange + 1)) * chartH;
    pathD += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#0a0a0f"/>
        <stop offset="100%" style="stop-color:#12121a"/>
      </linearGradient>
      <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#6366f1"/>
        <stop offset="50%" style="stop-color:#818cf8"/>
        <stop offset="100%" style="stop-color:#a855f7"/>
      </linearGradient>
      <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color:#6366f1;stop-opacity:0.25"/>
        <stop offset="100%" style="stop-color:#6366f1;stop-opacity:0"/>
      </linearGradient>
    </defs>
    
    <rect fill="url(#bg)" width="1200" height="630"/>
    <path d="${pathD} ${chartX + chartW} ${chartY + chartH} L ${chartX} ${chartY + chartH} Z" fill="url(#areaGrad)"/>
    <path d="${pathD}" fill="none" stroke="url(#lineGrad)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    
    ${rates.map((r, i) => {
      const x = chartX + i * pointSpacing;
      const y = chartY + chartH - ((r.rate - minRate + 0.5) / (rateRange + 1)) * chartH;
      return `<circle cx="${x}" cy="${y}" r="8" fill="#6366f1" stroke="white" stroke-width="3"/>`;
    }).join('\n    ')}
  </svg>`;

  return svg;
}

const port = parseInt(process.env.PORT || '3000');

app.listen(port, () => {
  console.log(`Treasury API running at http://0.0.0.0:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Rate limit: ${process.env.RATE_LIMIT_MAX || '100'} requests per ${(parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000') / 1000).toFixed(0)} seconds`);
});

export { app };
