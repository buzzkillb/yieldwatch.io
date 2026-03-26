import { Elysia } from 'elysia';
import { db, schema } from '../db';
import { desc } from 'drizzle-orm';

const SITE_URL = 'https://yieldwatch.io';

interface SitemapUrl {
  loc: string;
  lastmod: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: '0.0' | '0.1' | '0.2' | '0.3' | '0.4' | '0.5' | '0.6' | '0.7' | '0.8' | '0.9' | '1.0';
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateSitemap(urls: SitemapUrl[]): string {
  const urlEntries = urls.map(url => {
    return `  <url>
    <loc>${escapeXml(url.loc)}</loc>
    <lastmod>${escapeXml(url.lastmod)}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urlEntries}
</urlset>`;
}

export const sitemapRoutes = new Elysia({ prefix: '' })
  .get('/sitemap.xml', async ({ set }) => {
    try {
      const summaries = await db
        .select({
          date: schema.dailySummaries.date,
          createdAt: schema.dailySummaries.createdAt,
        })
        .from(schema.dailySummaries)
        .orderBy(desc(schema.dailySummaries.date));

      const today = new Date().toISOString().split('T')[0];

      const staticUrls: SitemapUrl[] = [
        {
          loc: `${SITE_URL}/`,
          lastmod: today,
          changefreq: 'daily',
          priority: '1.0',
        },
        {
          loc: `${SITE_URL}/blog`,
          lastmod: today,
          changefreq: 'daily',
          priority: '0.9',
        },
        {
          loc: `${SITE_URL}/faq`,
          lastmod: today,
          changefreq: 'weekly',
          priority: '0.8',
        },
        {
          loc: `${SITE_URL}/api-docs`,
          lastmod: today,
          changefreq: 'weekly',
          priority: '0.7',
        },
      ];

      const blogUrls: SitemapUrl[] = summaries.map(summary => ({
        loc: `${SITE_URL}/blog/${summary.date}`,
        lastmod: summary.createdAt
          ? new Date(summary.createdAt).toISOString().split('T')[0]
          : summary.date,
        changefreq: 'weekly',
        priority: '0.8',
      }));

      const allUrls = [...staticUrls, ...blogUrls];
      const sitemapXml = generateSitemap(allUrls);

      return new Response(sitemapXml, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      });

    } catch (error) {
      console.error('Sitemap generation error:', error);

      const minimalSitemap = generateSitemap([
        {
          loc: `${SITE_URL}/`,
          lastmod: new Date().toISOString().split('T')[0],
          changefreq: 'daily',
          priority: '1.0',
        },
        {
          loc: `${SITE_URL}/blog`,
          lastmod: new Date().toISOString().split('T')[0],
          changefreq: 'daily',
          priority: '0.9',
        },
        {
          loc: `${SITE_URL}/api-docs`,
          lastmod: new Date().toISOString().split('T')[0],
          changefreq: 'weekly',
          priority: '0.7',
        },
      ]);

      return new Response(minimalSitemap, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
        },
      });
    }
  });