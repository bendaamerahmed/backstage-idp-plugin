#!/usr/bin/env node
/**
 * Resolve the placeholders in OPEN-DECISIONS.md across the whole repository.
 *
 *     node scripts/apply-open-decisions.mjs \
 *       --owner acme-platform \
 *       --repo backstage-idp \
 *       --codeowners @acme-platform/idp-maintainers \
 *       --security-contact security@acme.example.com
 *
 * These four values end up in a published artifact — a marketplace entry, a
 * security contact, review authority over the agent's safety properties — so
 * they are never guessed. This script exists so that resolving them is one
 * reviewable commit rather than a hunt through eight files.
 *
 * It does not commit. Review the diff, then `npm run check:release-gate`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, rel } from '../test/helpers/repo.mjs';

const argv = process.argv.slice(2);
const arg = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
};

if (argv.includes('--help') || argv.length === 0) {
  console.log(
    [
      'usage: node scripts/apply-open-decisions.mjs [options]',
      '',
      '  --owner <org>               GitHub owner, replaces OWNER-TBD',
      '  --repo <name>               GitHub repository, replaces REPO-TBD',
      '  --codeowners <@org/team>    review authority, replaces @OWNER-TBD in CODEOWNERS',
      '  --security-contact <email>  replaces the disclosure address in SECURITY.md',
      '',
      'Every option is independent; apply what you have decided and re-run later',
      'for the rest. See OPEN-DECISIONS.md.',
    ].join('\n'),
  );
  process.exit(0);
}

const owner = arg('--owner');
const repo = arg('--repo');
const codeowners = arg('--codeowners');
const securityContact = arg('--security-contact');

if (codeowners && !codeowners.startsWith('@')) {
  console.error(`--codeowners must start with @ (got "${codeowners}")`);
  process.exit(2);
}
if (securityContact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(securityContact)) {
  console.error(`--security-contact does not look like an email address (got "${securityContact}")`);
  process.exit(2);
}

/** Files that carry a placeholder. Kept explicit so nothing is rewritten by surprise. */
const TARGETS = [
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'CODEOWNERS',
  'OPEN-DECISIONS.md',
  '.github/workflows/validate.yml',
  '.github/workflows/currency.yml',
  '.github/workflows/integration.yml',
  '.github/workflows/release.yml',
  'test/helpers/net.mjs',
];

const edits = [];
if (owner) edits.push({ from: /OWNER-TBD/g, to: owner, what: 'GitHub owner' });
if (repo) edits.push({ from: /REPO-TBD/g, to: repo, what: 'GitHub repository' });
if (securityContact) edits.push({ from: /ahmed\.b\.daamer@gmail\.com/g, to: securityContact, what: 'security contact' });

let changed = 0;
for (const relPath of TARGETS) {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) continue;
  const before = fs.readFileSync(abs, 'utf8');
  let after = before;

  // CODEOWNERS gets the team, not the owner slug — they are different things and
  // conflating them silently assigns review to whoever happens to own the org.
  if (relPath === 'CODEOWNERS' && codeowners) {
    after = after.replace(/@OWNER-TBD/g, codeowners);
  } else {
    for (const e of edits) after = after.replace(e.from, e.to);
  }

  if (after !== before) {
    fs.writeFileSync(abs, after);
    console.log(`  ${rel(abs)}`);
    changed++;
  }
}

if (codeowners && !fs.readFileSync(path.join(REPO_ROOT, 'CODEOWNERS'), 'utf8').includes(codeowners)) {
  console.warn('  warning: CODEOWNERS still contains @OWNER-TBD — check the file by hand');
}

console.log(`\n${changed} file(s) changed.`);
console.log('\nNot committed. Review the diff, then:');
console.log('  npm run check:release-gate');
console.log('\nDecision 4 (the support-matrix floor) has no script: edit baseline.json');
console.log('and docs/test-coverage.md together, and note the change in CHANGELOG.md.');
