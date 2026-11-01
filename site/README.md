# yieldwatch.io — static Astro site

The whole site is pre-rendered at build time from `src/data/*.json` and
deployed to **Cloudflare Workers** (static assets) — no VPS, no Postgres, no scheduler needed.
All 206+ daily summaries, the dashboard, and the API snapshot endpoints are
static files.

## Structure

- `src/data/` — the "database": `rates.json` (full yield-curve history),
  `summaries.json` (all daily summaries + rates). `stats.json` and
  `maturities.json` are no longer stored; they are derived from `rates.json`
  on every build so the public API snapshots cannot go stale.
- `src/components/BlogList.astro` — native Astro archive listing: metadata,
  schema, cards, pagination, and the year/month filter client script.
- `src/pages/blog/[date].astro` — native Astro post page: article metadata,
  breadcrumb + Article JSON-LD, chart, rates grid, and related links.
- `src/pages/index.astro` — native Astro dashboard shell; dashboard styles live
  in `src/styles/dashboard.css` and the client logic in `src/client/dashboard.js`.
  All three former raw HTML templates (`index`, `blog`, `blog-post`) and the
  `src/templates/` loader have been removed.
- `src/pages/faq.astro` and `src/pages/api-docs.astro` — native Astro pages.
  The FAQ derives its `FAQPage` JSON-LD from the same question array it renders,
  and the API examples are built from the shipped JSON so docs cannot drift.
- `src/pages/` — one `.astro` file per route + static JSON/SVG/XML endpoints
- `scripts/export-data.mjs` — one-time export from the old API (done)
- `scripts/gen-derived.mjs` — prebuild step: static API JSON snapshots
  (`/api/rates.json`, `/api/rates/{3m,6m,1y,2y,5y,all}.json`, `/api/daily-summary`,
  per-post JSON, per-date OG SVGs) + `_redirects` + `_headers`
- `scripts/daily-update.ts` — daily job: fetch Treasury XML → parse new rows →
  generate summaries via the LLM gateway (reuses `api/src/services/summaryService.ts`
  prompt/retry code) → append to `src/data/*.json`. Official rates are written
  before LLM work, so a gateway outage cannot lose a trading day; the next run
  backfills summaries that are missing inside the published-summary window.
- `scripts/validate-data.mjs` — integrity gate for rate/summary JSON (ordering,
  duplicates, required tenors, plausible values). Run before any commit.

## Daily pipeline

GitHub Actions (`.github/workflows/daily-update.yml`) runs `daily-update.ts`
three times on business days. The UTC cron times (19:45/20:45/21:45) straddle
daylight saving so one attempt lands shortly after the Treasury's ~3:30pm ET
release in both EDT and EST; the job exits early when no new data exists. It
commits new data and the push triggers a Cloudflare Workers Build. Requires
repo secrets:

- `LLM_API_KEY` — gateway key
- `LLM_BASE_URL` — e.g. https://api.bwengr.com

## Commands

```sh
npm install            # deps
npm run dev            # local dev server
npm run build          # gen-derived + astro build → dist/
npm run preview        # serve dist/
npm run audit          # post-build SEO/a11y/schema/link/sitemap audit (non-zero on failure)
npm run validate:data  # validate src/data/*.json integrity
npm run daily-update   # bun scripts/daily-update.ts (needs api deps installed)
```

## Cloudflare Workers config

- Root directory: `site`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Output: `dist/` served as static assets by `wrangler.jsonc` (no Worker script
  on the request path, so page traffic does not consume the free request quota)
- Env var: `NODE_VERSION` = `20`

The `_headers` file carries the security headers (CSP, X-Frame-Options, …) and
content types for extensionless endpoints; `_redirects` keeps the documented
`/api/*` paths (and old `/blog?page=N` URLs) working.
