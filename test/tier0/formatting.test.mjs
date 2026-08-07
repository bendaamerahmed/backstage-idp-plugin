import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_DIR, rel } from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';

/** Every markdown file that ships inside the plugin bundle. */
function pluginMarkdownFiles(dir = PLUGIN_DIR, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) pluginMarkdownFiles(p, out);
    else if (entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = pluginMarkdownFiles();

// Anything in the emoji and pictograph planes, plus the variation selector and
// the older BMP dingbats/symbols that render as emoji on most terminals.
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

test('plugin markdown contains no emoji', () => {
  checkRule(
    'no-emoji',
    'no markdown file shipped in the plugin contains an emoji or pictograph',
    'Emoji survive tokenisation badly, render inconsistently across the terminals adopters use, and encourage the agent to mirror them back into commit messages and PR bodies.',
    (r) => {
      for (const f of files) {
        fs.readFileSync(f, 'utf8')
          .split(/\r?\n/)
          .forEach((line, i) => {
            const m = EMOJI_RE.exec(line);
            if (m) {
              r.violation(rel(f), {
                line: i + 1,
                found: `${JSON.stringify(m[0])} (U+${m[0].codePointAt(0).toString(16).toUpperCase()}) in: ${line.trim().slice(0, 70)}`,
                expected: 'plain text',
                fix: 'delete the character, or spell out what it meant',
              });
            }
          });
      }
    },
  );
});

test('plugin markdown uses LF line endings only', () => {
  checkRule(
    'lf-line-endings',
    'no markdown file shipped in the plugin contains a CR character',
    'The plugin bundle is consumed on every platform. CRLF leaks into fenced code blocks the agent copies into shell commands, where a trailing \\r turns a valid command into an unknown one.',
    (r) => {
      for (const f of files) {
        const raw = fs.readFileSync(f, 'utf8');
        const idx = raw.indexOf('\r');
        if (idx !== -1) {
          const line = raw.slice(0, idx).split('\n').length;
          const crCount = (raw.match(/\r/g) ?? []).length;
          r.violation(rel(f), {
            line,
            found: `${crCount} carriage return(s), first at line ${line}`,
            expected: 'LF only',
            fix: 'the repository sets `* text=auto eol=lf` in .gitattributes — re-checkout the file, or run `git add --renormalize .`',
          });
        }
      }
    },
  );
});

test('plugin markdown contains no tab characters', () => {
  checkRule(
    'no-tabs',
    'no markdown file shipped in the plugin contains a tab',
    'Markdown list nesting is defined in spaces; a tab renders as an indeterminate width and silently reparents a nested procedure step under the wrong parent.',
    (r) => {
      for (const f of files) {
        fs.readFileSync(f, 'utf8')
          .split(/\r?\n/)
          .forEach((line, i) => {
            if (line.includes('\t')) {
              r.violation(rel(f), {
                line: i + 1,
                found: JSON.stringify(line.slice(0, 70)),
                expected: 'spaces',
                fix: 'replace tabs with spaces (two per nesting level in this repository)',
              });
            }
          });
      }
    },
  );
});

test('plugin markdown has no trailing whitespace', () => {
  checkRule(
    'no-trailing-whitespace',
    'no line in a shipped markdown file ends with a space or tab',
    'Two trailing spaces are a markdown hard line break. Invisible in review, they change rendering and produce diff noise on every later edit.',
    (r) => {
      for (const f of files) {
        fs.readFileSync(f, 'utf8')
          .split(/\r?\n/)
          .forEach((line, i) => {
            if (/[ \t]+$/.test(line)) {
              r.violation(rel(f), {
                line: i + 1,
                found: `${JSON.stringify(line.slice(-30))} — ${/[ \t]+$/.exec(line)[0].length} trailing character(s)`,
                expected: 'no trailing whitespace',
                fix: 'strip it; if a hard break was intended use a blank line instead',
              });
            }
          });
      }
    },
  );
});

test('plugin markdown files end with exactly one newline', () => {
  checkRule(
    'single-trailing-newline',
    'every shipped markdown file ends with exactly one LF',
    'A missing final newline makes the last line of the file — often a `Do not` rule — concatenate with whatever follows it in a bundled context.',
    (r) => {
      for (const f of files) {
        const raw = fs.readFileSync(f, 'utf8');
        if (!raw.endsWith('\n')) {
          r.violation(rel(f), {
            found: 'file does not end with a newline',
            expected: 'exactly one trailing LF',
            fix: 'append a newline',
          });
        } else if (/\n\n+$/.test(raw)) {
          r.violation(rel(f), {
            found: `${/\n+$/.exec(raw)[0].length} trailing newlines`,
            expected: 'exactly one trailing LF',
            fix: 'delete the blank lines at the end of the file',
          });
        }
      }
    },
  );
});

export { pluginMarkdownFiles };
