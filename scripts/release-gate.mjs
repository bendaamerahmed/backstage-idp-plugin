#!/usr/bin/env node
/**
 * The gate between "works" and "published".
 *
 *     npm run check:release-gate
 *     node scripts/release-gate.mjs --check-tag v1.1.0
 *
 * Everything here is about what an ADOPTER receives. A placeholder in a test is
 * a nuisance; a placeholder in a published artifact is a security contact that
 * goes nowhere and a marketplace entry pointing at a repository that does not
 * exist. These checks deliberately do NOT run in `npm test`, so ordinary
 * development is never blocked on a decision that is not yet made.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, PLUGIN_MANIFEST, MARKETPLACE_MANIFEST, readJson, rel } from '../test/helpers/repo.mjs';

const PLACEHOLDERS = ['OWNER-TBD', 'REPO-TBD', 'TBD', 'FIXME', 'XXXX'];

/** Files whose contents reach an adopter, directly or through a link. */
const SHIPPED = [
  '.claude-plugin/marketplace.json',
  'plugins/backstage-idp/.claude-plugin/plugin.json',
  'plugins/backstage-idp/README.md',
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODEOWNERS',
  'CHANGELOG.md',
];

const problems = [];

function problem(file, what, fix) {
  problems.push({ file, what, fix });
}

// 1. No unresolved open decisions in anything that ships.
for (const relPath of SHIPPED) {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    problem(relPath, 'file is missing', 'an adopter expects it; restore it');
    continue;
  }
  const text = fs.readFileSync(abs, 'utf8');
  text.split('\n').forEach((line, i) => {
    for (const p of PLACEHOLDERS) {
      if (!line.includes(p)) continue;
      problem(
        `${relPath}:${i + 1}`,
        `unresolved placeholder "${p}": ${line.trim().slice(0, 90)}`,
        'see OPEN-DECISIONS.md, then run `node scripts/apply-open-decisions.mjs --help`',
      );
    }
  });
}

// 2. Skill markdown must not carry placeholders either — Tier 0 covers the
//    common ones, this covers the release-specific set.
const skillsDir = path.join(REPO_ROOT, 'plugins', 'backstage-idp', 'skills');
for (const dir of fs.readdirSync(skillsDir)) {
  const f = path.join(skillsDir, dir, 'SKILL.md');
  if (!fs.existsSync(f)) continue;
  const text = fs.readFileSync(f, 'utf8');
  for (const p of PLACEHOLDERS) {
    if (text.includes(p)) problem(rel(f), `contains "${p}"`, 'resolve it before publishing');
  }
}

// 3. The changelog must describe the version being released.
const plugin = readJson(PLUGIN_MANIFEST);
const changelog = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
if (!new RegExp(`^##\\s*\\[?${plugin.version.replace(/\./g, '\\.')}\\]?`, 'm').test(changelog)) {
  problem(
    'CHANGELOG.md',
    `no section for version ${plugin.version}`,
    'move the Unreleased entries under a `## [x.y.z] - YYYY-MM-DD` heading before tagging',
  );
}

// 4. Baseline must have been verified recently enough to publish.
const baseline = readJson(path.join(REPO_ROOT, 'baseline.json'));
const verifiedDays = (Date.now() - Date.parse(baseline.release.verifiedOn)) / 86_400_000;
if (verifiedDays > 60) {
  problem(
    'baseline.json',
    `release facts last verified ${Math.round(verifiedDays)} days ago (${baseline.release.verifiedOn})`,
    'run `npm run test:currency` and re-verify before publishing — Backstage ships monthly, so a two-month-old baseline is two release lines of unchecked claims',
  );
}

// 5. Trigger evals must describe the content being shipped.
const resultsFile = path.join(REPO_ROOT, 'test', 'tier3', 'results', 'latest.json');
if (!fs.existsSync(resultsFile)) {
  problem('test/tier3/results/latest.json', 'no trigger eval results', 'run `npm run evals` before releasing');
}

// 6. --check-tag: the git tag and every manifest must agree.
const tagIdx = process.argv.indexOf('--check-tag');
if (tagIdx !== -1) {
  const tag = process.argv[tagIdx + 1] ?? '';
  const expected = `v${plugin.version}`;
  if (tag !== expected) {
    problem(
      'git tag',
      `tag "${tag}" does not match plugin.json version "${plugin.version}"`,
      `either tag ${expected}, or run \`node scripts/set-version.mjs ${tag.replace(/^v/, '')}\` and commit before tagging`,
    );
  }
  const market = readJson(MARKETPLACE_MANIFEST);
  const entry = (market.plugins ?? []).find((p) => p.name === 'backstage-idp');
  if (entry && entry.version !== plugin.version) {
    problem('.claude-plugin/marketplace.json', `entry version ${entry.version} != plugin ${plugin.version}`, 'run `node scripts/set-version.mjs`');
  }
}

if (problems.length === 0) {
  console.log(`Release gate passed for v${plugin.version}.`);
  process.exit(0);
}

console.error(`\nRELEASE GATE: ${problems.length} problem(s). Nothing is published until these are resolved.\n`);
for (const p of problems) {
  console.error(`  ${p.file}`);
  console.error(`      ${p.what}`);
  console.error(`      fix: ${p.fix}\n`);
}
process.exit(1);
