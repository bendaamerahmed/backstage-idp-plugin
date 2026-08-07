#!/usr/bin/env node
/**
 * `npm test` — run everything that can run here, and say what could not.
 *
 * The contract: a tier is never silently skipped. Anything that does not run
 * prints why and the exact command that would run it. A suite that quietly
 * shrinks to whatever the environment allows is a suite that reports confidence
 * it has not earned.
 *
 * Exit code reflects only the tiers that actually ran. A missing Backstage
 * fixture is not a test failure; presenting the run as complete when one is
 * missing would be.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../test/helpers/repo.mjs';

const started = Date.now();

function run(label, cmd, args, { optional = false } = {}) {
  process.stdout.write(`\n─── ${label} ${'─'.repeat(Math.max(0, 60 - label.length))}\n`);
  const res = spawnSync(cmd, args, { cwd: REPO_ROOT, stdio: 'inherit', timeout: 30 * 60 * 1000 });
  return { label, status: res.status ?? 1, optional };
}

const node = process.execPath;
const results = [];
const skipped = [];

// Tier 0 + Tier 1 — always.
results.push(run('Tier 0 + Tier 1 — structure and content', node, ['--test', 'test/tier0/*.test.mjs', 'test/tier1/*.test.mjs']));

// markdownlint.
const mdlint = process.platform === 'win32'
  ? [node, [path.join(REPO_ROOT, 'node_modules', 'markdownlint-cli2', 'markdownlint-cli2-bin.mjs')]]
  : ['npx', ['markdownlint-cli2']];
if (fs.existsSync(path.join(REPO_ROOT, 'node_modules', 'markdownlint-cli2'))) {
  results.push(run('markdownlint', mdlint[0], mdlint[1]));
} else {
  skipped.push({ what: 'markdownlint', why: 'markdownlint-cli2 is not installed', how: 'npm ci' });
}

// Mutation check — proves the rules above can fail.
results.push(run('Mutation check — can the rules fail?', node, ['scripts/mutation-check.mjs']));

// Tier 3 thresholds — asserts against committed eval results, no model calls.
results.push(run('Tier 3 — trigger accuracy thresholds', node, ['--test', 'test/tier3/triggers.test.mjs']));

// Tier 3 behaviour results, if they have been measured.
const behaviorResults = path.join(REPO_ROOT, 'test', 'tier3', 'results', 'behavior.json');
if (fs.existsSync(behaviorResults)) {
  results.push(run('Tier 3 — agent behaviour and injection', node, ['--test', 'test/tier3/behavior.test.mjs']));
} else {
  skipped.push({
    what: 'Tier 3 behaviour and prompt injection',
    why: 'no measured results at test/tier3/results/behavior.json',
    how: 'npm run evals:behavior   (real agent runs; needs the claude CLI)',
  });
}

// Tier 2 — currency. Network-dependent, so optional in the default run.
if (process.env.BSIDP_OFFLINE === '1') {
  skipped.push({ what: 'Tier 2 currency', why: 'BSIDP_OFFLINE=1', how: 'unset BSIDP_OFFLINE && npm run test:currency' });
} else {
  results.push(run('Tier 2 — currency against live upstream', node, ['--test', 'test/tier2/*.test.mjs'], { optional: true }));
}

// Tier 4 — integration. Reports its own skips per fixture.
results.push(run('Tier 4 — integration against real Backstage', node, ['--test', 'test/tier4/*.test.mjs']));

// ---------------------------------------------------------------------------

const failed = results.filter((r) => r.status !== 0 && !r.optional);
const optionalFailed = results.filter((r) => r.status !== 0 && r.optional);
const elapsed = Math.round((Date.now() - started) / 1000);

process.stdout.write(`\n${'═'.repeat(66)}\n`);
process.stdout.write(`SUITE SUMMARY — ${elapsed}s\n\n`);
for (const r of results) {
  const mark = r.status === 0 ? 'pass' : r.optional ? 'FAIL (non-blocking)' : 'FAIL';
  process.stdout.write(`  ${mark.padEnd(20)} ${r.label}\n`);
}

if (skipped.length) {
  process.stdout.write('\n  NOT RUN — these are gaps in this run, not passes:\n\n');
  for (const s of skipped) {
    process.stdout.write(`    ${s.what}\n      why: ${s.why}\n      run: ${s.how}\n\n`);
  }
}

if (optionalFailed.length) {
  process.stdout.write(
    '\n  Non-blocking failures above depend on live upstream state. They are the\n' +
      '  signal the currency job exists for — see docs/runbook.md — but they do not\n' +
      '  fail this run, because a Backstage release must not block unrelated work.\n',
  );
}

process.stdout.write(`\n  Coverage per skill: npm run coverage:report\n`);
process.stdout.write(`${'═'.repeat(66)}\n`);

process.exit(failed.length ? 1 : 0);
