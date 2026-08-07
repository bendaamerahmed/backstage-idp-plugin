import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, rel } from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';
import { RESULTS_FILE, CORPUS_FILE, inputHash } from '../../scripts/run-trigger-evals.mjs';

/**
 * Tier 3 — trigger accuracy.
 *
 * The measurement is expensive (167 cases x 3 votes, ~11 minutes of model
 * calls), so it is not run here. `npm run evals` produces
 * test/tier3/results/latest.json and these tests assert against it.
 *
 * The freshness rule below is what stops that being a loophole: the results
 * file records a hash of the corpus plus every skill's description and
 * when_to_use, so editing a description without re-running the evals fails
 * rather than passing on last week's numbers.
 */

const thresholds = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'test', 'tier3', 'thresholds.json'), 'utf8'));

function loadResults() {
  try {
    return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

const results = loadResults();

test('trigger eval results exist and describe the current plugin', () => {
  checkRule(
    'trigger-results-fresh',
    'test/tier3/results/latest.json exists, covers the whole corpus, and was produced from the current skill descriptions',
    'A trigger eval that scores a previous version of the frontmatter is worse than none: it reports a passing grade for text nobody measured. The results file carries a hash of the corpus plus every description and when_to_use, so a one-word edit to a description invalidates it.',
    (r) => {
      if (!r.require(results !== null, rel(RESULTS_FILE), {
        found: 'no results file',
        expected: 'a results file produced by `npm run evals`',
        fix: 'run `npm run evals` (needs the claude CLI; set CLAUDE_CLI if it is not on PATH)',
      })) return;

      const current = inputHash();
      r.require(results.inputHash === current, rel(RESULTS_FILE), {
        found: `results were produced for inputHash ${results.inputHash} on ${results.generatedOn?.slice(0, 10)}`,
        expected: `inputHash ${current}`,
        fix: 'the corpus or a skill description/when_to_use changed since these numbers were measured — re-run `npm run evals` and commit the new results with the content change',
      });

      r.require(results.partial !== true, rel(RESULTS_FILE), {
        found: `partial run: ${results.caseCount} of the corpus`,
        expected: 'a full-corpus run',
        fix: 're-run `npm run evals` without --limit',
      });

      const corpus = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8'));
      r.require(results.caseCount === corpus.cases.length, rel(RESULTS_FILE), {
        found: `${results.caseCount} cases scored, corpus has ${corpus.cases.length}`,
        expected: 'every case scored',
        fix: 're-run `npm run evals`',
      });

      r.require((results.repeats ?? 1) >= 3, rel(RESULTS_FILE), {
        found: `repeats: ${results.repeats ?? 1}`,
        expected: 'at least 3 votes per case',
        fix: 'single-pass scoring had a 3-point run-to-run spread on an unchanged corpus, which makes a hard floor a coin flip — re-run with --repeats 3',
      });

      r.require((results.errors ?? []).length === 0, rel(RESULTS_FILE), {
        found: `${(results.errors ?? []).length} case(s) errored: ${(results.errors ?? []).map((e) => e.id).join(', ')}`,
        expected: 'no errored cases',
        fix: 'an errored case is scored as a miss and quietly depresses recall — investigate and re-run',
      });
    },
  );
});

test('the corpus still covers every skill and keeps its negatives', () => {
  checkRule(
    'trigger-corpus-shape',
    'the corpus has at least 8 positive cases per skill, at least 30 negatives, and at least 10 near-misses',
    'Coverage per skill is what makes a per-skill recall floor meaningful. The negatives are what stop the whole set being gamed by a plugin that fires on everything — without them, 100% recall is achievable by always guessing.',
    (r) => {
      const corpus = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8'));
      const bySkill = new Map();
      for (const c of corpus.cases) {
        if (!c.expect) continue;
        bySkill.set(c.expect, (bySkill.get(c.expect) ?? 0) + 1);
      }
      const skillDirs = fs
        .readdirSync(path.join(REPO_ROOT, 'plugins', 'backstage-idp', 'skills'), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

      for (const name of skillDirs) {
        const n = bySkill.get(name) ?? 0;
        r.require(n >= 8, rel(CORPUS_FILE), {
          found: `${n} positive case(s) for ${name}`,
          expected: 'at least 8',
          fix: `add cases for ${name} — with fewer than 8, one miss moves recall by more than a floor's worth`,
        });
      }
      for (const name of bySkill.keys()) {
        r.require(skillDirs.includes(name), rel(CORPUS_FILE), {
          found: `corpus expects skill "${name}" which does not ship`,
          expected: 'every expected skill to exist',
          fix: 'fix the label or ship the skill',
        });
      }

      const negatives = corpus.cases.filter((c) => c.expect === null).length;
      r.require(negatives >= 30, rel(CORPUS_FILE), {
        found: `${negatives} negatives`,
        expected: 'at least 30',
        fix: 'add near-miss negatives — adjacent platform-engineering questions, not obviously irrelevant ones',
      });

      const nearMisses = corpus.cases.filter((c) => c.kind === 'near-miss').length;
      r.require(nearMisses >= 10, rel(CORPUS_FILE), {
        found: `${nearMisses} near-miss cases`,
        expected: 'at least 10',
        fix: 'add cases where two of our own skills genuinely compete — that is where the descriptions actually get tested',
      });
    },
  );
});

test('trigger accuracy meets the committed floors', { skip: results ? false : 'no results file' }, () => {
  const f = thresholds.floors;
  const s = results.scores;

  checkRule(
    'trigger-accuracy-floors',
    `overall >= ${f.overallAccuracy}, negative rejection >= ${f.negativeRejectionRate}, near-miss >= ${f.nearMissAccuracy}, per-skill precision >= ${f.perSkillPrecision} and recall >= ${f.perSkillRecall}`,
    'A skill that never fires is dead weight; one that fires on everything is noise that displaces the answer the user wanted. These floors are the only thing keeping either from happening silently, because both failures look identical from inside the repository.',
    (r) => {
      const pct = (x) => `${(x * 100).toFixed(1)}%`;

      r.require(s.overallAccuracy >= f.overallAccuracy, 'test/tier3/thresholds.json', {
        found: `overall accuracy ${pct(s.overallAccuracy)} (measured ${results.generatedOn?.slice(0, 10)} on ${results.model})`,
        expected: `>= ${pct(f.overallAccuracy)}`,
        fix: 'read the `misses` array in results/latest.json — the fix is usually a description or when_to_use, not a skill body',
      });

      r.require(s.negativeRejectionRate >= f.negativeRejectionRate, 'test/tier3/thresholds.json', {
        found: `negative rejection ${pct(s.negativeRejectionRate)}`,
        expected: `>= ${pct(f.negativeRejectionRate)}`,
        fix: 'a skill is claiming work that is not Backstage. Narrow the over-broad when_to_use — check the misses with kind "negative"',
      });

      r.require(s.nearMissAccuracy >= f.nearMissAccuracy, 'test/tier3/thresholds.json', {
        found: `near-miss accuracy ${pct(s.nearMissAccuracy)}`,
        expected: `>= ${pct(f.nearMissAccuracy)}`,
        fix: 'two skills are claiming the same ground. Give each an explicit boundary clause in when_to_use, the way backstage-incident-debug defers once the failing layer is known',
      });

      for (const [name, m] of Object.entries(s.perSkill)) {
        r.require(m.precision >= f.perSkillPrecision, 'test/tier3/thresholds.json', {
          found: `${name} precision ${pct(m.precision)} (${m.falsePositives} false positive(s))`,
          expected: `>= ${pct(f.perSkillPrecision)}`,
          fix: `${name} is being selected for work it does not do. Its when_to_use is over-broad — add a boundary clause saying what to use instead`,
        });
        r.require(m.recall >= f.perSkillRecall, 'test/tier3/thresholds.json', {
          found: `${name} recall ${pct(m.recall)} (${m.falseNegatives} missed)`,
          expected: `>= ${pct(f.perSkillRecall)}`,
          fix: `${name} is not being selected for its own work. Add the user phrasings from the misses to its when_to_use`,
        });
      }
    },
  );
});

test('the recorded observations have not silently drifted from the floors', { skip: results ? false : 'no results' }, () => {
  checkRule(
    'thresholds-not-quietly-raised-to-fit',
    'each floor sits at least 3 points below the observed value recorded alongside it',
    'The failure mode of a committed threshold is someone raising the floor to whatever the last run produced. That makes the next green run luck rather than evidence, and the floor stops detecting anything.',
    (r) => {
      const f = thresholds.floors;
      const o = thresholds.observed;
      for (const key of ['overallAccuracy', 'negativeRejectionRate', 'nearMissAccuracy']) {
        r.require(o[key] - f[key] >= 0.03, 'test/tier3/thresholds.json', {
          found: `floor ${f[key]} vs observed ${o[key]} (headroom ${((o[key] - f[key]) * 100).toFixed(1)} points)`,
          expected: 'at least 3 points of headroom',
          fix: 'lower the floor, or improve the content until the observed value rises — do not close the gap by raising the floor',
        });
      }
    },
  );
});
