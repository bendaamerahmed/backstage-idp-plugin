#!/usr/bin/env node
/**
 * Trigger-accuracy evaluation.
 *
 * WHAT THIS MEASURES, precisely: given the skill listing a model actually sees
 * (name + description + when_to_use for all twelve skills) and a user prompt,
 * which skill does it select? That is the decision `description` and
 * `when_to_use` exist to drive, and the one that regresses when someone
 * "tidies" a frontmatter field.
 *
 * WHAT IT DOES NOT MEASURE: whether a full agent turn ends up invoking the
 * skill. That also depends on task complexity and on what else is in context —
 * Claude skips consulting a skill for work it can do directly. An end-to-end
 * trigger eval needs full agent runs per case; this is the selection layer
 * underneath it. docs/test-coverage.md states the gap.
 *
 *     npm run evals                  # full corpus, writes results/latest.json
 *     npm run evals -- --limit 20    # smoke run
 *     npm run evals -- --model claude-sonnet-5
 *
 * Model calls are slow and metered, so results are written to disk and the
 * Tier 3 test asserts against them. The test also fails if the corpus or any
 * skill's frontmatter changed since the results were produced — otherwise a
 * description edit would silently keep passing on last week's numbers.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { REPO_ROOT, loadSkills } from '../test/helpers/repo.mjs';

const execFileAsync = promisify(execFile);

export const CORPUS_FILE = path.join(REPO_ROOT, 'test', 'tier3', 'corpus', 'triggers.json');
export const RESULTS_FILE = path.join(REPO_ROOT, 'test', 'tier3', 'results', 'latest.json');

/**
 * Everything that can change the answer. If this hash moves, the committed
 * results no longer describe the current plugin and the Tier 3 test says so.
 */
export function inputHash() {
  const skills = loadSkills()
    .filter((s) => s.exists)
    .map((s) => ({
      name: s.frontmatter?.name,
      description: s.frontmatter?.description,
      when_to_use: s.frontmatter?.when_to_use,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const corpus = fs.readFileSync(CORPUS_FILE, 'utf8');
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ skills, corpus }))
    .digest('hex')
    .slice(0, 16);
}

/** The listing a model is shown when deciding which skill to consult. */
function skillListing() {
  return loadSkills()
    .filter((s) => s.exists)
    .map(
      (s) =>
        `- ${s.frontmatter.name}\n  description: ${s.frontmatter.description}\n  when_to_use: ${s.frontmatter.when_to_use}`,
    )
    .join('\n');
}

function selectionPrompt(listing, query) {
  return [
    'You route a user request to at most one specialist skill.',
    '',
    'Available skills:',
    listing,
    '',
    'Rules:',
    '- Choose the single skill whose description and when_to_use best fit the request.',
    '- Answer NONE if no skill fits, or if the request is outside Backstage entirely.',
    '- NONE is the right answer more often than it feels. A general engineering question',
    '  that merely mentions a related word is not a match.',
    '',
    'User request:',
    '"""',
    query,
    '"""',
    '',
    'Reply with exactly one line: the skill name, or NONE. No punctuation, no explanation.',
  ].join('\n');
}

const VALID = new Set(loadSkills().filter((s) => s.exists).map((s) => s.dirName));

function parseAnswer(stdout) {
  const line = String(stdout).trim().split('\n').filter(Boolean).pop() ?? '';
  const token = line.trim().replace(/[`."']/g, '');
  if (/^none$/i.test(token)) return null;
  if (VALID.has(token)) return token;
  // Tolerate a model that wraps the answer in a sentence.
  for (const name of VALID) if (new RegExp(`\\b${name}\\b`).test(line)) return name;
  if (/\bnone\b/i.test(line)) return null;
  // A single bare token that is not one of ours is a decline, not a parse
  // failure: the model named something outside this plugin (a skill from its own
  // session, say). For scoring purposes it did not pick one of ours.
  if (/^[a-z][a-z0-9-]{2,40}$/.test(token)) return null;
  return { unparsed: line.slice(0, 120) };
}

/** Most common vote. Objects (errors) lose to any real answer. */
function majority(votes) {
  const real = votes.filter((v) => v === null || typeof v === 'string');
  if (real.length === 0) return votes[0];
  const counts = new Map();
  for (const v of real) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = real[0];
  let bestN = -1;
  for (const v of real) {
    const n = counts.get(v);
    if (n > bestN) {
      bestN = n;
      best = v;
    }
  }
  return best;
}

async function ask(bin, model, prompt) {
  const args = ['-p', prompt];
  if (model) args.push('--model', model);
  const { stdout } = await execFileAsync(bin, args, {
    cwd: REPO_ROOT,
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** Per-skill precision/recall plus the negative-rejection rate. */
export function score(cases, predictions) {
  const skills = [...VALID].sort();
  const perSkill = {};
  for (const name of skills) {
    const tp = cases.filter((c, i) => c.expect === name && predictions[i] === name).length;
    const fp = cases.filter((c, i) => c.expect !== name && predictions[i] === name).length;
    const fn = cases.filter((c, i) => c.expect === name && predictions[i] !== name).length;
    perSkill[name] = {
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precision: tp + fp === 0 ? 1 : tp / (tp + fp),
      recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    };
  }

  const negatives = cases.map((c, i) => ({ c, p: predictions[i] })).filter((x) => x.c.expect === null);
  const negativeRejectionRate =
    negatives.length === 0 ? 1 : negatives.filter((x) => x.p === null).length / negatives.length;

  const nearMisses = cases.map((c, i) => ({ c, p: predictions[i] })).filter((x) => x.c.kind === 'near-miss');
  const nearMissAccuracy =
    nearMisses.length === 0 ? 1 : nearMisses.filter((x) => x.p === x.c.expect).length / nearMisses.length;

  const overallAccuracy = cases.filter((c, i) => predictions[i] === c.expect).length / cases.length;

  return { perSkill, negativeRejectionRate, nearMissAccuracy, overallAccuracy };
}

if (process.argv[1]?.endsWith('run-trigger-evals.mjs')) {
  const argv = process.argv.slice(2);
  const arg = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i === -1 ? fallback : argv[i + 1];
  };

  const bin = process.env.CLAUDE_CLI ?? 'claude';
  const model = arg('--model', process.env.BSIDP_EVAL_MODEL ?? null);
  const limit = Number(arg('--limit', '0')) || 0;
  const repeats = Number(arg('--repeats', '3'));
  const concurrency = Number(arg('--concurrency', '4'));

  const corpus = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8'));
  const cases = limit ? corpus.cases.slice(0, limit) : corpus.cases;
  const listing = skillListing();

  try {
    await execFileAsync(bin, ['--version'], { timeout: 30_000, windowsHide: true });
  } catch {
    console.error(
      [
        `The \`claude\` CLI is required to run trigger evals and was not found (tried "${bin}").`,
        'Install it, or set CLAUDE_CLI to its path:',
        '  CLAUDE_CLI=/path/to/claude npm run evals',
        '',
        'There is no offline substitute. A keyword-overlap proxy would measure the corpus,',
        'not the model, and passing it would mean nothing.',
      ].join('\n'),
    );
    process.exit(2);
  }

  console.log(
    `Running ${cases.length} trigger cases x${repeats} repeats at concurrency ${concurrency}${model ? ` on ${model}` : ''}…`,
  );
  const started = Date.now();
  let done = 0;

  // Selection is non-deterministic. Three single-pass runs over an effectively
  // unchanged corpus produced 90.4%, 89.2% and 87.4% overall accuracy — a three
  // point spread, which is more than enough for a hard threshold to fire on
  // noise and send someone rewriting a description that was never the problem.
  // Each case is asked `repeats` times and the majority answer is taken.
  const predictions = await mapLimit(cases, concurrency, async (c) => {
    const votes = [];
    for (let n = 0; n < repeats; n++) {
      try {
        votes.push(parseAnswer(await ask(bin, model, selectionPrompt(listing, c.query))));
      } catch (err) {
        votes.push({ error: err.message.slice(0, 200) });
      }
    }
    done++;
    if (done % 10 === 0) process.stdout.write(`  ${done}/${cases.length}\n`);
    return majority(votes);
  });

  const clean = predictions.map((p) => (p && typeof p === 'object' ? undefined : p));
  const errors = predictions.map((p, i) => ({ p, c: cases[i] })).filter((x) => x.p && typeof x.p === 'object');

  const results = {
    generatedOn: new Date().toISOString(),
    model: model ?? '(session default)',
    cli: bin,
    inputHash: inputHash(),
    caseCount: cases.length,
    repeats,
    partial: Boolean(limit),
    durationSeconds: Math.round((Date.now() - started) / 1000),
    errors: errors.map((e) => ({ id: e.c.id, problem: e.p })),
    predictions: Object.fromEntries(cases.map((c, i) => [c.id, clean[i] ?? null])),
    scores: score(cases, clean),
    misses: cases
      .map((c, i) => ({ c, p: clean[i] }))
      .filter((x) => x.p !== x.c.expect)
      .map((x) => ({ id: x.c.id, kind: x.c.kind, query: x.c.query, expected: x.c.expect, predicted: x.p, note: x.c.note })),
  };

  fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2) + '\n');

  const s = results.scores;
  console.log('');
  console.log(`overall accuracy      ${(s.overallAccuracy * 100).toFixed(1)}%`);
  console.log(`negative rejection    ${(s.negativeRejectionRate * 100).toFixed(1)}%`);
  console.log(`near-miss accuracy    ${(s.nearMissAccuracy * 100).toFixed(1)}%`);
  console.log('');
  console.log('skill                          precision  recall');
  for (const [name, m] of Object.entries(s.perSkill)) {
    console.log(`  ${name.padEnd(28)} ${(m.precision * 100).toFixed(0).padStart(6)}%  ${(m.recall * 100).toFixed(0).padStart(5)}%`);
  }
  if (results.misses.length) {
    console.log(`\n${results.misses.length} miss(es):`);
    for (const m of results.misses) {
      console.log(`  ${m.id} [${m.kind}] expected ${m.expected ?? 'NONE'}, got ${m.predicted ?? 'NONE'}`);
      console.log(`      ${m.query.slice(0, 100)}`);
    }
  }
  if (errors.length) console.log(`\n${errors.length} case(s) errored — see results/latest.json`);
  console.log(`\nWrote ${path.relative(REPO_ROOT, RESULTS_FILE)} (inputHash ${results.inputHash})`);
}
