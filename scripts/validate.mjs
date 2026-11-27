#!/usr/bin/env node
// Validates a DTCG tokens file against structural rules and the design-system
// rules in pipeline.config.json. Exits 1 if any error is found.
//
// Usage: node scripts/validate.mjs tokens/tokens.json [--config pipeline.config.json]
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import {
  ALIAS_RE, HEX_RE, DIMENSION_RE, NAME_SEGMENT_RE,
  flatten, resolve, contrastRatio,
} from './lib/tokens.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) ?? 'tokens/tokens.json';
const cfgIdx = args.indexOf('--config');
const configPath = cfgIdx >= 0 ? args[cfgIdx + 1] : 'pipeline.config.json';

const errors = [];
const warnings = [];
const checks = [];
const contrastResults = [];
let lines = [];
let tokens = [];

function lineOf(path) {
  // Walk the pretty-printed JSON segment by segment to find the token's line.
  let from = 0;
  for (const seg of path.split('.')) {
    const needle = `"${seg}"`;
    const idx = lines.findIndex((l, i) => i >= from && l.includes(needle));
    if (idx === -1) return 1;
    from = idx + 1;
  }
  return from;
}
const err = (path, message) => errors.push({ path, message, line: path ? lineOf(path) : 1 });
const warn = (path, message) => warnings.push({ path, message, line: path ? lineOf(path) : 1 });

// ---- 1. File parses as JSON --------------------------------------------------
let text;
let tree;
try {
  text = readFileSync(file, 'utf8');
  lines = text.split('\n');
  tree = JSON.parse(text);
  checks.push(['JSON syntax', true]);
} catch (e) {
  errors.push({ path: '', message: `cannot read/parse ${file}: ${e.message}`, line: 1 });
  checks.push(['JSON syntax', false]);
  report();
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
tokens = flatten(tree);
const byPath = new Map(tokens.map((t) => [t.path, t]));

if (tokens.length === 0) err('', 'file contains no tokens');

// ---- 2. Structure: known collection, type, names ------------------------------
const before = errors.length;
for (const t of tokens) {
  const [collection] = t.segments;
  const rule = config.collections[collection];
  if (!rule) { err(t.path, `unknown collection "${collection}" (allowed: ${Object.keys(config.collections).join(', ')})`); continue; }
  if (!t.type) err(t.path, 'missing $type');
  else if (t.type !== rule.type) err(t.path, `$type "${t.type}" not allowed in "${collection}" (expected "${rule.type}")`);
  for (const seg of t.segments) {
    if (!NAME_SEGMENT_RE.test(seg)) err(t.path, `name segment "${seg}" must be lowercase kebab-case (a-z, 0-9, -)`);
  }
}
checks.push(['Structure & naming', errors.length === before]);

// ---- 3. Duplicate output names (e.g. "brand/primary" and "brand-primary") ----
const b3 = errors.length;
const cssNames = new Map();
for (const t of tokens) {
  const css = '--' + t.segments.join('-');
  if (cssNames.has(css)) err(t.path, `collides with "${cssNames.get(css)}" → both become ${css}`);
  else cssNames.set(css, t.path);
}
checks.push(['No duplicate names', errors.length === b3]);

// ---- 4. Values & aliases -----------------------------------------------------
const b4 = errors.length;
for (const t of tokens) {
  const rule = config.collections[t.segments[0]];
  if (!rule) continue;
  if (typeof t.value === 'string' && ALIAS_RE.test(t.value)) {
    const r = resolve(byPath, t.path);
    if (r.error) err(t.path, r.error);
    else if (r.type !== t.type) err(t.path, `alias points to a ${r.type} token but this is ${t.type}`);
    continue;
  }
  if (t.type === 'color') {
    if (typeof t.value !== 'string' || !HEX_RE.test(t.value)) err(t.path, `invalid color "${t.value}" (expected #RRGGBB or #RRGGBBAA)`);
  } else if (t.type === 'dimension') {
    const m = typeof t.value === 'string' && t.value.match(DIMENSION_RE);
    if (!m) { err(t.path, `invalid dimension "${t.value}" (expected e.g. "16px")`); continue; }
    const n = Number(m[1]);
    if (rule.min !== undefined && n < rule.min) err(t.path, `${n}px is below the minimum ${rule.min}px`);
    if (rule.max !== undefined && n > rule.max) err(t.path, `${n}px is above the maximum ${rule.max}px`);
    if (t.segments[0] === 'spacing' && n % 2 !== 0) warn(t.path, `${n}px is not on the 2px grid`);
  }
}
checks.push(['Values & aliases', errors.length === b4]);

// ---- 5. Required tokens -------------------------------------------------------
const b5 = errors.length;
for (const p of config.requiredTokens ?? []) if (!byPath.has(p)) err('', `required token "${p}" is missing`);
checks.push(['Required tokens present', errors.length === b5]);

// ---- 6. WCAG contrast ---------------------------------------------------------
const b6 = errors.length;
for (const pair of config.contrast ?? []) {
  const fg = resolve(byPath, pair.foreground);
  const bg = resolve(byPath, pair.background);
  if (fg.error || bg.error) { err(pair.foreground, `contrast check "${pair.label}" cannot resolve colors`); continue; }
  if (!HEX_RE.test(fg.value) || !HEX_RE.test(bg.value)) continue; // already reported above
  if (fg.value.length === 9 || bg.value.length === 9) warn(pair.foreground, `contrast for "${pair.label}" ignores alpha`);
  const ratio = contrastRatio(fg.value.slice(0, 7), bg.value.slice(0, 7));
  const pass = ratio >= pair.min;
  contrastResults.push({ ...pair, fg: fg.value, bg: bg.value, ratio: Math.round(ratio * 100) / 100, pass });
  if (!pass) err(pair.foreground, `WCAG contrast ${ratio.toFixed(2)}:1 for "${pair.label}" (${fg.value} on ${bg.value}) is below ${pair.min}:1`);
}
checks.push(['WCAG AA contrast', errors.length === b6]);

report();

// ---- Output -------------------------------------------------------------------
function report() {
  const ok = errors.length === 0;
  const result = { ok, file, tokenCount: tokens.length, checks, errors, warnings, contrast: contrastResults };
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/validation.json', JSON.stringify(result, null, 2));

  // Console
  console.log(`\nValidating ${file} — ${result.tokenCount} tokens\n`);
  for (const [name, pass] of checks) console.log(`  ${pass ? '✓' : '✗'} ${name}`);
  for (const c of result.contrast) console.log(`    ${c.pass ? '✓' : '✗'} ${c.label}: ${c.ratio}:1 (min ${c.min})`);
  for (const w of warnings) console.log(`  ⚠ ${w.path}: ${w.message}`);
  for (const e of errors) console.log(`  ✗ ${e.path || file}: ${e.message}`);
  console.log(ok ? '\n✓ Tokens Validated\n' : `\n✗ Validation failed: ${errors.length} error(s)\n`);

  // GitHub annotations + job summary
  if (process.env.GITHUB_ACTIONS) {
    for (const e of errors) console.log(`::error file=${file},line=${e.line},title=Token error::${e.path ? e.path + ': ' : ''}${e.message}`);
    for (const w of warnings) console.log(`::warning file=${file},line=${w.line},title=Token warning::${w.path}: ${w.message}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    let md = `## ${ok ? '✅ Tokens Validated' : '❌ Token validation failed'}\n\n`;
    md += `**${result.tokenCount}** tokens in \`${file}\`\n\n| Check | Result |\n|---|---|\n`;
    for (const [name, pass] of checks) md += `| ${name} | ${pass ? '✅' : '❌'} |\n`;
    if (result.contrast.length) {
      md += `\n### Contrast\n| Pair | Colors | Ratio | Min |\n|---|---|---|---|\n`;
      for (const c of result.contrast) md += `| ${c.pass ? '✅' : '❌'} ${c.label} | \`${c.fg}\` on \`${c.bg}\` | ${c.ratio}:1 | ${c.min}:1 |\n`;
    }
    if (errors.length) { md += `\n### Errors\n`; for (const e of errors) md += `- \`${e.path || file}\` — ${e.message}\n`; }
    if (warnings.length) { md += `\n### Warnings\n`; for (const w of warnings) md += `- \`${w.path}\` — ${w.message}\n`; }
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
  process.exit(ok ? 0 : 1);
}
