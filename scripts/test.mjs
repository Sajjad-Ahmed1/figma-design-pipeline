#!/usr/bin/env node
// Self-test for the validator: every fixture in tests/fixtures must produce
// the exit code and error message declared in tests/cases.json.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const cases = JSON.parse(readFileSync('tests/cases.json', 'utf8'));
let failed = 0;
for (const c of cases) {
  const env = { ...process.env };
  delete env.GITHUB_ACTIONS; delete env.GITHUB_STEP_SUMMARY;
  const r = spawnSync('node', ['scripts/validate.mjs', `tests/fixtures/${c.fixture}`], { encoding: 'utf8', env });
  const out = r.stdout + r.stderr;
  const okCode = r.status === c.exit;
  const okMsg = !c.expect || out.includes(c.expect);
  const pass = okCode && okMsg;
  if (!pass) failed++;
  console.log(`${pass ? '✓' : '✗'} ${c.name}${pass ? '' : `\n    exit ${r.status} (wanted ${c.exit}); expected text: ${c.expect}\n${out}`}`);
}
console.log(failed ? `\n${failed} test(s) failed` : `\nAll ${cases.length} validator tests passed`);
process.exit(failed ? 1 : 0);
