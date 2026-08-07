#!/usr/bin/env node
/**
 * Strip machine-local paths out of committed eval results.
 *
 *     node scripts/sanitize-results.mjs          # rewrite in place
 *     node scripts/sanitize-results.mjs --check  # fail if anything leaked
 *
 * The eval result files are committed on purpose — the Tier 3 tests assert
 * against them and a freshness hash keys them to the content they measured. But
 * they are produced by running real agents in real scratch directories, so they
 * pick up the home directory, temp paths and CLI locations of whoever ran them.
 *
 * In a public repository that is a small, free disclosure of a contributor's
 * filesystem layout and username, in a file nobody reads closely because it is
 * generated. `--check` runs in CI so it cannot creep back.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { REPO_ROOT, rel } from '../test/helpers/repo.mjs';

const FILES = ['test/tier3/results/latest.json', 'test/tier3/results/behavior.json'];

/**
 * Order matters: the most specific replacement first, so a temp path inside the
 * home directory is not half-rewritten.
 */
function rules() {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const variants = (p) => {
    const win = p.replace(/\//g, '\\');
    return [esc(p), esc(win), esc(win.replace(/\\/g, '\\\\'))];
  };
  const out = [];
  for (const [p, token] of [
    [os.tmpdir().replace(/\\/g, '/'), '<TMP>'],
    [REPO_ROOT.replace(/\\/g, '/'), '<REPO>'],
    [os.homedir().replace(/\\/g, '/'), '<HOME>'],
  ]) {
    for (const v of variants(p)) out.push({ re: new RegExp(v, 'gi'), to: token });
  }
  // A drive-rooted path that survived the above still names someone's machine.
  // The msys/Git-Bash form (`/c/Users/name`) must come FIRST: the generic
  // `/Users/name` rule would otherwise eat its tail and leave `/c<HOME>`, which
  // is not a leak the checker recognises but is still a username on disk.
  out.push({ re: /\/[a-z]\/(?:Users|home)\/[A-Za-z0-9._-]+/gi, to: '<HOME>' });
  out.push({ re: /\b[A-Za-z]:\\\\Users\\\\[^\\"\s]+/g, to: '<HOME>' });
  out.push({ re: /\b[A-Za-z]:\\Users\\[^\\"\s]+/g, to: '<HOME>' });
  out.push({ re: /\b[A-Za-z]:\/Users\/[^/"\s]+/g, to: '<HOME>' });
  out.push({ re: /\/(?:home|Users)\/[A-Za-z0-9._-]+/g, to: '<HOME>' });
  // Whatever form the home directory arrived in, the Windows temp path hangs
  // off it and is still recognisable as a machine layout.
  out.push({ re: /<HOME>[\\/]{1,2}AppData[\\/]{1,2}Local[\\/]{1,2}Temp/gi, to: '<TMP>' });
  return out;
}

/** What still looks like a machine-local path after sanitising. */
const LEAK = /(?:[A-Za-z]:[\\/]{1,2}(?:Users|home)|\/(?:home|Users)\/[A-Za-z0-9._-]+|AppData[\\/]{1,2}Local[\\/]{1,2}Temp)/i;

const check = process.argv.includes('--check');
const R = rules();
let leaked = 0;
let rewritten = 0;

for (const relPath of FILES) {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) continue;
  const before = fs.readFileSync(abs, 'utf8');
  let after = before;
  for (const r of R) after = after.replace(r.re, r.to);

  // Must still be valid JSON — these files are parsed by the Tier 3 tests.
  try {
    JSON.parse(after);
  } catch (err) {
    console.error(`${relPath}: sanitising produced invalid JSON (${err.message}). Left unchanged.`);
    process.exitCode = 1;
    continue;
  }

  if (check) {
    const hits = [...new Set((before.match(new RegExp(LEAK.source, 'gi')) ?? []))];
    if (hits.length) {
      leaked++;
      console.error(`${relPath}: ${hits.length} machine-local path pattern(s) present, e.g. ${hits.slice(0, 3).join(', ')}`);
    }
    continue;
  }

  if (after !== before) {
    fs.writeFileSync(abs, after);
    rewritten++;
    console.log(`  ${rel(abs)}`);
  }
}

if (check) {
  if (leaked) {
    console.error(
      '\nCommitted eval results contain machine-local paths. This repository is public.\n' +
        'Run: node scripts/sanitize-results.mjs',
    );
    process.exit(1);
  }
  console.log('Committed eval results contain no machine-local paths.');
  process.exit(0);
}

console.log(rewritten ? `\n${rewritten} file(s) sanitised.` : 'Nothing to sanitise.');
