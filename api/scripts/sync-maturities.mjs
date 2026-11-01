// Regenerate the API's copy of the canonical Treasury tenor config.
//
// The canonical source is site/src/data/maturities.json. The API image is built
// from the `api/` directory alone, so it needs its own byte-identical copy at
// src/data/maturities.json. Run this after editing the canonical file; CI also
// verifies the two stay in sync.
//
// Usage: node scripts/sync-maturities.mjs [--check]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', 'site', 'src', 'data', 'maturities.json');
const target = join(here, '..', 'src', 'data', 'maturities.json');

const canonical = await readFile(source, 'utf8');
const check = process.argv.includes('--check');

let current = null;
try {
  current = await readFile(target, 'utf8');
} catch {
  current = null;
}

if (current === canonical) {
  console.log('API tenor config already matches the canonical site config.');
} else if (check) {
  console.error('API tenor config is out of sync with site/src/data/maturities.json.');
  console.error('Run: cd api && npm run sync:maturities');
  process.exitCode = 1;
} else {
  await writeFile(target, canonical);
  console.log('Synced api/src/data/maturities.json from site/src/data/maturities.json.');
}
