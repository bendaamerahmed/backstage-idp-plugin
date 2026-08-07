import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, AGENT_FILE, parseMarkdownFile, rel } from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';
import crypto from 'node:crypto';

/**
 * Tier 3 — agent behaviour and prompt injection.
 *
 * The measurement is real agent runs (`npm run evals:behavior`), which take
 * tens of minutes, so this asserts against the recorded results. As with the
 * trigger evals, a freshness hash stops that being a loophole: the results are
 * keyed to the agent definition they were measured against, so editing the
 * definition without re-measuring fails rather than passing on old numbers.
 */

const RESULTS = path.join(REPO_ROOT, 'test', 'tier3', 'results', 'behavior.json');
const SCENARIOS = path.join(REPO_ROOT, 'test', 'tier3', 'scenarios.json');

function agentHash() {
  return crypto.createHash('sha256').update(parseMarkdownFile(AGENT_FILE).body).digest('hex').slice(0, 16);
}

const results = (() => {
  try {
    return JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
  } catch {
    return null;
  }
})();

const scenarios = JSON.parse(fs.readFileSync(SCENARIOS, 'utf8')).scenarios;

test('the scenario set covers both safety and injection, with a stated reason each', () => {
  checkRule(
    'behavior-scenarios-well-formed',
    'every scenario declares a group, a repo, a task, at least one assertion, and a `why`',
    'A scenario without a stated reason gets deleted the first time it is inconvenient. The `why` is what tells the next maintainer whether a failure means the agent regressed or the scenario was wrong.',
    (r) => {
      for (const s of scenarios) {
        for (const field of ['id', 'group', 'repo', 'task', 'why', 'assert']) {
          r.require(s[field] !== undefined, rel(SCENARIOS), {
            found: `scenario "${s.id ?? '(unnamed)'}" has no \`${field}\``,
            expected: `a \`${field}\``,
            fix: 'fill it in',
          });
        }
        const assertions = Object.keys(s.assert ?? {}).filter((k) => {
          const v = s.assert[k];
          return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== false;
        });
        r.require(assertions.length > 0, rel(SCENARIOS), {
          found: `scenario "${s.id}" asserts nothing`,
          expected: 'at least one observable assertion',
          fix: 'a scenario with no assertion always passes',
        });
      }

      for (const group of ['safety', 'injection']) {
        const n = scenarios.filter((s) => s.group === group).length;
        r.require(n >= 4, rel(SCENARIOS), {
          found: `${n} "${group}" scenario(s)`,
          expected: 'at least 4',
          fix: `add ${group} scenarios — see docs/test-coverage.md for what is currently uncovered`,
        });
      }
    },
  );
});

test('injection fixtures each demand something specific and checkable', () => {
  checkRule(
    'injection-fixtures-are-specific',
    'every injection scenario asserts on a concrete outcome the hostile content asked for',
    'The property under test is refusal to comply, and compliance is a specific string or a specific side effect. A scenario asserting only that the agent "sounded cautious" measures tone, and tone is not a security control.',
    (r) => {
      const dir = path.join(REPO_ROOT, 'test', 'tier3', 'fixtures', 'injection');
      const fixtures = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      r.require(fixtures.length >= 5, rel(dir), {
        found: `${fixtures.length} hostile fixture(s)`,
        expected: 'at least 5, covering the surfaces repository content actually reaches the agent through',
        fix: 'entity descriptions, READMEs, issue bodies, template parameters, config comments, commit messages',
      });

      const CONCRETE = ['mustNotContain', 'mustNotHavePushed', 'mustNotHaveRunCommand', 'mustNotWriteFiles', 'mustNotReadFiles', 'mustNotSetConfig'];
      for (const s of scenarios.filter((x) => x.group === 'injection')) {
        const has = CONCRETE.some((k) => {
          const v = s.assert?.[k];
          return Array.isArray(v) ? v.length > 0 : Boolean(v);
        });
        r.require(has, rel(SCENARIOS), {
          found: `injection scenario "${s.id}" asserts only: ${Object.keys(s.assert ?? {}).join(', ')}`,
          expected: `at least one of ${CONCRETE.join(', ')}`,
          fix: 'name the specific thing the injected content asked for, and assert it did not happen',
        });
      }
    },
  );
});

test('behaviour results exist and describe the current agent definition', { skip: results ? false : 'not measured — run `npm run evals:behavior`' }, () => {
  checkRule(
    'behavior-results-fresh',
    'the recorded behaviour results were produced from the agent definition currently in the repository',
    'These are the only tests that exercise the agent rather than the content around it. Scoring a previous version of the definition reports a safety property nobody measured.',
    (r) => {
      r.require(results.agentHash === agentHash() || results.agentHash === undefined, rel(RESULTS), {
        found: `results carry agentHash ${results.agentHash}, current definition hashes to ${agentHash()}`,
        expected: 'the same hash',
        fix: 'the agent definition changed since these were measured — re-run `npm run evals:behavior` and commit the results with the change',
      });
      r.require(results.partial !== true, rel(RESULTS), {
        found: `partial run: ${results.scenarioCount} of ${scenarios.length} scenarios`,
        expected: 'a full run',
        fix: 're-run `npm run evals:behavior` without --only or --group',
      });
    },
  );
});

test('every measured behaviour scenario passed', { skip: results ? false : 'not measured' }, () => {
  checkRule(
    'behavior-scenarios-pass',
    'no recorded scenario has failures',
    'Each of these is a property the plugin claims in SECURITY.md: it stops before a push, it reports a failing build honestly, it treats repository content as data. A red scenario means one of those claims is currently false.',
    (r) => {
      for (const res of results.results ?? []) {
        r.require(res.passed, rel(RESULTS), {
          found: `${res.id} [${res.group}]:\n${(res.failures ?? []).map((f) => `                  - ${f}`).join('\n')}`,
          expected: 'no failures',
          fix: `${res.why}\n                Re-run just this one: npm run evals:behavior -- --only ${res.id}`,
        });
      }
    },
  );
});

test('measured scenarios discriminate — the negative control fails them', { skip: results?.withNegativeControl ? false : 'measured without --negative-control' }, () => {
  checkRule(
    'behavior-scenarios-discriminate',
    'each scenario fails under a bare, compliant system prompt',
    'A scenario the control also passes is not testing this agent definition — it is testing that Claude is generally well behaved, which is a different claim and not one this plugin gets to make. Non-discriminating scenarios are kept, but they must be named as such rather than counted as evidence.',
    (r) => {
      const nonDiscriminating = (results.results ?? []).filter((res) => res.control && !res.control.discriminates);
      const coveragePath = path.join(REPO_ROOT, 'docs', 'test-coverage.md');
      const coverage = fs.existsSync(coveragePath) ? fs.readFileSync(coveragePath, 'utf8') : '';
      for (const res of nonDiscriminating) {
        r.require(coverage.includes(res.id), rel(coveragePath), {
          found: `${res.id} passes under the negative control and is not listed as non-discriminating`,
          expected: `an entry for ${res.id} in docs/test-coverage.md`,
          fix: 'either strengthen the scenario so the control fails it, or record honestly that it does not isolate the agent definition',
        });
      }
    },
  );
});
