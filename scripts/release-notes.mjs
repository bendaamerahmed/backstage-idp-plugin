#!/usr/bin/env node
/**
 * Extract one version's section from CHANGELOG.md as release notes.
 *
 *     node scripts/release-notes.mjs v1.1.0
 *
 * The changelog is the single source; hand-written release notes drift from it
 * within two releases and then nobody knows which one is true.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../test/helpers/repo.mjs';

const tag = (process.argv[2] ?? '').trim();
const version = tag.replace(/^v/, '');
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <tag>');
  process.exit(2);
}

const changelog = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
const lines = changelog.split('\n');
// Deliberately not a regex. A version string is full of dots and brackets, and
// building the pattern by interpolation is how this silently matched every `##`
// heading and shipped an empty release note.
const isVersionHeading = (l) => {
  if (!l.startsWith('## ')) return false;
  const heading = l.slice(3).trim();
  const label = heading.split(/\s+[-–]\s+/)[0].replace(/^\[|\]$/g, '').trim();
  return label === version;
};

const start = lines.findIndex(isVersionHeading);

if (start === -1) {
  console.error(
    `CHANGELOG.md has no section for ${version}.\n` +
      'Move the Unreleased entries under a `## [x.y.z] - YYYY-MM-DD` heading before tagging.',
  );
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (/^##\s/.test(lines[i])) {
    end = i;
    break;
  }
}

const body = lines.slice(start + 1, end).join('\n').trim();

process.stdout.write(
  [
    body,
    '',
    '---',
    '',
    '**Install**',
    '',
    'Add this repository as a plugin marketplace, then install `backstage-idp` by name.',
    'The attached `.plugin` bundle is a reproducible build of `plugins/backstage-idp/`;',
    'its `.sha256` is attached alongside.',
    '',
    'Verified at this tag: Tier 0 structural rules, Tier 1 content invariants,',
    'Tier 2 currency against live upstream sources, and Tier 3 trigger accuracy.',
    'See `docs/test-coverage.md` for what each tier covers and, honestly, what it does not.',
    '',
  ].join('\n'),
);
