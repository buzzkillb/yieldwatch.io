import fs from 'fs';
import path from 'path';

const root = 'dist';
const files = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) files.push(p);
  }
}
walk(root);

const rows = [];
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const rel = '/' + path.relative(root, f).replace(/index\.html$/, '').replace(/\.html$/, '');
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
  const desc = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [, ''])[1];
  const canon = (html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i) || [, ''])[1];
  const robots = (html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i) || [, ''])[1];
  const h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].length;
  const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].length;
  const h3 = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].length;
  const schemas = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map(m => {
    try { return JSON.parse(m[1]); } catch { return null; }
  }).filter(Boolean);
  const types = [];
  for (const s of schemas) {
    if (s['@graph']) for (const g of s['@graph']) types.push(g['@type']);
    if (s['@type']) types.push(Array.isArray(s['@type']) ? s['@type'].join('+') : s['@type']);
  }
  const mainM = html.match(/<main[\s\S]*?<\/main>/i);
  let text = mainM ? mainM[0] : html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const words = text.split(' ').filter(Boolean).length;
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)];
  const imgsNoAlt = imgs.filter(m => !/\balt=/.test(m[0])).length;
  const internalLinks = [...html.matchAll(/<a\b[^>]*href="(\/[^"]*)"/gi)].length;
  const externalLinks = [...html.matchAll(/<a\b[^>]*href="(https?:[^"]*)"/gi)].length;
  const ogImage = (html.match(/property="og:image"\s+content="([^"]*)"/i) || [, ''])[1];
  const published = (html.match(/"datePublished"\s*:\s*"([^"]*)"/i) || [, ''])[1];
  const modified = (html.match(/"dateModified"\s*:\s*"([^"]*)"/i) || [, ''])[1];
  const hasFAQ = types.includes('FAQPage');
  rows.push({ rel, title, titleLen: title.length, descLen: desc.length, h1, h2, h3, words, types: [...new Set(types)].join(','), hasFAQ, imgs: imgs.length, imgsNoAlt, internalLinks, externalLinks, ogImage, published, modified, canon, robots });
}

const bad = rows.filter(r => r.titleLen > 60 || r.descLen > 160 || r.h1 !== 1 || !r.canon || !r.ogImage || r.words < 200 || r.imgsNoAlt > 0);
console.log('PAGES', rows.length);
console.log('ISSUES', bad.length);
for (const r of bad.slice(0, 40)) console.log(JSON.stringify(r));

const summary = {
  avgWords: Math.round(rows.reduce((a, r) => a + r.words, 0) / rows.length),
  minWords: Math.min(...rows.map(r => r.words)),
  maxWords: Math.max(...rows.map(r => r.words)),
  avgTitle: (rows.reduce((a, r) => a + r.titleLen, 0) / rows.length).toFixed(1),
  avgDesc: (rows.reduce((a, r) => a + r.descLen, 0) / rows.length).toFixed(1),
  overTitle: rows.filter(r => r.titleLen > 60).length,
  overDesc: rows.filter(r => r.descLen > 160).length,
  missingCanon: rows.filter(r => !r.canon).length,
  faqPages: rows.filter(r => r.hasFAQ).length,
  noAltImages: rows.filter(r => r.imgsNoAlt > 0).length,
  thin: rows.filter(r => r.words < 300).length,
  types: [...new Set(rows.flatMap(r => r.types.split(',')).filter(Boolean))].sort(),
  sample: rows.slice(0, 6).map(r => ({ rel: r.rel, title: r.title, words: r.words, types: r.types, h1: r.h1, h2: r.h2, internalLinks: r.internalLinks })),
};
console.log(JSON.stringify(summary, null, 2));
