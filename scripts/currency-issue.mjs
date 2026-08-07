#!/usr/bin/env node
/**
 * Turn Tier 2 findings into an issue body.
 *
 * The point of the currency job is not to go red. It is to hand a maintainer a
 * list of assertions to re-verify, each with the source that contradicts it and
 * the specific edit to make. A red X on a scheduled workflow that nobody can act
 * on gets muted within two months, and then the staleness detection is gone.
 *
 *     node --test "test/tier2/*.test.mjs"     # writes test/tier2/findings.json
 *     node scripts/currency-issue.mjs         # prints the issue body
 *     node scripts/currency-issue.mjs --title # prints just the title
 *
 * Exit codes: 0 = nothing to report, 1 = findings exist (CI opens the issue).
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadBaseline } from '../test/helpers/repo.mjs';

const FINDINGS = path.join(REPO_ROOT, 'test', 'tier2', 'findings.json');

let data;
try {
  data = JSON.parse(fs.readFileSync(FINDINGS, 'utf8'));
} catch {
  console.error(
    `No findings file at ${path.relative(REPO_ROOT, FINDINGS)}.\n` +
      'Run `npm run test:currency` first — it writes the file even when everything passes.',
  );
  process.exit(2);
}

const baseline = loadBaseline();
const actionable = data.findings.filter((f) => f.severity === 'fail' || f.severity === 'warn');

if (process.argv.includes('--title')) {
  const worst = actionable.some((f) => f.severity === 'fail') ? 'stale' : 'drifting';
  const line = actionable.find((f) => f.assertion === 'release.currentLine');
  console.log(
    `Currency: baseline is ${worst}${line ? ` — ${line.baselineSays} vs ${line.upstreamSays} upstream` : ''}`,
  );
  process.exit(actionable.length ? 1 : 0);
}

if (actionable.length === 0) {
  console.log(
    `Baseline is current as of ${data.generatedOn.slice(0, 10)}.\n` +
      `Release line ${baseline.release.currentLine}, Node ${baseline.node.supportedMajors.join(' and ')}. Nothing to re-verify.`,
  );
  process.exit(0);
}

const fails = actionable.filter((f) => f.severity === 'fail');
const warns = actionable.filter((f) => f.severity === 'warn');

const out = [];
out.push(`Opened automatically by the weekly currency job on ${data.generatedOn.slice(0, 10)}.`);
out.push('');
out.push(
  'Each item below is an assertion the plugin makes that no longer agrees with its upstream source. ' +
    'Do not close this issue by bumping `baselineVerifiedOn` — re-verify the fact against the source named, ' +
    'change the content and `baseline.json` together, and cite the source in the commit body.',
);
out.push('');
out.push(`**${fails.length} must fix, ${warns.length} to review.**`);
out.push('');

function render(f, i) {
  const lines = [];
  lines.push(`### ${i}. \`${f.assertion}\``);
  lines.push('');
  lines.push('| | |');
  lines.push('| :--- | :--- |');
  lines.push(`| baseline says | ${inline(f.baselineSays)} |`);
  lines.push(`| upstream says | ${inline(f.upstreamSays)} |`);
  lines.push(`| source | ${f.source} |`);
  lines.push(`| last verified | ${f.verifiedOn} |`);
  lines.push('');
  lines.push('**What to do**');
  lines.push('');
  lines.push(f.whatToDo);
  lines.push('');
  return lines.join('\n');
}

function inline(v) {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 400);
}

if (fails.length) {
  out.push('## Must fix');
  out.push('');
  fails.forEach((f, i) => out.push(render(f, i + 1)));
}
if (warns.length) {
  out.push('## To review');
  out.push('');
  warns.forEach((f, i) => out.push(render(f, fails.length + i + 1)));
}

out.push('## After fixing');
out.push('');
out.push('```bash');
out.push('npm test');
out.push('npm run test:currency');
out.push('node scripts/mutation-check.mjs');
out.push('```');
out.push('');
out.push(
  'If a fact turns out to be genuinely version-dependent rather than simply wrong, the correct fix is not a ' +
    'new value — it is to mark the claim version-sensitive and instruct reading the installed package. ' +
    'See `docs/authoring.md`.',
);

console.log(out.join('\n'));
process.exit(1);
