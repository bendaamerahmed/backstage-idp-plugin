#!/usr/bin/env node
/**
 * Build the Tier 4 integration fixtures: real Backstage monorepos.
 *
 *     npm run fixtures:build              # all three
 *     npm run fixtures:build -- nfs-current
 *     npm run fixtures:build -- --force   # rebuild even if cached
 *
 * These are genuine `create-app` trees with a full install. That is minutes and
 * hundreds of megabytes each, so they are cached under fixtures/ (gitignored)
 * and keyed by the release line they were built for. Nothing in Tier 4 asserts
 * on the agent's prose — every scenario is judged by running the FIXTURE'S OWN
 * tsc, lint, test and build. That is the whole point of the tier: the
 * repository's toolchain is a referee we do not control.
 *
 * `--legacy` builds the legacy-frontend variant. There is no supported flag for
 * a hybrid app, so `hybrid` is derived from `nfs-current` by wiring a legacy
 * plugin through the compatibility layer — see docs/test-coverage.md for what
 * that does and does not prove.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { REPO_ROOT, loadBaseline, rel } from '../../test/helpers/repo.mjs';

/**
 * Where fixtures live. BSIDP_FIXTURES_ROOT redirects Tier 4 at a different set,
 * which is how scripts/fixtures/prove-can-fail.mjs runs the suite against a
 * deliberately sabotaged copy without touching the real fixture.
 */
export const FIXTURES_DIR = process.env.BSIDP_FIXTURES_ROOT ?? path.join(REPO_ROOT, 'fixtures');
const baseline = loadBaseline();

/**
 * The legacy line is pinned rather than tracking latest: the point of the
 * fixture is to exercise guidance written for an older generation, and a
 * floating pin would silently become a second copy of nfs-current.
 */
export const FIXTURES = {
  'nfs-current': {
    description: 'fresh create-app on the current line, New Frontend System',
    createAppVersion: 'latest',
    createAppFlags: [],
    expect: { frontend: 'nfs', backend: 'new' },
  },
  legacy: {
    description: 'create-app --legacy: legacy frontend system, new backend system',
    createAppVersion: 'latest',
    createAppFlags: ['--legacy'],
    expect: { frontend: 'legacy', backend: 'new' },
  },
  hybrid: {
    description: 'NFS app hosting a legacy plugin through @backstage/core-compat-api',
    derivedFrom: 'nfs-current',
    expect: { frontend: 'hybrid', backend: 'new' },
  },
};

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: opts.quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    timeout: opts.timeout ?? 40 * 60 * 1000,
    ...opts,
  });
  if (res.error) throw res.error;
  return res;
}

/**
 * npx, resolved to its JS entrypoint so no shell is involved and arguments are
 * never concatenated.
 */
function npxArgv(args) {
  const npxCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (fs.existsSync(npxCli)) return [process.execPath, [npxCli, ...args]];
  return [process.platform === 'win32' ? 'npx.cmd' : 'npx', args];
}

/**
 * Run a command that PROMPTS, feeding answers on stdin.
 *
 * `spawnSync`'s `input` option closes stdin the instant it is written, and
 * inquirer — which create-app uses for its single "Enter a name for the app"
 * prompt — treats that as a force-close and dies with ERR_USE_AFTER_CLOSE
 * before it has read anything. The stream has to stay open for the life of the
 * process, so this writes the answer and then simply leaves it open.
 */
function runInteractive(cmd, args, { answers = [], timeout = 45 * 60 * 1000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timed out after ${Math.round(timeout / 60000)} minutes`));
    }, timeout);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status });
    });
    for (const a of answers) child.stdin.write(`${a}\n`);
    // Deliberately NOT calling child.stdin.end().
  });
}

function stampFile(dir) {
  return path.join(dir, '.fixture-stamp.json');
}

export function fixtureStamp(name) {
  const dir = path.join(FIXTURES_DIR, name);
  try {
    return JSON.parse(fs.readFileSync(stampFile(dir), 'utf8'));
  } catch {
    return null;
  }
}

export function fixtureIsFresh(name) {
  const stamp = fixtureStamp(name);
  if (!stamp) return false;
  // A fixture built for a different release line is not the fixture the
  // scenarios were written against.
  return stamp.releaseLine === baseline.release.currentLine;
}

async function buildCreateApp(name, spec, { force }) {
  const dir = path.join(FIXTURES_DIR, name);
  if (fixtureIsFresh(name) && !force) {
    console.log(`  ${name}: cached (release line ${fixtureStamp(name).releaseLine})`);
    return dir;
  }

  console.log(`  ${name}: building — ${spec.description}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  // create-app has exactly one prompt ("Enter a name for the app") and a --path
  // flag for the location. There is no non-interactive flag for the name, so it
  // is answered on stdin — see runInteractive for why stdin must stay open.
  const [cmd, args] = npxArgv([
    '--yes',
    `@backstage/create-app@${spec.createAppVersion}`,
    '--path',
    dir,
    ...spec.createAppFlags,
  ]);
  const res = await runInteractive(cmd, args, { answers: [name] });
  if (res.status !== 0) {
    throw new Error(
      `create-app failed for ${name} (exit ${res.status}).\n` +
        'If this is a network or registry failure, retry. If create-app changed its prompts, ' +
        'this script needs updating — see docs/runbook.md.',
    );
  }

  const backstageJson = JSON.parse(fs.readFileSync(path.join(dir, 'backstage.json'), 'utf8'));
  fs.writeFileSync(
    stampFile(dir),
    JSON.stringify(
      {
        name,
        description: spec.description,
        builtOn: new Date().toISOString(),
        backstageVersion: backstageJson.version,
        releaseLine: backstageJson.version.split('.').slice(0, 2).join('.'),
        expect: spec.expect,
        createAppFlags: spec.createAppFlags,
      },
      null,
      2,
    ) + '\n',
  );
  return dir;
}

async function buildHybrid(spec, opts) {
  const base = path.join(FIXTURES_DIR, spec.derivedFrom);
  const dir = path.join(FIXTURES_DIR, 'hybrid');
  if (fixtureIsFresh('hybrid') && !opts.force) {
    console.log(`  hybrid: cached (release line ${fixtureStamp('hybrid').releaseLine})`);
    return dir;
  }
  if (!fs.existsSync(base)) throw new Error(`hybrid derives from ${spec.derivedFrom}, which has not been built`);

  console.log('  hybrid: deriving from nfs-current');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(base, dir, { recursive: true });

  // Mark it so a scenario cannot mistake it for the NFS fixture. The actual
  // legacy-plugin wiring is applied per scenario, because which plugin gets
  // bridged is part of what the scenario is testing.
  const stamp = JSON.parse(fs.readFileSync(stampFile(dir), 'utf8'));
  fs.writeFileSync(
    stampFile(dir),
    JSON.stringify({ ...stamp, name: 'hybrid', description: spec.description, expect: spec.expect, derivedFrom: spec.derivedFrom }, null, 2) + '\n',
  );
  return dir;
}

if (process.argv[1]?.endsWith('build-all.mjs')) {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const wanted = argv.filter((a) => !a.startsWith('--'));
  const names = wanted.length ? wanted : Object.keys(FIXTURES);

  for (const n of names) {
    if (!FIXTURES[n]) {
      console.error(`unknown fixture "${n}". Known: ${Object.keys(FIXTURES).join(', ')}`);
      process.exit(2);
    }
  }

  console.log(`Building fixtures into ${rel(FIXTURES_DIR)} (baseline release line ${baseline.release.currentLine})\n`);
  // hybrid must come last; it copies nfs-current.
  const ordered = names.sort((a, b) => (a === 'hybrid' ? 1 : b === 'hybrid' ? -1 : 0));

  for (const name of ordered) {
    const spec = FIXTURES[name];
    try {
      if (spec.derivedFrom) await buildHybrid(spec, { force });
      else await buildCreateApp(name, spec, { force });
    } catch (err) {
      console.error(`\n  ${name}: FAILED — ${err.message}`);
      process.exitCode = 1;
    }
  }

  console.log('\nFixtures:');
  for (const name of Object.keys(FIXTURES)) {
    const s = fixtureStamp(name);
    console.log(`  ${name.padEnd(14)} ${s ? `${s.backstageVersion} built ${s.builtOn.slice(0, 10)}` : 'not built'}`);
  }
}
