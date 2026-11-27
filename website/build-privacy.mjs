#!/usr/bin/env node
// Writes website/privacy.html from store/privacy-policy.md, so the published policy and the one
// submitted to the store can't drift apart. Run it after editing the policy:
//   node website/build-privacy.mjs
// It reads only the Markdown the policy uses: headings, paragraphs, lists, one kind of table,
// bold, a line in italics, email addresses, and [placeholders], which it highlights and reports.
import { readFileSync, writeFileSync } from 'node:fs';

const source = new URL('../store/privacy-policy.md', import.meta.url);
const target = new URL('privacy.html', import.meta.url);

const placeholders = [];

function inline(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^_(.+)_$/, '<em>$1</em>')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<a href="mailto:$&">$&</a>')
    .replace(/\[[^\]]+\](?!\()/g, (found) => {
      placeholders.push(found);
      return `<mark class="todo">${found}</mark>`;
    });
}

function cells(row) {
  return row
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function block(lines) {
  const [first] = lines;
  if (first.startsWith('## ')) return `<h2>${inline(first.slice(3))}</h2>`;
  if (first.startsWith('# ')) return `<h1>${inline(first.slice(2))}</h1>`;
  if (first.startsWith('|')) {
    const [head, , ...rows] = lines;
    const tr = (row, tag) =>
      `<tr>${cells(row)
        .map((c) => `<${tag}>${inline(c)}</${tag}>`)
        .join('')}</tr>`;
    return [
      '<div class="table"><table>',
      `<thead>${tr(head, 'th')}</thead>`,
      `<tbody>${rows.map((row) => tr(row, 'td')).join('\n')}</tbody>`,
      '</table></div>',
    ].join('\n');
  }
  if (first.startsWith('- ')) {
    const items = [];
    for (const line of lines) {
      if (line.startsWith('- ')) items.push(line.slice(2));
      else items[items.length - 1] += ` ${line.trim()}`;
    }
    return `<ul>\n${items.map((item) => `<li>${inline(item)}</li>`).join('\n')}\n</ul>`;
  }
  return `<p>${inline(lines.join(' '))}</p>`;
}

const body = readFileSync(source, 'utf8')
  .trim()
  .split(/\n\s*\n/)
  .map((chunk) => block(chunk.split('\n')))
  .join('\n');

const lockup = (height, width) => `<picture>
        <source srcset="assets/logo/lockup-on-dark.svg" media="(prefers-color-scheme: dark)">
        <img src="assets/logo/lockup-on-light.svg" alt="Cadenza" width="${width}" height="${height}">
      </picture>`;

writeFileSync(
  target,
  `<!doctype html>
<!-- Generated from store/privacy-policy.md by website/build-privacy.mjs. Edit the Markdown. -->
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Privacy policy | Cadenza</title>
    <meta name="description" content="What Cadenza reads, where it sends it, and what it keeps.">
    <link rel="canonical" href="https://cadenza.mateus.tech/privacy.html">
    <link rel="icon" href="favicon.ico" sizes="48x48">
    <link rel="icon" href="assets/icons/icon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png">
    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    <header class="top wrap">
      <a class="brand" href="./">
        ${lockup(32, 137)}
      </a>
      <nav aria-label="Main">
        <a class="button" href="./">Back to the site</a>
      </nav>
    </header>
    <main id="main" class="policy wrap">
${body}
    </main>
    <footer class="bottom wrap">
      ${lockup(24, 103)}
      <nav aria-label="Footer">
        <a href="./">Home</a>
        <a href="https://github.com/mateusrodrigues/cadenza">Source on GitHub</a>
        <a href="https://github.com/mateusrodrigues/cadenza/issues">Report a problem</a>
      </nav>
    </footer>
  </body>
</html>
`,
);

console.log('Wrote website/privacy.html');
if (placeholders.length) {
  console.warn(`Still to fill in before publishing: ${placeholders.join(', ')}`);
}
