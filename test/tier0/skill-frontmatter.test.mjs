import test from 'node:test';
import { listSkills, parseMarkdownFile, rel } from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';

const skills = listSkills();

// Frontmatter keys Claude Code (or the skill-authoring convention this plugin
// follows) actually reads. Anything else is silently ignored at load time,
// which is exactly the kind of thing that wastes an afternoon.
const KNOWN_KEYS = new Set([
  'name',
  'description',
  'when_to_use',
  'allowed-tools',
  'license',
  'metadata',
  'version',
]);

const DESCRIPTION_MAX = 200;
// Claude Code renders `description` + `when_to_use` together in the skill
// listing it shows the model. Past the cap the tail is truncated, and the
// truncated part is usually the disambiguating clause.
const LISTING_MAX = 1536;

test('every skill directory contains a SKILL.md', () => {
  checkRule(
    'skill-file-present',
    'each directory under plugins/backstage-idp/skills/ contains a SKILL.md',
    'Claude Code discovers skills by directory; a directory without SKILL.md is an invisible, unloadable skill.',
    (r) => {
      for (const s of skills) {
        r.require(s.exists, `plugins/backstage-idp/skills/${s.dirName}/`, {
          found: 'directory present, SKILL.md missing',
          expected: `plugins/backstage-idp/skills/${s.dirName}/SKILL.md`,
          fix: 'add the SKILL.md, or delete the directory if the skill was abandoned',
        });
      }
    },
  );
});

test('every SKILL.md has frontmatter that parses as YAML', () => {
  checkRule(
    'skill-frontmatter-parses',
    'the leading --- block of every SKILL.md parses as a YAML mapping',
    'A skill whose frontmatter does not parse is dropped at plugin load with no user-visible error; the skill simply never fires.',
    (r) => {
      for (const s of skills.filter((s) => s.exists)) {
        const p = parseMarkdownFile(s.file);
        r.require(!p.frontmatterError, s.relFile, {
          line: 1,
          found: p.frontmatterError ?? 'ok',
          expected: 'a --- delimited YAML mapping at the very top of the file',
          fix: 'run `node -e "console.log(require(\'yaml\').parse(...))"` on the block to see the parser position',
        });
      }
    },
  );
});

// This rule exists because three skills previously shipped broken exactly this
// way. YAML treats a leading `"` as the start of a quoted scalar, so
//     when_to_use: "create a plugin", "add a plugin"
// is a parse error, not a string. It has to be
//     when_to_use: '"create a plugin", "add a plugin"'
// The generic parse rule above would also catch it, but with a message about
// column offsets rather than about the mistake anyone actually made.
test('no frontmatter value opens with a bare double quote', () => {
  checkRule(
    'skill-frontmatter-quote-trap',
    'no frontmatter scalar begins with a double quote unless the whole scalar is quoted',
    'YAML reads a leading " as the start of a quoted scalar, so a value that merely CONTAINS quoted phrases is a parse error and silently unloads the skill. This has already shipped broken three times.',
    (r) => {
      for (const s of skills.filter((s) => s.exists)) {
        const p = parseMarkdownFile(s.file);
        if (!p.frontmatterRaw) continue;
        const lines = p.frontmatterRaw.split(/\r?\n/);
        lines.forEach((line, i) => {
          const m = /^([A-Za-z0-9_-]+):[ \t]+(.*)$/.exec(line);
          if (!m) return;
          const [, key, value] = m;
          if (!value.startsWith('"')) return;
          // Fine if the scalar is a single well-formed double-quoted string.
          const wellFormed = /^"(?:[^"\\]|\\.)*"[ \t]*$/.test(value);
          r.require(wellFormed, s.relFile, {
            line: 1 + i + 1, // +1 for the opening --- line
            found: `${key}: ${value.slice(0, 80)}${value.length > 80 ? '…' : ''}`,
            expected: `${key}: '…'  (wrap the whole value in single quotes)`,
            fix: `change to  ${key}: '${value.replace(/'/g, "''").slice(0, 60)}…'  — single quotes make the inner double quotes literal`,
          });
        });
      }
    },
  );
});

test('skill name matches its containing directory', () => {
  checkRule(
    'skill-name-matches-directory',
    'frontmatter `name` is identical to the containing directory name',
    'Claude Code resolves a skill by directory but lists it by `name`; a mismatch means the model is told about a skill it cannot invoke.',
    (r) => {
      for (const s of skills.filter((s) => s.exists)) {
        const fm = parseMarkdownFile(s.file).frontmatter;
        if (!fm) continue;
        r.require(fm.name === s.dirName, s.relFile, {
          line: 2,
          found: `name: ${JSON.stringify(fm.name)}`,
          expected: `name: ${s.dirName}`,
          fix: 'rename the directory or the field so they agree — the directory is usually the one that is right',
        });
      }
    },
  );
});

test('skill names are unique and contain no colon', () => {
  checkRule(
    'skill-name-unique-and-colon-free',
    'every skill `name` is unique across the plugin and contains no `:`',
    'Skill invocation is `plugin:skill`; a colon inside a name makes the reference ambiguous, and a duplicate name means one of the two skills is unreachable.',
    (r) => {
      const seen = new Map();
      for (const s of skills.filter((s) => s.exists)) {
        const fm = parseMarkdownFile(s.file).frontmatter;
        if (!fm?.name) continue;
        r.require(!String(fm.name).includes(':'), s.relFile, {
          line: 2,
          found: `name: ${fm.name}`,
          expected: 'a kebab-case name with no colon',
          fix: 'remove the colon; namespacing comes from the plugin, not the skill name',
        });
        if (seen.has(fm.name)) {
          r.violation(s.relFile, {
            line: 2,
            found: `name: ${fm.name}`,
            expected: 'a name not already used by another skill',
            fix: `already declared in ${seen.get(fm.name)} — rename one of them`,
          });
        }
        seen.set(fm.name, s.relFile);
      }
    },
  );
});

test('skill description is present, non-empty, and under the length cap', () => {
  checkRule(
    'skill-description-bounds',
    `frontmatter \`description\` is a non-empty string under ${DESCRIPTION_MAX} characters`,
    'The description is the only thing the model sees when deciding whether to load the skill. Empty means it never fires; overlong means the disambiguating tail is truncated away.',
    (r) => {
      for (const s of skills.filter((s) => s.exists)) {
        const fm = parseMarkdownFile(s.file).frontmatter;
        if (!fm) continue;
        const d = fm.description;
        if (typeof d !== 'string' || d.trim() === '') {
          r.violation(s.relFile, {
            line: 3,
            found: `description: ${JSON.stringify(d)}`,
            expected: 'a non-empty string',
            fix: 'write one sentence: what the skill does, in the words a user would use',
          });
          continue;
        }
        r.require(d.length < DESCRIPTION_MAX, s.relFile, {
          line: 3,
          found: `${d.length} characters`,
          expected: `< ${DESCRIPTION_MAX} characters`,
          fix: 'move the trigger phrasing into `when_to_use` and keep `description` to what it does',
        });
      }
    },
  );
});

test('description plus when_to_use stay under the listing cap', () => {
  checkRule(
    'skill-listing-budget',
    `\`description\` + \`when_to_use\` together are under ${LISTING_MAX} characters`,
    'Both fields are concatenated into the skill listing shown to the model. Past the cap the tail is dropped, and the tail is where the near-miss disambiguation lives.',
    (r) => {
      for (const s of skills.filter((s) => s.exists)) {
        const fm = parseMarkdownFile(s.file).frontmatter;
        if (!fm) continue;
        const total = String(fm.description ?? '').length + String(fm.when_to_use ?? '').length;
        r.require(total < LISTING_MAX, s.relFile, {
          line: 3,
          found: `${total} characters across description + when_to_use`,
          expected: `< ${LISTING_MAX} characters`,
          fix: 'cut the least distinctive trigger phrases from when_to_use first',
        });
      }
    },
  );
});

test('skill frontmatter contains no unrecognised keys', () => {
  checkRule(
    'skill-frontmatter-known-keys',
    `every frontmatter key is one of: ${[...KNOWN_KEYS].sort().join(', ')}`,
    'An unrecognised key is ignored at load time without a warning, so a typo like `when-to-use` reads as a working skill while contributing nothing to triggering.',
    (r) => {
      for (const s of skills.filter((s) => s.exists)) {
        const fm = parseMarkdownFile(s.file).frontmatter;
        if (!fm) continue;
        for (const key of Object.keys(fm)) {
          r.require(KNOWN_KEYS.has(key), s.relFile, {
            line: 1,
            found: `${key}:`,
            expected: `one of ${[...KNOWN_KEYS].sort().join(', ')}`,
            fix: 'fix the typo, or add the key to KNOWN_KEYS in this test with a comment saying what reads it',
          });
        }
      }
    },
  );
});

test('every skill declares when_to_use', () => {
  checkRule(
    'skill-when-to-use-present',
    'every skill declares a non-empty `when_to_use`',
    'Trigger accuracy (Tier 3) is driven almost entirely by when_to_use. A skill without one competes on its description alone and loses every near-miss.',
    (r) => {
      for (const s of skills.filter((s) => s.exists)) {
        const fm = parseMarkdownFile(s.file).frontmatter;
        if (!fm) continue;
        const w = fm.when_to_use;
        r.require(typeof w === 'string' && w.trim() !== '', s.relFile, {
          line: 4,
          found: `when_to_use: ${JSON.stringify(w)}`,
          expected: 'a non-empty string of the phrases a user would actually type',
          fix: 'list real user phrasings, comma separated; see docs/authoring.md',
        });
      }
    },
  );
});

export { skills, rel };
