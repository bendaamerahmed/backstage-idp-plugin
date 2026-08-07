import test from 'node:test';
import { loadSkills, loadAgent, proseLines, section, headings } from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';

const skills = loadSkills().filter((s) => s.exists);
const agent = loadAgent();

// The mutation verbs named in the brief.
export const MUTATION_VERBS = ['push', 'merge', 'deploy', 'publish', 'delete', 'drop', 'truncate', 'rotate'];

/**
 * Commands that actually mutate something outside the working tree.
 *
 * The brief asks for every *occurrence of a mutation verb* to be gated. Applied
 * literally to prose that fires 89 times across the twelve skills, almost all of
 * it descriptive — "the publisher publishes to the bucket", "entities deleted
 * after refresh", "a merge base". Gating a noun is meaningless, and a rule that
 * fires 89 times gets suppressed rather than fixed.
 *
 * So the rule is applied in command position: a mutation verb inside a code span
 * or fence, in a shape that would execute. That is the set of occurrences where
 * "is this gated?" is a real question. The prose occurrences are covered
 * instead by `skill-has-authorization-stop` below, which asks the per-skill
 * question the brief is actually after.
 *
 * This deviation is recorded in docs/test-coverage.md.
 */
const MUTATING_COMMANDS = [
  { re: /\bgit\s+push\b/, what: 'git push' },
  // `merge` but not `merge-base`, which is a read.
  { re: /\bgit\s+merge(?![-\w])/, what: 'git merge' },
  { re: /\bgit\s+(?:rebase|commit)\b[^`]*--(?:force|amend)/, what: 'history rewrite' },
  { re: /\bgh\s+pr\s+(?:create|merge|review|close)\b/, what: 'gh pr mutation' },
  { re: /\bgh\s+release\s+(?:create|upload|delete)\b/, what: 'gh release mutation' },
  { re: /\b(?:npm|yarn)\s+publish\b/, what: 'package publish' },
  { re: /\bdocker\s+push\b/, what: 'docker push' },
  { re: /\bkubectl\s+(?:apply|delete|rollout|scale|patch)\b/, what: 'kubectl mutation' },
  { re: /\bhelm\s+(?:install|upgrade|uninstall|rollback)\b/, what: 'helm mutation' },
  { re: /\b(?:DROP|TRUNCATE)\s+(?:TABLE|DATABASE|SCHEMA)\b/i, what: 'destructive SQL' },
  { re: /\bDELETE\s+FROM\b/i, what: 'destructive SQL' },
  { re: /\baws\s+s3\s+(?:rm|sync|cp)\b/, what: 'object-store mutation' },
  { re: /\bgsutil\s+(?:rm|cp|rsync)\b/, what: 'object-store mutation' },
  { re: /\bcurl\b[^`]*-X\s*(?:POST|PUT|PATCH|DELETE)/i, what: 'mutating HTTP request' },
  { re: /\b@techdocs\/cli\s+publish\b/, what: 'techdocs publish' },
  // Deliberately NOT here: `versions:bump`, `repo fix`, `yarn install`. They
  // rewrite the working tree, which the agent is already authorised to do, and
  // are trivially revertible with git. Gating them would train the reader that
  // the gate is bureaucratic rather than load-bearing.
];

/**
 * Text that constitutes an authorization gate. Deliberately broad — the point is
 * that a human decision is required before the command runs, however that is
 * phrased.
 */
const AUTHORIZATION_MARKER =
  /\b(?:authoriz|authoris|BLOCKED|do not run|does not run|never run|stop\b|stops\b|return (?:the |these )?command|hand (?:it |them |the command |this )?back|without running|explicit(?:ly)? approv|requires? approval|ask(?:s)? (?:a|the) human|for authorization)/i;

/** All code spans and fenced lines in a parsed file, with line numbers. */
function commandBearingLines(parsed) {
  const lines = parsed.body.split(/\r?\n/);
  const out = [];
  let inFence = false;
  lines.forEach((line, i) => {
    const fenceLine = /^\s{0,4}(?:`{3,}|~{3,})/.test(line);
    if (fenceLine) {
      inFence = !inFence;
      return;
    }
    const fileLine = parsed.bodyOffsetLine + i;
    if (inFence) {
      out.push({ text: line, line: fileLine, kind: 'fence' });
      return;
    }
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      out.push({ text: m[1], line: fileLine, kind: 'span' });
    }
  });
  return out;
}

/**
 * The block a line belongs to: the enclosing top-level numbered procedure step
 * with all its continuation lines, or — outside a numbered list — the two lines
 * either side, widened past fence delimiters, which carry no prose.
 *
 * Using the step rather than a fixed window is what makes the rule mean
 * something: "the step that runs this command must gate it", not "an
 * authorization word must happen to be nearby".
 */
function enclosingBlock(rawLines, lineNumber) {
  const idx = lineNumber - 1;
  const isStepStart = (i) => /^\s{0,3}\d+[.)]\s/.test(rawLines[i] ?? '');
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    if (/^#{1,6}\s/.test(rawLines[i] ?? '')) break; // do not cross a heading
    if (isStepStart(i)) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    const from = Math.max(0, idx - 4);
    const to = Math.min(rawLines.length, idx + 5);
    return rawLines.slice(from, to).join('\n');
  }
  let end = start + 1;
  while (end < rawLines.length && !isStepStart(end) && !/^#{1,6}\s/.test(rawLines[end])) end++;
  return rawLines.slice(start, end).join('\n');
}

/** The line ranges covered by `## Do not` sections. */
function doNotRanges(parsed) {
  const hs = headings(parsed);
  const ranges = [];
  hs.forEach((h, i) => {
    if (h.level !== 2 || h.text !== 'Do not') return;
    const next = hs.slice(i + 1).find((x) => x.level <= 2);
    ranges.push([h.line, next ? next.line : Infinity]);
  });
  return ranges;
}

test('every mutating command in a skill is gated', () => {
  checkRule(
    'mutation-commands-gated',
    'every command that mutates something outside the working tree sits in a `Do not` section, or within two lines of an explicit authorization instruction',
    'The agent runs commands it finds in a procedure. An ungated `git push` in step 14 is not advice — it is an instruction, and the agent has no interactive channel to check first. Every one of these has to be either forbidden outright or staged and handed back.',
    (r) => {
      for (const s of [...skills, agent]) {
        const forbidden = doNotRanges(s);
        const all = proseLines(s);
        const rawLines = s.raw.split(/\r?\n/);
        for (const cmd of commandBearingLines(s)) {
          const hit = MUTATING_COMMANDS.find((c) => c.re.test(cmd.text));
          if (!hit) continue;
          if (forbidden.some(([a, b]) => cmd.line > a && cmd.line < b)) continue;

          const context = enclosingBlock(rawLines, cmd.line);
          if (AUTHORIZATION_MARKER.test(context)) continue;

          r.violation(s.relFile, {
            line: cmd.line,
            found: `${hit.what}: ${cmd.text.trim().slice(0, 90)}`,
            expected: 'a `Do not` section, or an authorization instruction within two lines',
            fix: 'either move it under `## Do not`, or add the stop — e.g. "Do not run these. Report the branch and the exact commands, then return for authorization."',
          });
        }
        void all;
      }
    },
  );
});

/**
 * Which skills can touch something outside the working tree at all. Derived
 * from content, not from a hand-maintained list, so a skill that grows an
 * external-system step gets pulled into the rule automatically.
 */
const EXTERNAL_SYSTEM_SIGNAL =
  /\b(?:production|staging|remote|origin\/|shared environment|object store|bucket|s3|gcs|azure blob|kubernetes|cluster|identity provider|IdP|webhook|registry|deploy|publish|push)\b/i;

test('every skill that can touch an external system stops for authorization', () => {
  checkRule(
    'skill-has-authorization-stop',
    'a skill whose content shows it can reach outside the working tree contains at least one explicit stop-for-authorization instruction',
    'The agent has no interactive channel. A skill that can mutate a shared system and never says "stop here" will not stop — there is nothing in the procedure telling it to, and §5.6 only fires on decisions it cannot infer, not on decisions it can.',
    (r) => {
      for (const s of skills) {
        const text = proseLines(s).map((l) => l.text).join('\n');
        if (!EXTERNAL_SYSTEM_SIGNAL.test(text)) continue;
        const hasStop = AUTHORIZATION_MARKER.test(text);
        r.require(hasStop, s.relFile, {
          found: 'reaches external systems (matched: ' +
            [...new Set([...text.matchAll(new RegExp(EXTERNAL_SYSTEM_SIGNAL.source, 'gi'))].map((m) => m[0].toLowerCase()))].slice(0, 6).join(', ') +
            ') but contains no authorization stop',
          expected: 'at least one instruction to stop and hand back rather than act',
          fix: 'add the stop to `## Do not` and to the step that reaches the system; see pull-request-ready step 15 for the shape',
        });
      }
    },
  );
});

test('no skill instructs asking the user a question mid-run', () => {
  checkRule(
    'no-mid-run-questions',
    'no skill instructs the agent to ask the user, prompt the user, or wait for an answer',
    'AskUserQuestion is stripped from every subagent. An instruction to ask is a latent hang: the agent either prints a question and returns as though it were answered, or invents a default silently. The designed alternative is a structured BLOCKED report. See ADR-0003.',
    (r) => {
      const ASK = [
        { re: /\bAskUserQuestion\b/, what: 'AskUserQuestion (unavailable to subagents)' },
        { re: /\bask the (?:user|human|operator)\b/i, what: 'ask the user' },
        { re: /\bprompt the (?:user|human|operator)\b/i, what: 'prompt the user' },
        { re: /\bwait for (?:the )?(?:user|human|a reply|an answer|confirmation)\b/i, what: 'wait for an answer' },
        { re: /\bpause (?:and|until) (?:ask|the user|confirm)/i, what: 'pause and ask' },
      ];
      for (const s of [...skills, agent]) {
        for (const line of proseLines(s)) {
          for (const a of ASK) {
            if (!a.re.test(line.text)) continue;
            // Documenting that the channel does not exist is the correct form,
            // and is exactly what the agent definition and ADR-0003 do.
            if (
              /\b(?:do not|don't|never|cannot|can not|no way to|without|unavailable|not available|absent|removed|stripped|intentionally|does not exist|no interactive)\b/i.test(
                line.text,
              )
            ) continue;
            r.violation(s.relFile, {
              line: line.line,
              found: `${a.what} — ${line.text.trim().slice(0, 100)}`,
              expected: 'a BLOCKED report instead of a question',
              fix: 'rewrite as: decide from evidence, or stop and return a `## BLOCKED` report naming the specific unknown',
            });
          }
        }
      }
    },
  );
});

test('the agent defines the BLOCKED report it tells skills to return', () => {
  checkRule(
    'blocked-report-defined',
    'the agent definition specifies the structure of the BLOCKED report, and includes an Assumptions section in its completion report',
    'Skills hand control back with "return BLOCKED". If the agent has no template for that, the report is freeform and the caller cannot tell a blocker from a failure. Assumptions is the only place a wrong inference surfaces before it compounds, since there is no interactive channel.',
    (r) => {
      r.require(/##\s*BLOCKED/.test(agent.raw), agent.relFile, {
        found: 'no "## BLOCKED" template in the agent definition',
        expected: 'an explicit BLOCKED report structure',
        fix: 'define it in §5.6; skills across the plugin instruct returning it',
      });
      r.require(/##\s*Assumptions/.test(agent.raw), agent.relFile, {
        found: 'no "## Assumptions" heading in the completion report template',
        expected: 'an Assumptions section in the §26 report template',
        fix: 'restore it — with no interactive channel this is the only place a wrong inference is visible before it compounds',
      });
    },
  );
});

export { AUTHORIZATION_MARKER, MUTATING_COMMANDS, doNotRanges, commandBearingLines };
