// Canonical site chrome (header + footer) shared by every page.
// Templates are raw HTML, so the chrome is injected as a string at build time.
// Keeping one source of truth prevents nav/footer drift between pages.
import ratesJson from '../data/rates.json';

export type ChromeActive = 'dashboard' | 'blog' | 'archive' | 'api-docs' | 'faq' | null;

const latestRateDate = (() => {
  const rows = ratesJson as { date: string }[];
  return rows.length ? rows[rows.length - 1].date : null;
})();

function dataThroughLabel(): string {
  if (!latestRateDate) return 'Data through latest business day';
  const d = new Date(latestRateDate + 'T00:00:00Z');
  const label = d.toLocaleDateString('en-US', {
    timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
  });
  return `Data through ${label}`;
}

const LOGO_SVG = `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect fill="#6366f1" rx="15" width="100" height="100"/>
          <path d="M20 70 L35 55 L50 65 L65 40 L80 45" stroke="white" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="80" cy="45" r="6" fill="white"/>
        </svg>`;

const NAV_ITEMS: { key: ChromeActive; href: string; label: string }[] = [
  { key: 'dashboard', href: '/', label: 'Dashboard' },
  { key: 'blog', href: '/blog/', label: 'Daily Summaries' },
  { key: 'archive', href: '/blog/archive/', label: 'Archive' },
  { key: 'faq', href: '/faq/', label: 'FAQ' },
  { key: 'api-docs', href: '/api-docs/', label: 'API Docs' },
];

export function buildHeader(active: ChromeActive = null): string {
  const links = NAV_ITEMS.map(item => {
    const current = item.key === active ? ' aria-current="page"' : '';
    return `        <a href="${item.href}" class="yw-nav-link"${current}>${item.label}</a>`;
  }).join('\n');

  return `<header class="yw-header">
    <div class="yw-header-content">
      <a href="/" class="yw-logo" aria-label="YieldWatch home">
        ${LOGO_SVG}
        <span class="yw-logo-text">Treasury Yield</span>
      </a>
      <nav class="yw-nav" aria-label="Main navigation">
${links}
      </nav>
    </div>
  </header>`;
}

export function buildFooter(): string {
  return `<footer class="yw-footer">
    <div class="yw-footer-content">
      <div class="yw-footer-links">
        <a href="/faq/">FAQ</a>
        <span class="yw-divider">|</span>
        <a href="/api-docs/">API Documentation</a>
        <span class="yw-divider">|</span>
        <a href="https://home.treasury.gov" target="_blank" rel="noopener noreferrer">U.S. Treasury</a>
      </div>
      <div class="yw-footer-meta">Updated daily at 3:30 PM ET</div>
      <div class="yw-footer-meta">Data: <span id="lastUpdated">${dataThroughLabel()}</span></div>
    </div>
  </footer>`;
}

export const CHROME_STYLE = `<style id="yw-chrome">
  header.yw-header {
    background: linear-gradient(145deg, var(--bg-secondary, #0f0f18) 0%, var(--bg-primary, #0a0a0f) 100%);
    border-bottom: 1px solid var(--border-color, #2a2a3a);
    padding: 1.25rem 2rem;
    position: sticky;
    top: 0;
    z-index: 100;
    backdrop-filter: blur(10px);
  }
  .yw-header-content {
    max-width: 1100px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .yw-logo { display: flex; align-items: center; gap: 0.75rem; text-decoration: none; color: var(--text-primary, #f0f0f5); }
  .yw-logo svg { width: 36px; height: 36px; flex: 0 0 auto; }
  .yw-logo-text { font-size: 1.25rem; font-weight: 600; white-space: nowrap; }
  .yw-nav { display: flex; gap: 1.5rem; flex-wrap: wrap; align-items: center; }
  .yw-nav-link {
    color: var(--text-secondary, #a0a0b0);
    text-decoration: none;
    font-size: 0.9rem;
    transition: color 0.2s;
  }
  .yw-nav-link:hover,
  .yw-nav-link[aria-current="page"] { color: var(--accent, #818cf8); }
  footer.yw-footer {
    background: linear-gradient(145deg, var(--bg-secondary, #0f0f18) 0%, var(--bg-primary, #0a0a0f) 100%);
    border-top: 1px solid var(--border-color, #2a2a3a);
    padding: 1.5rem 2rem;
    margin-top: 2rem;
  }
  .yw-footer-content { max-width: 1100px; margin: 0 auto; text-align: center; }
  .yw-footer-links { display: flex; justify-content: center; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 0.75rem; }
  .yw-footer-links a { color: var(--text-secondary, #a0a0b0); text-decoration: none; font-size: 0.85rem; }
  .yw-footer-links a:hover { color: var(--accent, #818cf8); }
  .yw-divider { color: var(--text-muted, #606070); }
  .yw-footer-meta { color: var(--text-muted, #606070); font-size: 0.8rem; line-height: 1.6; }
  @media (max-width: 720px) {
    header.yw-header { padding: 1rem; }
    .yw-header-content { flex-direction: column; align-items: flex-start; gap: 0.75rem; }
    .yw-nav { gap: 1rem; }
    .yw-nav-link { font-size: 0.85rem; }
    footer.yw-footer { padding: 1.25rem 1rem; }
  }
  @media (max-width: 480px) {
    .yw-nav { gap: 0.55rem; flex-wrap: nowrap; }
    .yw-nav-link { font-size: 0.72rem; letter-spacing: 0; }
  }
</style>`;

// Replace the template's own header/footer with the canonical chrome and
// append the shared styles last so they win over per-template rules.
export function applyChrome(html: string, active: ChromeActive): string {
  let out = html
    .replace(/<header class="header">[\s\S]*?<\/header>/, buildHeader(active))
    .replace(/<footer class="footer">[\s\S]*?<\/footer>/, buildFooter());

  if (!out.includes('id="yw-chrome"')) {
    out = out.replace('</head>', `  ${CHROME_STYLE}\n</head>`);
  }
  return out;
}
