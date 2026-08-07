import test from 'node:test';
import { listSkills, parseMarkdownFile, headings, section } from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';

const skills = listSkills().filter((s) => s.exists);

// The authoring contract. Order is load-bearing: an agent reading the file
// top-to-bottom must learn what must already be true, then what to do, then how
// to know it worked, then how it goes wrong, then what is forbidden. Moving
// `Do not` above `Procedure` measurably changes behaviour — see docs/authoring.md.
export const REQUIRED_SECTIONS = [
  'Preconditions',
  'Procedure',
  'Verification',
  'Failure modes',
  'Do not',
];

// Below the floor a skill is not carrying enough procedure to beat the model's
// own priors; above the ceiling it stops being read in full.
export const MIN_LINES = 90;
export const MAX_LINES = 175;

const PLACEHOLDERS = [
  { token: 'TODO', re: /\bTODO\b/ },
  { token: 'TBD', re: /\bTBD\b/ },
  { token: 'FIXME', re: /\bFIXME\b/ },
  { token: 'XXX', re: /\bXXX\b/ },
  { token: '<placeholder>', re: /<placeholder>/i },
  { token: 'Lorem', re: /\bLorem\b/i },
];

test('required sections appear exactly once, in order', () => {
  checkRule(
    'skill-required-sections',
    `every SKILL.md has the level-2 headings ${REQUIRED_SECTIONS.join(' → ')}, each exactly once and in that order`,
    'The agent reads these positionally. A missing `Verification` means it declares success without checking; a missing `Do not` means the destructive-action guardrails are absent from the one place it looks for them.',
    (r) => {
      for (const s of skills) {
        const parsed = parseMarkdownFile(s.file);
        const h2 = headings(parsed).filter((h) => h.level === 2);
        const present = h2.map((h) => h.text);

        for (const required of REQUIRED_SECTIONS) {
          const count = present.filter((t) => t === required).length;
          if (count !== 1) {
            r.violation(s.relFile, {
              found: `## ${required} appears ${count} time(s)`,
              expected: `## ${required} appears exactly once`,
              fix:
                count === 0
                  ? `add a "## ${required}" section — see docs/authoring.md for what belongs in it`
                  : 'merge the duplicate sections',
            });
          }
        }

        // Order check, over the required headings that are actually present.
        const seq = present.filter((t) => REQUIRED_SECTIONS.includes(t));
        const expectedSeq = REQUIRED_SECTIONS.filter((t) => seq.includes(t));
        if (seq.join('|') !== expectedSeq.join('|')) {
          r.violation(s.relFile, {
            line: h2[0]?.line,
            found: seq.join(' → '),
            expected: expectedSeq.join(' → '),
            fix: 'reorder the sections; the agent reads them positionally',
          });
        }
      }
    },
  );
});

test('the Procedure section is a numbered list', () => {
  checkRule(
    'skill-procedure-is-numbered',
    'the first non-blank content line under `## Procedure` starts a numbered list, and the list numbers ascend from 1',
    'A procedure written as prose or bullets gives the agent no ordering to follow and no step to name when it reports where it stopped. Step numbers are how a BLOCKED report stays actionable.',
    (r) => {
      for (const s of skills) {
        const parsed = parseMarkdownFile(s.file);
        const proc = section(parsed, 'Procedure');
        if (!proc) continue; // already reported by skill-required-sections

        const content = proc.filter((l) => l.text.trim() !== '');
        if (content.length === 0) {
          r.violation(s.relFile, { found: 'empty Procedure section', expected: 'a numbered list', fix: 'write the steps' });
          continue;
        }
        const first = content[0];
        if (!/^\s{0,3}1[.)]\s/.test(first.text)) {
          r.violation(s.relFile, {
            line: first.line,
            found: first.text.slice(0, 80),
            expected: 'the section to open with `1. `',
            fix: 'convert the steps to an ordered list starting at 1',
          });
          continue;
        }
        // Top-level ordered items only (indent < 4 spaces); require 1..n ascending.
        const numbers = proc
          .map((l) => ({ l, m: /^\s{0,3}(\d+)[.)]\s/.exec(l.text) }))
          .filter((x) => x.m)
          .map((x) => ({ line: x.l.line, n: Number(x.m[1]) }));
        numbers.forEach((item, i) => {
          if (item.n !== i + 1) {
            r.violation(s.relFile, {
              line: item.line,
              found: `step numbered ${item.n}`,
              expected: `step numbered ${i + 1}`,
              fix: 'renumber the list; gaps and repeats break references from the completion report',
            });
          }
        });
      }
    },
  );
});

test('skill length stays inside the authoring bounds', () => {
  checkRule(
    'skill-length-bounds',
    `every SKILL.md is between ${MIN_LINES} and ${MAX_LINES} lines inclusive`,
    'Under the floor a skill adds nothing the model did not already infer. Over the ceiling it competes with the task context for attention and the later sections stop being applied.',
    (r) => {
      for (const s of skills) {
        const parsed = parseMarkdownFile(s.file);
        // Count as a text file would: a trailing newline does not add a line.
        const count = parsed.raw.replace(/\n$/, '').split('\n').length;
        r.require(count >= MIN_LINES && count <= MAX_LINES, s.relFile, {
          found: `${count} lines`,
          expected: `${MIN_LINES}–${MAX_LINES} lines`,
          fix:
            count < MIN_LINES
              ? 'the skill is thin — add the failure modes and verification steps that are missing'
              : 'split a distinct workflow into its own skill, or cut examples that restate the procedure',
        });
      }
    },
  );
});

test('no placeholder residue anywhere in the plugin markdown', () => {
  checkRule(
    'skill-no-placeholder-residue',
    `no SKILL.md contains ${PLACEHOLDERS.map((p) => p.token).join(', ')}`,
    'A placeholder that ships reads to the agent as an instruction it cannot satisfy, and to an adopter as evidence the plugin is unfinished.',
    (r) => {
      for (const s of skills) {
        const parsed = parseMarkdownFile(s.file);
        parsed.raw.split(/\r?\n/).forEach((line, i) => {
          for (const p of PLACEHOLDERS) {
            if (p.re.test(line)) {
              r.violation(s.relFile, {
                line: i + 1,
                found: line.trim().slice(0, 90),
                expected: `no "${p.token}"`,
                fix: 'finish the thought or delete the line',
              });
            }
          }
        });
      }
    },
  );
});

test('every skill opens with a single H1 before the first required section', () => {
  checkRule(
    'skill-single-h1',
    'every SKILL.md has exactly one level-1 heading, and it precedes `## Preconditions`',
    'More than one H1 makes the document read as two skills concatenated, and the sections after the second H1 are attributed to the wrong procedure.',
    (r) => {
      for (const s of skills) {
        const parsed = parseMarkdownFile(s.file);
        const hs = headings(parsed);
        const h1s = hs.filter((h) => h.level === 1);
        if (!r.require(h1s.length === 1, s.relFile, {
          found: `${h1s.length} level-1 headings${h1s.length ? `: ${h1s.map((h) => h.text).join(', ')}` : ''}`,
          expected: 'exactly one',
          fix: 'demote the extras to `##`',
        })) continue;
        const pre = hs.find((h) => h.level === 2 && h.text === 'Preconditions');
        if (pre) {
          r.require(h1s[0].line < pre.line, s.relFile, {
            line: h1s[0].line,
            found: `H1 at line ${h1s[0].line}, ## Preconditions at line ${pre.line}`,
            expected: 'the H1 to come first',
            fix: 'move the title above the first section',
          });
        }
      }
    },
  );
});
