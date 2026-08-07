import test from 'node:test';
import path from 'node:path';
import { loadSkills, loadAgent, listSkills, proseLines, headings, readRaw, PLUGIN_DIR } from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';

const skills = loadSkills().filter((s) => s.exists);
const agent = loadAgent();
const skillNames = new Set(listSkills().map((s) => s.dirName));

// Backticked tokens that look like a sibling skill: kebab-case, at least two
// segments, and either starting with `backstage-` or already a known skill.
// Deliberately narrow — `catalog-info.yaml` and `app-config.local.yaml` are not
// skill references and must not be treated as broken ones.
const CANDIDATE_RE = /`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g;

// Things that share the `backstage-` prefix but are not skills: the plugin
// itself, the agent, and Backstage's own artefacts. Listed explicitly so a
// genuine typo (`backstage-catalogue`) is still caught.
const NOT_SKILLS = new Set([
  'backstage-idp', // the plugin
  'backstage-fullstack-developer', // the agent
  'backstage-cli', // the Backstage CLI binary
  'backstage-community', // the community-plugins scope
]);

function looksLikeSkillReference(token) {
  if (skillNames.has(token)) return true;
  if (NOT_SKILLS.has(token)) return false;
  if (!token.startsWith('backstage-')) return false;
  // Exclude filenames and config-ish tokens that share the prefix.
  if (/\.(ya?ml|json|md|tsx?|js)$/.test(token)) return false;
  return true;
}

test('every sibling-skill reference resolves to a skill that exists', () => {
  checkRule(
    'skill-cross-reference-resolves',
    'every backticked token that names a sibling skill corresponds to a directory under skills/',
    'A skill referred to by name but not shipped is an instruction the agent cannot follow. It will either invent the procedure or stall, and neither failure names the missing skill.',
    (r) => {
      const sources = [...skills, agent];
      for (const src of sources) {
        for (const line of proseLines(src)) {
          for (const m of line.text.matchAll(CANDIDATE_RE)) {
            const token = m[1];
            if (!looksLikeSkillReference(token)) continue;
            if (skillNames.has(token)) continue;
            r.violation(src.relFile, {
              line: line.line,
              found: `\`${token}\``,
              expected: `a skill directory plugins/backstage-idp/skills/${token}/`,
              fix: `either create the skill, rename the reference to an existing one (${[...skillNames].sort().join(', ')}), or stop back-quoting the phrase if it is not a skill reference`,
            });
          }
        }
      }
    },
  );
});

test('a skill never references itself as a sibling', () => {
  checkRule(
    'skill-no-self-reference',
    'no SKILL.md refers to its own name as though it were another skill to invoke',
    'A self-reference reads to the agent as "delegate to this skill", which it is already inside. The observed behaviour is a redundant reload that displaces task context.',
    (r) => {
      for (const s of skills) {
        for (const line of proseLines(s)) {
          for (const m of line.text.matchAll(CANDIDATE_RE)) {
            if (m[1] !== s.dirName) continue;
            // Naming yourself in the H1 or in a "see also" list is fine; the
            // problem is an imperative. Flag only lines that read as a call.
            if (!/\b(see|use|invoke|run|call|hand (?:it |this )?(?:off |back )?to|delegate)\b/i.test(line.text)) continue;
            r.violation(s.relFile, {
              line: line.line,
              found: line.text.trim().slice(0, 100),
              expected: `no imperative reference to \`${s.dirName}\` from inside itself`,
              fix: 'describe the step inline instead of delegating to the skill already running',
            });
          }
        }
      }
    },
  );
});

/** The `### \`skill-name\`` entries under agent §16. */
function agentListedSkills() {
  const hs = headings(agent);
  const start = hs.find((h) => h.level === 2 && /^16\./.test(h.text));
  if (!start) return null;
  const next = hs.find((h) => h.level === 2 && h.line > start.line);
  const end = next ? next.line : Infinity;
  return hs
    .filter((h) => h.level === 3 && h.line > start.line && h.line < end)
    .map((h) => ({ name: h.text.replace(/`/g, '').trim(), line: h.line }));
}

test('agent section 16 and the shipped skills match in both directions', () => {
  checkRule(
    'agent-skill-list-matches-shipped',
    'the set of skills listed under agent §16 is exactly the set of directories under skills/',
    'Both directions are defects. A listed-but-missing skill is an instruction the agent cannot follow. A shipped-but-unlisted skill is dead weight — the agent has no reason to reach for it, so it never fires and never gets maintained.',
    (r) => {
      const listed = agentListedSkills();
      if (!r.require(listed !== null, agent.relFile, {
        found: 'no "## 16." section found in the agent definition',
        expected: 'a section 16 listing the shipped skills as `### `skill-name`` entries',
        fix: 'restore the section, or update this test if the section was deliberately renumbered',
      })) return;

      const listedNames = new Set(listed.map((l) => l.name));

      for (const l of listed) {
        r.require(skillNames.has(l.name), agent.relFile, {
          line: l.line,
          found: `§16 lists \`${l.name}\``,
          expected: `plugins/backstage-idp/skills/${l.name}/SKILL.md to exist`,
          fix: 'ship the skill, or remove it from §16 — the agent treats §16 as an inventory, not a wishlist',
        });
      }

      for (const name of [...skillNames].sort()) {
        r.require(listedNames.has(name), agent.relFile, {
          found: `skills/${name}/ ships but §16 does not list it`,
          expected: `a "### \`${name}\`" entry under §16`,
          fix: 'add it to §16 with its purpose; an unlisted skill is one the agent has no reason to invoke',
        });
      }
    },
  );
});

test('section 16 states its own count correctly', () => {
  checkRule(
    'agent-skill-count-accurate',
    'any number-of-skills claim in §16 matches how many skills actually ship',
    'The count is prose an adopter reads and a reviewer checks. Saying "twelve" while shipping eleven is the cheapest possible way to look unmaintained.',
    (r) => {
      const words = {
        eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
        fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
      };
      const actual = skillNames.size;
      const idx = agent.raw.indexOf('## 16.');
      const sec = idx === -1 ? '' : agent.raw.slice(idx, agent.raw.indexOf('\n## ', idx + 5));
      const claim = new RegExp(`\\b(${Object.keys(words).join('|')}|\\d{1,2})\\s+skills?\\b`, 'i').exec(sec);
      if (!claim) return; // no claim made, nothing to contradict
      const claimed = words[claim[1].toLowerCase()] ?? Number(claim[1]);
      r.require(claimed === actual, agent.relFile, {
        found: `§16 claims "${claim[0]}"`,
        expected: `${actual} skills`,
        fix: `update the wording to match the ${actual} directories under skills/`,
      });
    },
  );
});

test('the plugin README lists exactly the shipped skills', () => {
  checkRule(
    'readme-skill-list-matches-shipped',
    'the plugin README mentions every shipped skill and no skill that does not ship',
    'The README is what an adopting team reads before installing. A skill it advertises but does not ship is the first thing they will try and the first thing that fails.',
    (r) => {
      const text = readRaw(path.join(PLUGIN_DIR, 'README.md'));
      for (const name of [...skillNames].sort()) {
        r.require(text.includes(name), 'plugins/backstage-idp/README.md', {
          found: `no mention of "${name}"`,
          expected: `the README to describe ${name}`,
          fix: 'add it to the skills table',
        });
      }
      for (const m of text.matchAll(CANDIDATE_RE)) {
        const token = m[1];
        if (!looksLikeSkillReference(token) || skillNames.has(token)) continue;
        r.violation('plugins/backstage-idp/README.md', {
          found: `\`${token}\``,
          expected: 'a skill that ships',
          fix: 'remove the entry or ship the skill',
        });
      }
    },
  );
});
