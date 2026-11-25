// Fails if the built content script is over the Phase 7 budget (50 KB gzipped). It runs on
// every page, so its size is paid on every page load.
//   node scripts/check-size.mjs [build dir]   (default: the normal build)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET = 50 * 1024;
const dir = process.argv[2] ?? 'packages/extension/.output/chrome-mv3';
const file = join(dir, 'content-scripts/content.js');
const gz = gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
if (gz > BUDGET) {
  console.error(`Content script is ${kb(gz)} gzipped, over the ${kb(BUDGET)} budget.`);
  process.exit(1);
}
console.log(`Content script: ${kb(gz)} gzipped (budget ${kb(BUDGET)}).`);
