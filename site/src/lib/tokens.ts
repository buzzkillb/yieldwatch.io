// Canonical design tokens and base page styles for every route.
// Emitted last in the document head so a page-level style block cannot
// silently reintroduce a different palette, font stack, or body background.
// Keep this file as the single source of truth for site-wide visual identity.

export const DESIGN_TOKENS = `:root {
  --bg-primary: #0a0a0f;
  --bg-secondary: #0f0f18;
  --bg-tertiary: #1a1a25;
  --bg-card: #16161f;
  --border-color: #2a2a3a;
  --text-primary: #f0f0f5;
  --text-secondary: #a0a0b0;
  --text-muted: #8a8a9e;
  --accent: #6366f1;
  --accent-text: #818cf8;
  --accent-hover: #a5b4fc;
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
  --gradient-start: #0a0a0f;
  --gradient-end: #12121a;
  --page-max-width: 1100px;
  --reading-max-width: 780px;
}`;

export const BASE_STYLE = `<style id="yw-tokens">
${DESIGN_TOKENS}
  html { background: var(--bg-primary); }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    background: linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-end) 100%);
    color: var(--text-primary);
    line-height: 1.6;
  }
  main.container {
    max-width: var(--page-max-width);
    margin: 0 auto;
    padding: 2rem;
  }
</style>`;
