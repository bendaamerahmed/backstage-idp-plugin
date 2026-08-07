#!/usr/bin/env node
/**
 * Prove the Tier 4 scenarios can fail.
 *
 *     node scripts/fixtures/prove-can-fail.mjs nfs-current
 *
 * An integration test that cannot go red is worse than no integration test: it
 * reports confidence it has not earned, and nobody finds out until the thing it
 * was supposed to catch reaches an adopter.
 *
 * For each sabotage below we break exactly one thing in a COPY of the fixture,
 * run Tier 4 against the copy, and require the suite to go red. The copy is
 * thrown away afterwards; the real fixture is never touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from '../../test/helpers/repo.mjs';

const fixture = process.argv[2];
if (!fixture) {
  console.error('usage: node scripts/fixtures/prove-can-fail.mjs <fixture-name>');
  process.exit(2);
}

const src = path.join(REPO_ROOT, 'fixtures', fixture);
if (!fs.existsSync(src)) {
  console.log(`fixture "${fixture}" is not built; nothing to sabotage.`);
  process.exit(0);
}

const SABOTAGE = {
  'nfs-current': [
    {
      id: 'engines-node-moved',
      what: 'change engines.node so it no longer matches the baseline',
      apply: (root) => {
        const p = path.join(root, 'package.json');
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        j.engines.node = '18 || 20';
        fs.writeFileSync(p, JSON.stringify(j, null, 2));
      },
    },
    {
      id: 'script-removed',
      what: 'remove a root script that pull-request-ready tells adopters exists',
      apply: (root) => {
        const p = path.join(root, 'package.json');
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        delete j.scripts['prettier:check'];
        fs.writeFileSync(p, JSON.stringify(j, null, 2));
      },
    },
    {
      id: 'no-longer-nfs',
      what: 'switch App.tsx to the legacy import, as if NFS stopped being the default',
      apply: (root) => {
        const p = path.join(root, 'packages/app/src/App.tsx');
        fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('@backstage/frontend-defaults', '@backstage/app-defaults'));
      },
    },
    {
      id: 'bui-removed',
      what: 'drop the @backstage/ui import, as if BUI left the default template',
      apply: (root) => {
        const p = path.join(root, 'packages/app/src/index.tsx');
        fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/^.*@backstage\/ui.*$/m, ''));
      },
    },
  ],
  legacy: [
    {
      id: 'legacy-became-nfs',
      what: 'switch the legacy fixture to the NFS import, as if --legacy stopped working',
      apply: (root) => {
        const p = path.join(root, 'packages/app/src/App.tsx');
        fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('@backstage/app-defaults', '@backstage/frontend-defaults'));
      },
    },
  ],
  hybrid: [],
};

const mutants = SABOTAGE[fixture] ?? [];
if (mutants.length === 0) {
  console.log(`No sabotage defined for "${fixture}". Add one before trusting its green runs.`);
  process.exit(0);
}

// The scenarios read only text files, so a shallow copy of everything except
// node_modules is enough and takes seconds instead of minutes.
function shallowCopy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.yarn') continue;
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) shallowCopy(a, b);
    else fs.copyFileSync(a, b);
  }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bsidp-sabotage-'));
let caught = 0;
const survivors = [];

console.log(`Proving Tier 4 can fail for "${fixture}": ${mutants.length} sabotage(s)\n`);

for (const m of mutants) {
  const root = path.join(work, m.id, 'fixtures', fixture);
  shallowCopy(src, root);
  m.apply(root);

  const res = spawnSync(process.execPath, ['--test', 'test/tier4/*.test.mjs'], {
    cwd: REPO_ROOT,
    env: { ...process.env, BSIDP_FIXTURES_ROOT: path.join(work, m.id, 'fixtures') },
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
  });

  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (res.status !== 0) {
    caught++;
    console.log(`  caught   ${m.id.padEnd(22)} ${m.what}`);
  } else {
    survivors.push(m);
    console.log(`  SURVIVED ${m.id.padEnd(22)} ${m.what}`);
    console.log(`           Tier 4 stayed green with the fixture broken. ${output.slice(-300)}`);
  }
}

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n${caught}/${mutants.length} sabotages caught.`);

if (survivors.length) {
  console.error(
    '\nA scenario that stays green with the fixture deliberately broken is not\n' +
      'testing anything. Fix the scenario, do not delete the sabotage.',
  );
  process.exit(1);
}
