import { defineConfig } from 'astro/config';

// Fully static output — deployable to Cloudflare Pages with no server runtime.
// All data comes from src/data/*.json; rebuilt daily by GitHub Actions.
export default defineConfig({
  site: 'https://yieldwatch.io',
  output: 'static',
  build: {
    format: 'directory',
  },
  trailingSlash: 'ignore',
});
