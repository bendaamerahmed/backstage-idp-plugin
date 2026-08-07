import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, loadBaseline, rel } from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';
import { FIXTURES, FIXTURES_DIR, fixtureStamp, fixtureIsFresh } from '../../scripts/fixtures/build-all.mjs';

/**
 * Tier 4 — integration against a real Backstage monorepo. Nightly.
 *
 * The tier that makes the rest credible. Every assertion here runs the
 * FIXTURE'S OWN toolchain — its tsc, its lint, its test, its build — never the
 * agent's prose. If a scenario's only evidence is something the agent said, it
 * belongs in Tier 3.
 *
 * The fixtures are real `create-app` trees and take tens of minutes to build,
 * so they are cached under fixtures/ and this suite SKIPS with an explicit
 * command when they are absent. A skip here is recorded in
 * docs/test-coverage.md as a known conditional gap; it is never silent.
 */

const baseline = loadBaseline();

function fixtureAvailable(name) {
  return fs.existsSync(path.join(FIXTURES_DIR, name, 'package.json')) && fixtureIsFresh(name);
}

function skipReason(name) {
  const dir = path.join(FIXTURES_DIR, name);
  if (!fs.existsSync(dir)) {
    return `fixture "${name}" not built. Run: npm run fixtures:build -- ${name}  (real create-app, several minutes and ~1GB)`;
  }
  const stamp = fixtureStamp(name);
  if (!stamp) return `fixture "${name}" has no stamp file — it is a partial build. Run: npm run fixtures:build -- ${name} --force`;
  return (
    `fixture "${name}" was built for release line ${stamp.releaseLine}, baseline is ${baseline.release.currentLine}. ` +
    `Run: npm run fixtures:build -- ${name} --force`
  );
}

/** Run one of the fixture's own commands and return its real result. */
export function inFixture(name, script, { timeout = 20 * 60 * 1000 } = {}) {
  const cwd = path.join(FIXTURES_DIR, name);
  const yarn = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  const res = spawnSync(yarn, script.split(' '), {
    cwd,
    encoding: 'utf8',
    timeout,
    stdio: 'pipe',
    // Yarn Berry ships as a .cjs in .yarn/releases; when the shim is
    // unavailable, fall back to invoking it through node directly.
    shell: false,
  });
  if (res.error?.code === 'ENOENT' || res.error?.code === 'EINVAL') {
    const berry = path.join(cwd, '.yarn', 'releases');
    const rel0 = fs.existsSync(berry) && fs.readdirSync(berry).find((f) => f.endsWith('.cjs'));
    if (rel0) {
      const r2 = spawnSync(process.execPath, [path.join(berry, rel0), ...script.split(' ')], {
        cwd,
        encoding: 'utf8',
        timeout,
        stdio: 'pipe',
      });
      return { status: r2.status, stdout: r2.stdout ?? '', stderr: r2.stderr ?? '', command: `yarn ${script}` };
    }
  }
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', command: `yarn ${script}` };
}

/**
 * A command's real result, formatted so a failure names the command, the exit
 * code and the tail of its output. "expected 0 to be 0" is useless at 3am.
 */
function requireExitZero(r, result, fixtureName, why) {
  const tail = `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-25).join('\n');
  r.require(result.status === 0, `fixtures/${fixtureName}`, {
    found: `${result.command} exited ${result.status}`,
    expected: 'exit 0',
    fix: `${why}\n                last 25 lines:\n${tail.split('\n').map((l) => `                  ${l}`).join('\n')}`,
  });
}

// ---------------------------------------------------------------------------
// Fixture integrity. These run whether or not the fixtures exist.
// ---------------------------------------------------------------------------

test('every declared fixture is either built and current, or skipped with a command', () => {
  const report = Object.keys(FIXTURES).map((name) => ({
    name,
    available: fixtureAvailable(name),
    reason: fixtureAvailable(name) ? null : skipReason(name),
  }));

  const missing = report.filter((f) => !f.available);
  if (missing.length) {
    console.warn('\n  [tier4] SKIPPED — fixtures not available:');
    for (const f of missing) console.warn(`    ${f.reason}`);
    console.warn('  These scenarios are recorded as conditional gaps in docs/test-coverage.md.\n');
  }

  checkRule(
    'tier4-fixture-inventory',
    'every fixture named in FIXTURES has a build recipe and a skip message naming the command that would build it',
    'A silently skipped integration tier reads as a passing integration tier. Every skip has to state which fixture is missing and exactly how to get it.',
    (r) => {
      for (const name of Object.keys(FIXTURES)) {
        const spec = FIXTURES[name];
        r.require(Boolean(spec.description && spec.expect), 'scripts/fixtures/build-all.mjs', {
          found: `fixture "${name}" has no description or expectation`,
          expected: 'both, so a failure says what the fixture was for',
          fix: 'fill in the spec',
        });
      }
      for (const f of report) {
        if (f.available) continue;
        r.require(/npm run fixtures:build/.test(f.reason), 'test/tier4/integration.test.mjs', {
          found: `skip reason for "${f.name}" does not name a command`,
          expected: 'a runnable command in the skip message',
          fix: 'a skip that does not tell you how to un-skip it is a skip nobody ever resolves',
        });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Scenarios.
//
// Each declares the skill it exercises, the fixture it needs, and an assertion
// evaluated by the fixture's own toolchain. `breakFirst` is the deliberate
// sabotage used by `npm run test:tier4 -- --prove-can-fail` to confirm the
// scenario is capable of going red before its green run is trusted.
// ---------------------------------------------------------------------------

export const SCENARIOS = [
  {
    id: 'baseline-toolchain',
    skill: 'backstage-quality-gate',
    fixture: 'nfs-current',
    what: 'the fixture builds and type-checks before any scenario touches it',
    run: (r) => {
      requireExitZero(r, inFixture('nfs-current', 'tsc'), 'nfs-current', 'A fresh create-app must type-check. If this fails, every later scenario is measuring a broken fixture, not the plugin.');
    },
  },
  {
    id: 'discovery-facts-are-true',
    skill: 'backstage-repo-discovery',
    fixture: 'nfs-current',
    what: 'the facts backstage-repo-discovery instructs the agent to read are actually present and say what Section 0 claims',
    run: (r) => {
      const dir = path.join(FIXTURES_DIR, 'nfs-current');
      const stamp = fixtureStamp('nfs-current');

      // backstage.json is the release-line anchor the skill leads with.
      const bs = JSON.parse(fs.readFileSync(path.join(dir, 'backstage.json'), 'utf8'));
      r.require(typeof bs.version === 'string', 'fixtures/nfs-current/backstage.json', {
        found: JSON.stringify(bs),
        expected: 'a `version` field',
        fix: 'backstage-repo-discovery step 1 reads this as the release-line anchor',
      });

      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

      // Section 0 and baseline.json both claim Node 22 || 24.
      r.require(pkg.engines?.node === baseline.node.enginesRange, 'fixtures/nfs-current/package.json', {
        found: `engines.node = ${JSON.stringify(pkg.engines?.node)}`,
        expected: baseline.node.enginesRange,
        fix: 'Section 0 and baseline.node disagree with a real create-app; update both, citing the fixture',
      });

      // The script list pull-request-ready enumerates for adopters.
      const actual = Object.keys(pkg.scripts ?? {});
      for (const s of baseline.createApp.rootScripts) {
        r.require(actual.includes(s), 'fixtures/nfs-current/package.json', {
          found: `no "${s}" script; the fixture has: ${actual.join(', ')}`,
          expected: `a "${s}" script`,
          fix: 'pull-request-ready step 2 tells adopters this script exists in a default repo',
        });
      }

      // NFS by import source, which is what the skill insists on.
      const appTsx = fs.readFileSync(path.join(dir, 'packages/app/src/App.tsx'), 'utf8');
      r.require(/@backstage\/frontend-defaults/.test(appTsx), 'fixtures/nfs-current/packages/app/src/App.tsx', {
        found: appTsx.split('\n').slice(0, 3).join(' | '),
        expected: "createApp imported from '@backstage/frontend-defaults'",
        fix: 'Section 0 claims NFS is the default for new apps; a fresh create-app disagrees',
      });

      const backendIndex = fs.readFileSync(path.join(dir, 'packages/backend/src/index.ts'), 'utf8');
      r.require(/createBackend/.test(backendIndex), 'fixtures/nfs-current/packages/backend/src/index.ts', {
        found: backendIndex.split('\n').slice(0, 5).join(' | '),
        expected: 'createBackend() from @backstage/backend-defaults',
        fix: 'the new backend system is the default the skills assume',
      });

      r.require(stamp.expect.frontend === 'nfs', `fixtures/nfs-current/.fixture-stamp.json`, {
        found: JSON.stringify(stamp.expect),
        expected: 'frontend: nfs',
        fix: 'the fixture was built with the wrong flags',
      });
    },
  },
  {
    id: 'bui-in-default-template',
    skill: 'backstage-plugin-migrate',
    fixture: 'nfs-current',
    what: '@backstage/ui really is in the default template, which is what makes the MUI-to-BUI guidance current rather than speculative',
    run: (r) => {
      const dir = path.join(FIXTURES_DIR, 'nfs-current');
      const indexTsx = fs.readFileSync(path.join(dir, 'packages/app/src/index.tsx'), 'utf8');
      r.require(/@backstage\/ui/.test(indexTsx), 'fixtures/nfs-current/packages/app/src/index.tsx', {
        found: indexTsx.trim(),
        expected: "an import from '@backstage/ui'",
        fix: 'baseline.uiLibrary.inDefaultTemplate claims BUI ships in the default app. If a real create-app no longer imports it, that claim and the migrate skill both need re-verifying.',
      });
    },
  },
  {
    id: 'kubernetes-config-surface',
    skill: 'backstage-kubernetes',
    fixture: 'nfs-current',
    what: 'the Kubernetes config keys the skill instructs writing exist in the published config schema for the installed plugin version',
    run: (r) => {
      // The fixture does not install the Kubernetes plugin, so its schema is
      // fetched from the registry rather than from node_modules. That keeps the
      // assertion honest: it checks the version an adopter would install, not a
      // version this fixture happens to pin.
      const cached = path.join(FIXTURES_DIR, 'nfs-current', '.kubernetes-config.schema.json');
      if (!fs.existsSync(cached)) {
        r.violation('fixtures/nfs-current', {
          found: 'no cached kubernetes config schema',
          expected: '.kubernetes-config.schema.json alongside the fixture',
          fix: 'run `node scripts/fixtures/fetch-kubernetes-schema.mjs` — the fixture build does this, so a missing file means the fixture predates the scenario',
        });
        return;
      }
      const schema = JSON.parse(fs.readFileSync(cached, 'utf8'));
      const k = schema.properties?.kubernetes?.properties ?? {};

      for (const key of ['clusterLocatorMethods', 'serviceLocatorMethod', 'customResources', 'objectTypes']) {
        r.require(k[key] !== undefined, 'plugins/backstage-idp/skills/backstage-kubernetes/SKILL.md', {
          found: `kubernetes.${key} is not in the published config schema`,
          expected: 'the key the skill tells the agent to write',
          fix: 'the plugin moved; re-verify the skill against the installed config.schema.json',
        });
      }

      // The skill states customResources takes exactly group/apiVersion/plural,
      // all required, and that apiVersion is the version alone. Getting this
      // wrong is a silent no-match rather than an error, so it is worth pinning.
      const cr = k.customResources?.items?.required ?? [];
      r.require(
        ['group', 'apiVersion', 'plural'].every((f) => cr.includes(f)) && cr.length === 3,
        'plugins/backstage-idp/skills/backstage-kubernetes/SKILL.md',
        {
          found: `customResources required fields: [${cr.join(', ')}]`,
          expected: 'exactly group, apiVersion, plural',
          fix: 'step 7 of backstage-kubernetes enumerates these; update it and this assertion together',
        },
      );

      // objectTypes is an enum, and the skill lists it. A value the skill names
      // that the schema rejects would fail config:check for the adopter.
      const objectTypes = k.objectTypes?.items?.enum ?? [];
      const skillText = fs.readFileSync(
        path.join(REPO_ROOT, 'plugins/backstage-idp/skills/backstage-kubernetes/SKILL.md'),
        'utf8',
      );
      for (const named of [...skillText.matchAll(/`(pods|services|configmaps|deployments|statefulsets|daemonsets|ingresses|jobs|cronjobs|replicasets|horizontalpodautoscalers|limitranges|resourcequotas|customresources)`/g)]) {
        r.require(objectTypes.includes(named[1]), 'plugins/backstage-idp/skills/backstage-kubernetes/SKILL.md', {
          found: `the skill names objectType "${named[1]}", which the schema does not accept`,
          expected: `one of: ${objectTypes.join(', ')}`,
          fix: 'remove it, or update the list if the schema gained it under a different name',
        });
      }
    },
  },
  {
    id: 'legacy-fixture-is-actually-legacy',
    skill: 'backstage-repo-discovery',
    fixture: 'legacy',
    what: 'create-app --legacy produces the legacy composition the skills describe, so legacy guidance is testable at all',
    run: (r) => {
      const dir = path.join(FIXTURES_DIR, 'legacy');
      const appTsx = fs.readFileSync(path.join(dir, 'packages/app/src/App.tsx'), 'utf8');
      r.require(/@backstage\/app-defaults/.test(appTsx), 'fixtures/legacy/packages/app/src/App.tsx', {
        found: appTsx.split('\n').slice(0, 5).join(' | '),
        expected: "createApp imported from '@backstage/app-defaults'",
        fix: 'the --legacy flag no longer produces a legacy frontend; every legacy branch in the skills is now untestable and Section 0 needs re-verifying',
      });
      r.require(/FlatRoutes/.test(appTsx), 'fixtures/legacy/packages/app/src/App.tsx', {
        found: 'no <FlatRoutes> in App.tsx',
        expected: '<FlatRoutes>, the legacy marker backstage-repo-discovery step 4 keys on',
        fix: 'update the detection guidance in backstage-repo-discovery',
      });
    },
  },
];

for (const scenario of SCENARIOS) {
  const available = fixtureAvailable(scenario.fixture);
  test(
    `[${scenario.skill}] ${scenario.what}`,
    { skip: available ? false : skipReason(scenario.fixture), timeout: 25 * 60 * 1000 },
    () => {
      checkRule(
        `tier4-${scenario.id}`,
        scenario.what,
        `Asserted against fixtures/${scenario.fixture} using the repository's own toolchain, not the agent's description of what it did.`,
        (r) => scenario.run(r),
      );
    },
  );
}

test('every skill has at least one Tier 3 or Tier 4 scenario, or is declared unverified', () => {
  checkRule(
    'every-skill-has-a-scenario',
    'each shipped skill appears in a Tier 4 scenario, in the Tier 3 trigger corpus, or in the unverified list in docs/test-coverage.md',
    'A skill with no scenario anywhere is unverified content that reads exactly like verified content. If it cannot be covered yet, it has to be named as uncovered where an adopter will see it.',
    (r) => {
      const skillDirs = fs
        .readdirSync(path.join(REPO_ROOT, 'plugins', 'backstage-idp', 'skills'), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

      const tier4 = new Set(SCENARIOS.map((s) => s.skill));
      const corpus = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'test', 'tier3', 'corpus', 'triggers.json'), 'utf8'),
      );
      const tier3 = new Set(corpus.cases.map((c) => c.expect).filter(Boolean));

      const coveragePath = path.join(REPO_ROOT, 'docs', 'test-coverage.md');
      const coverage = fs.existsSync(coveragePath) ? fs.readFileSync(coveragePath, 'utf8') : '';

      for (const name of skillDirs) {
        const covered = tier4.has(name) || tier3.has(name);
        r.require(covered || coverage.includes(name), rel(coveragePath), {
          found: `${name} has no Tier 4 scenario, no Tier 3 corpus case, and no entry in docs/test-coverage.md`,
          expected: 'coverage, or an honest statement that it has none',
          fix: 'add a scenario, or list the skill under the unverified section of docs/test-coverage.md with the reason',
        });
      }
    },
  );
});
