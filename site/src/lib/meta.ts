// Shared head metadata builders. Every page must emit the same social/schema
// surface so crawlers and social cards behave consistently; keeping the tags
// here prevents per-page drift (and the omissions that drift caused).
import { SITE_URL, escapeHtml, inlineJson } from './site';

export const BRAND_OG_IMAGE = `${SITE_URL}/og/og.png`;
export const BRAND_OG_ALT = 'YieldWatch U.S. Treasury yield curve dashboard';
export const OG_WIDTH = '1200';
export const OG_HEIGHT = '630';

export interface SocialMetaOptions {
  url: string;
  title: string;
  description: string;
  image?: string;
  imageAlt?: string;
  type?: 'website' | 'article';
}

// Open Graph + Twitter Card block. Values are escaped for attribute context.
export function socialMetaTags(opts: SocialMetaOptions): string {
  const image = opts.image ?? BRAND_OG_IMAGE;
  const imageAlt = opts.imageAlt ?? BRAND_OG_ALT;
  const type = opts.type ?? 'website';
  const attr = (v: string) => escapeHtml(v);
  return `  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="YieldWatch">
  <meta property="og:locale" content="en_US">
  <meta property="og:url" content="${attr(opts.url)}">
  <meta property="og:title" content="${attr(opts.title)}">
  <meta property="og:description" content="${attr(opts.description)}">
  <meta property="og:image" content="${attr(image)}">
  <meta property="og:image:width" content="${OG_WIDTH}">
  <meta property="og:image:height" content="${OG_HEIGHT}">
  <meta property="og:image:alt" content="${attr(imageAlt)}">
  <meta property="og:image:type" content="image/png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${attr(opts.url)}">
  <meta name="twitter:title" content="${attr(opts.title)}">
  <meta name="twitter:description" content="${attr(opts.description)}">
  <meta name="twitter:image" content="${attr(image)}">
  <meta name="twitter:image:alt" content="${attr(imageAlt)}">
  <meta name="twitter:image:width" content="${OG_WIDTH}">
  <meta name="twitter:image:height" content="${OG_HEIGHT}">`;
}

// Organization + WebSite graph referenced by page-level schema via @id.
// Pages that reference https://yieldwatch.io/#org or /#site must include this
// so the references resolve on the page itself, not just elsewhere on the site.
export function siteSchemaGraph(): string {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#org`,
        name: 'YieldWatch',
        url: SITE_URL,
        logo: { '@type': 'ImageObject', url: BRAND_OG_IMAGE },
        description: 'Daily U.S. Treasury par yield curve rates and plain-English summaries.',
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#site`,
        url: SITE_URL,
        name: 'YieldWatch',
        publisher: { '@id': `${SITE_URL}/#org` },
        inLanguage: 'en-US',
      },
    ],
  };
  return `<script type="application/ld+json" id="schema-org-site">${inlineJson(graph)}</script>`;
}
