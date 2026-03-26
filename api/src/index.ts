import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { html } from '@elysiajs/html';
import { rateLimit } from './middleware/rateLimit';
import { ratesRoutes } from './routes/rates';
import { blogRoutes } from './routes/blog';
import { sitemapRoutes } from './routes/sitemap';
import { db, schema } from './db';
import { desc, sql, eq } from 'drizzle-orm';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { generateOgChart } from './utils/ogChart';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const SITE_URL = 'https://yieldwatch.io';
const POSTS_PER_PAGE = 5;

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
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://cdn.jsdelivr.net https://static.cloudflareinsights.com",
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const app = new Elysia()
  .use(cors({
    origin: allowedOrigins,
    methods: ['GET'],
    headers: ['Content-Type'],
    credentials: allowedOrigins === true || Array.isArray(allowedOrigins),
  }))
  .use(html())
  .use(rateLimit())
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
  .get('/blog', async ({ query }) => {
    try {
      const page = Math.max(1, parseInt(query.page as string) || 1);

      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.dailySummaries);
      const totalCount = Number(countResult[0]?.count) || 0;
      const totalPages = Math.ceil(totalCount / POSTS_PER_PAGE);

      const seoMetaTags: string[] = [];

      if (totalPages > 1) {
        if (page > 1) {
          seoMetaTags.push(`<link rel="prev" href="${SITE_URL}/blog?page=${page - 1}">`);
        }
        if (page < totalPages) {
          seoMetaTags.push(`<link rel="next" href="${SITE_URL}/blog?page=${page + 1}">`);
        }
      }

      const blogPath = join(process.cwd(), 'public/blog.html');
      let html = readFileSync(blogPath, 'utf-8');

      if (seoMetaTags.length > 0) {
        const metaTagsHtml = '\n    ' + seoMetaTags.join('\n    ');
        html = html.replace('</head>', `${metaTagsHtml}\n  </head>`);
      }

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    } catch {
      return new Response('<html><body><h1>Blog</h1><p>Blog not found.</p></body></html>', {
        headers: { 'Content-Type': 'text/html' },
      });
    }
  })
  .get('/blog/:date', async ({ params }) => {
    try {
      const { date } = params;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return new Response('<html><body><h1>Invalid Date</h1><p>Please use a valid date format (YYYY-MM-DD).</p></body></html>', {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      const blogData = await db
        .select()
        .from(schema.dailySummaries)
        .where(eq(schema.dailySummaries.date, date))
        .limit(1);

      if (blogData.length === 0) {
        return new Response('<html><body><h1>Post Not Found</h1><p>No blog post found for this date.</p></body></html>', {
          headers: { 'Content-Type': 'text/html' },
          status: 404,
        });
      }

      const blogSummary = blogData[0].blogSummary || blogData[0].summary;
      const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const blogUrl = `${SITE_URL}/blog/${date}`;
      const ogImageUrl = `${SITE_URL}/og-image/${date}`;
      const pageTitle = `${dateFormatted} | Treasury Yield Daily`;
      const metaDescription = escapeHtml(blogSummary.substring(0, 160));

      const blogPath = join(process.cwd(), 'public/blog-post.html');
      let html = readFileSync(blogPath, 'utf-8');

      html = html.replace(/<title[^>]*>.*<\/title>/, `<title id="page-title">${escapeHtml(pageTitle)}</title>`);
      html = html.replace(`content="Treasury yield curve daily analysis" id="meta-desc"`, `content="${metaDescription}" id="meta-desc"`);
      html = html.replace(`id="og-url" content="https://yieldwatch.io/blog"`, `id="og-url" content="${blogUrl}"`);
      html = html.replace(`id="og-title" content="Treasury Yield Daily Summary"`, `id="og-title" content="${escapeHtml(dateFormatted)} Treasury Yield"`);
      html = html.replace(`id="og-description" content="Treasury yield curve daily analysis"`, `id="og-description" content="${metaDescription}"`);
      html = html.replace(`id="og-image" content="https://yieldwatch.io/og.png"`, `id="og-image" content="${ogImageUrl}"`);
      html = html.replace(`id="article-date" content=""`, `id="article-date" content="${date}T00:00:00Z"`);
      html = html.replace(`id="article-modified" content=""`, `id="article-modified" content="${date}T00:00:00Z"`);
      html = html.replace(`id="twitter-url" content="https://yieldwatch.io/blog"`, `id="twitter-url" content="${blogUrl}"`);
      html = html.replace(`id="twitter-title" content="Treasury Yield Daily Summary"`, `id="twitter-title" content="${escapeHtml(dateFormatted)} Treasury Yield"`);
      html = html.replace(`id="twitter-description" content="Treasury yield curve daily analysis"`, `id="twitter-description" content="${metaDescription}"`);
      html = html.replace(`id="twitter-image" content="https://yieldwatch.io/og.png"`, `id="twitter-image" content="${ogImageUrl}"`);
      html = html.replace(`id="canonical-url" href="https://yieldwatch.io/blog/"`, `id="canonical-url" href="${blogUrl}"`);

      const breadcrumbSchemaMatch = html.match(/id="breadcrumb-schema">([\s\S]*?)<\/script>/);
      if (breadcrumbSchemaMatch) {
        const updatedSchema = breadcrumbSchemaMatch[1]
          .replace(/"name": "Daily Summary"/, `"name": "${dateFormatted} Summary"`)
          .replace(/item": "https:\/\/yieldwatch\.io\/blog"(?=[^"]*\}])/g, `item": "${blogUrl}"`);
        html = html.replace(breadcrumbSchemaMatch[0], `id="breadcrumb-schema">\n  ${updatedSchema}\n  </script>`);
      }

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    } catch (error) {
      console.error('Error serving blog post:', error);
      return new Response('<html><body><h1>Error</h1><p>Failed to load blog post.</p></body></html>', {
        headers: { 'Content-Type': 'text/html' },
        status: 500,
      });
    }
  })
  .use(ratesRoutes)
  .use(blogRoutes)
  .use(sitemapRoutes)
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
  .get('/faq', async () => {
    try {
      const faqPath = join(process.cwd(), 'public/faq.html');
      const html = readFileSync(faqPath, 'utf-8');
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    } catch {
      return new Response('<html><body><h1>FAQ</h1><p>Page not found.</p></body></html>', {
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
    const pngPath = join(process.cwd(), 'public/og/og.png');
    if (existsSync(pngPath)) {
      const png = readFileSync(pngPath);
      return new Response(png, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
      });
    }
    return new Response('OG image not yet generated', { status: 404 });
  })
  .get('/og-image/:date', async ({ params }) => {
    const { date } = params;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response('Invalid date format', { status: 400 });
    }

    const cachedPath = join(process.cwd(), 'public/og', `${date}.png`);
    if (existsSync(cachedPath)) {
      const png = readFileSync(cachedPath);
      return new Response(png, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
      });
    }

    const ratesData = await db
      .select()
      .from(schema.yieldCurveRates)
      .where(eq(schema.yieldCurveRates.date, date));

    if (ratesData.length === 0) {
      return new Response('No data for this date', { status: 404 });
    }

    const rates = ratesData.map(r => ({ maturity: r.maturity, rate: parseFloat(r.rate) }));

    let pngBuffer: Buffer;
    try {
      pngBuffer = await generateOgChart(rates);
    } catch (error) {
      console.error('Error generating OG chart:', error);
      return new Response('Failed to generate image', { status: 500 });
    }

    const ogDir = join(process.cwd(), 'public/og');
    if (!existsSync(ogDir)) {
      mkdirSync(ogDir, { recursive: true });
    }

    writeFileSync(cachedPath, pngBuffer);

    return new Response(pngBuffer, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
    });
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
