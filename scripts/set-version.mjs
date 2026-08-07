#!/usr/bin/env node
/**
 * Set the release version in every file that carries one.
 *
 * Three manifests declare a version and Tier 0 requires all three to agree.
 * Editing them by hand is how they stop agreeing, so this is the supported way:
 *
 *     node scripts/set-version.mjs 1.1.0
 *
 * It does not tag, commit or push. Run it, review the diff, then commit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, PLUGIN_MANIFEST, MARKETPLACE_MANIFEST, rel } from '../test/helpers/repo.mjs';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?$/;

const version = process.argv[2];
if (!version || !SEMVER.test(version)) {
  console.error(`usage: node scripts/set-version.mjs <semver>\n  got: ${version ?? '(nothing)'}`);
  process.exit(2);
}

/** Rewrite one JSON field, preserving the file's own formatting as far as possible. */
function patch(file, mutate) {
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  mutate(data);
  const trailingNewline = raw.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + trailingNewline);
  console.log(`  ${rel(file)}`);
}

console.log(`Setting version to ${version} in:`);

patch(path.join(REPO_ROOT, 'package.json'), (d) => {
  d.version = version;
});

patch(PLUGIN_MANIFEST, (d) => {
  d.version = version;
});

patch(MARKETPLACE_MANIFEST, (d) => {
  d.metadata ??= {};
  d.metadata.version = version;
  for (const p of d.plugins ?? []) {
    if (p.name === 'backstage-idp') p.version = version;
  }
});

console.log(
  '\nNot committed and not tagged. Review the diff, update CHANGELOG.md, then:\n' +
    `  git commit -am "Release v${version}"\n` +
    `  git tag -a v${version} -m "v${version}"`,
);
