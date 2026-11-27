#!/usr/bin/env node
// Writes reports/pr-body.md: a human-readable diff of tokens between a base
// version (e.g. main) and the current tokens file, plus the validation result.
//
// Usage: node scripts/summary.mjs <base-tokens.json> [current=tokens/tokens.json]
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { flatten, resolve } from './lib/tokens.mjs';

const [basePath, currentPath = 'tokens/tokens.json'] = process.argv.slice(2);
const load = (p) => (p && existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const index = (tree) => {
  const list = flatten(tree);
  const map = new Map(list.map((t) => [t.path, t]));
  return { list, map };
};
const base = index(load(basePath));
const cur = index(load(currentPath));

const show = (idx, t) => {
  const r = resolve(idx.map, t.path);
  const raw = String(t.value);
  const resolved = r.value !== undefined && String(r.value) !== raw ? ` → \`${r.value}\`` : '';
  return `\`${raw}\`${resolved}`;
};

const added = cur.list.filter((t) => !base.map.has(t.path));
const removed = base.list.filter((t) => !cur.map.has(t.path));
const changed = cur.list.filter((t) => base.map.has(t.path) && JSON.stringify(base.map.get(t.path).value) !== JSON.stringify(t.value));

let md = `## 🎨 Design tokens synced from Figma\n\n`;
md += `| | Count |\n|---|---|\n| ✏️ Changed | ${changed.length} |\n| ➕ Added | ${added.length} |\n| ➖ Removed | ${removed.length} |\n\n`;
if (changed.length) {
  md += `### ✏️ Changed\n| Token | Before | After |\n|---|---|---|\n`;
  for (const t of changed) md += `| \`${t.path}\` | ${show(base, base.map.get(t.path))} | ${show(cur, t)} |\n`;
  md += '\n';
}
if (added.length) {
  md += `### ➕ Added\n| Token | Value |\n|---|---|\n`;
  for (const t of added) md += `| \`${t.path}\` | ${show(cur, t)} |\n`;
  md += '\n';
}
if (removed.length) {
  md += `### ➖ Removed\n| Token | Was |\n|---|---|\n`;
  for (const t of removed) md += `| \`${t.path}\` | ${show(base, t)} |\n`;
  md += `\n> ⚠️ Removing tokens can break code that still uses them. Search the codebase before merging.\n\n`;
}
if (!changed.length && !added.length && !removed.length) md += `_No token values changed._\n\n`;

if (existsSync('reports/validation.json')) {
  const v = JSON.parse(readFileSync('reports/validation.json', 'utf8'));
  md += `### Pipeline\n- ${v.ok ? '✅' : '❌'} Tokens Validated (${v.tokenCount} tokens, ${v.checks.filter(([, p]) => p).length}/${v.checks.length} checks)\n`;
  for (const c of v.contrast ?? []) md += `  - ${c.pass ? '✅' : '❌'} ${c.label}: **${c.ratio}:1** (min ${c.min}:1)\n`;
  md += `- ✅ CSS Generated → \`build/css/tokens.css\`\n- ✅ Dart Generated → \`build/dart/tokens.dart\`\n`;
}
md += `\n---\n_Opened automatically by the Figma Design Pipeline. Review the generated files in the **Files changed** tab, then merge._\n`;

mkdirSync('reports', { recursive: true });
writeFileSync('reports/pr-body.md', md);
console.log(md);
