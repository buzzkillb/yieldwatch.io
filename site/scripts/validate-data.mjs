#!/usr/bin/env node
// Validates src/data/*.json before CI commits/pushes or builds the site.
// Catches duplicate days, unsorted rows, impossible rates, and summaries that
// no longer line up with the rate history.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (name) => JSON.parse(await readFile(join(root, 'src', 'data', name), 'utf8'));
const MATURITIES = new Set(['4WK', '6WK', '2MO', '3MO', '4MO', '6MO', '1YR', '2YR', '3YR', '5YR', '7YR', '10YR', '20YR', '30YR']);
const errors = [];

const rates = await readJson('rates.json');
const summaries = await readJson('summaries.json');

if (!Array.isArray(rates) || rates.length === 0) errors.push('rates.json is empty');
if (!Array.isArray(summaries)) errors.push('summaries.json is not an array');

let previous = '';
for (const row of rates) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row?.date ?? '')) { errors.push(`Bad rate date: ${row?.date}`); continue; }
  if (row.date <= previous) errors.push(`rates.json not strictly ascending at ${row.date}`);
  previous = row.date;
  if (!Array.isArray(row.rates) || row.rates.length < 9) { errors.push(`${row.date}: fewer than 9 maturities`); continue; }
  const seen = new Set();
  for (const r of row.rates) {
    if (!MATURITIES.has(r.maturity)) errors.push(`${row.date}: unknown maturity ${r.maturity}`);
    if (seen.has(r.maturity)) errors.push(`${row.date}: duplicate maturity ${r.maturity}`);
    seen.add(r.maturity);
    if (!Number.isFinite(r.rate) || r.rate < 0 || r.rate > 25) errors.push(`${row.date}: implausible rate ${r.rate} (${r.maturity})`);
  }
  const required = row.date >= '2010-01-01'
    ? ['3MO', '2YR', '10YR', '30YR']
    : ['10YR'];
  for (const tenor of required) {
    if (!seen.has(tenor)) errors.push(`${row.date}: missing required maturity ${tenor}`);
  }
}

const rateDates = new Set(rates.map(r => r.date));
const summaryDates = new Set();
for (const s of summaries) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s?.date ?? '')) { errors.push(`Bad summary date: ${s?.date}`); continue; }
  if (summaryDates.has(s.date)) errors.push(`Duplicate summary for ${s.date}`);
  summaryDates.add(s.date);
  if (!rateDates.has(s.date)) errors.push(`Summary ${s.date} has no matching rate row`);
  if (typeof s.summary !== 'string' || s.summary.length < 50) errors.push(`Summary ${s.date} is too short`);
  if (typeof s.blogSummary !== 'string' || s.blogSummary.length < 400) errors.push(`Blog summary ${s.date} is too short`);
}

if (summaries.length > 1) {
  for (let i = 1; i < summaries.length; i++) {
    if (summaries[i - 1].date <= summaries[i].date) {
      errors.push(`summaries.json not newest-first at ${summaries[i].date}`);
      break;
    }
  }
}

if (errors.length) {
  console.error(`Data validation failed with ${errors.length} issue(s):`);
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}
console.log(`Data OK: ${rates.length} rate days, ${summaries.length} summaries, latest ${rates[rates.length - 1].date}.`);
