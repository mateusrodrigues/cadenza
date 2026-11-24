#!/usr/bin/env node
// Fails if outward-facing files mention names Cadenza must not use (see docs/PLAN.md §6).
// Scans brand surfaces only: the extension (manifest config, UI, strings), README, store
// assets and website. Provider presets/adapters live in packages/providers and are exempt,
// since naming vendors there is functional.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BLOCKLIST_FILE = join(ROOT, 'scripts/naming-blocklist.txt');
const SURFACES = ['packages/extension', 'README.md', 'store', 'website'];
const SKIP_DIRS = new Set(['node_modules', '.output', '.output-e2e', '.wxt', 'dist']);
const TEXT_EXT = /\.(ts|tsx|js|mjs|json|html|css|md|txt|svg|yml|yaml)$/;

const terms = readFileSync(BLOCKLIST_FILE, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
const pattern = new RegExp(`\\b(${terms.map(escapeRegExp).join('|')})\\b`, 'i');

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function* files(path) {
  if (!existsSync(path)) return;
  const st = statSync(path);
  if (st.isFile()) {
    if (TEXT_EXT.test(path)) yield path;
    return;
  }
  for (const name of readdirSync(path)) {
    if (SKIP_DIRS.has(name)) continue;
    yield* files(join(path, name));
  }
}

const hits = [];
for (const surface of SURFACES) {
  for (const file of files(join(ROOT, surface))) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const m = pattern.exec(line);
        if (m) hits.push(`${relative(ROOT, file)}:${i + 1}: "${m[0]}"`);
      });
  }
}

if (hits.length) {
  console.error('Outward-facing files mention blocked names (docs/PLAN.md §6):');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`Naming check passed (${terms.length} blocked terms).`);
