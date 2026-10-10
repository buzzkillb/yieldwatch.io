# yieldwatch.io — static Astro site

The whole site is pre-rendered at build time from `src/data/*.json` and
deployed to **Cloudflare Pages** — no VPS, no Postgres, no scheduler needed.
All 193+ daily summaries, the dashboard, and the API snapshot endpoints are
static files.

## Structure

- `src/data/` — the "database": `rates.json` (full yield-curve history),
  `summaries.json` (all daily summaries + rates), `stats.json`, `maturities.json`
- `src/templates/` — verbatim copies of the original page shells
  (index, blog, blog-post, faq, api-docs). Astro pages process them at build
  time the same way the old Bun server did SSR.
- `src/pages/` — one `.astro` file per route + static JSON/SVG/XML endpoints
- `scripts/export-data.mjs` — one-time export from the old API (done)
- `scripts/gen-derived.mjs` — prebuild step: static API JSON snapshots
  (`/api/rates.json`, `/api/rates/{3m,6m,1y,2y,5y,all}.json`, `/api/daily-summary`,
  per-post JSON, per-date OG SVGs) + `_redirects` + `_headers`
- `scripts/daily-update.ts` — daily job: fetch Treasury XML → parse new rows →
  generate summaries via the LLM gateway (reuses `api/src/services/summaryService.ts`
  prompt/retry code) → append to `src/data/*.json`

## Daily pipeline

GitHub Actions (`.github/workflows/daily-update.yml`) runs `daily-update.ts`
three times on business days (4:30/5:30/6:30pm ET) and commits new data; the
push triggers a Cloudflare Pages build. Requires repo secrets:

- `LLM_API_KEY` — gateway key
- `LLM_BASE_URL` — e.g. https://api.bwengr.com

## Commands

```sh
npm install            # deps
npm run dev            # local dev server
npm run build          # gen-derived + astro build → dist/
npm run preview        # serve dist/
npm run daily-update   # bun scripts/daily-update.ts (needs api deps installed)
```

## Cloudflare Pages config

- Root directory: `site`
- Build command: `npm run build`
- Output directory: `dist`
- Env var: `NODE_VERSION` = `20`

The `_headers` file carries the security headers (CSP, X-Frame-Options, …) and
content types for extensionless endpoints; `_redirects` keeps the documented
`/api/*` paths (and old `/blog?page=N` URLs) working.
