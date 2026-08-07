import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, PLUGIN_DIR, readRaw, rel } from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';

/**
 * The npm package ships exactly one executable, and these rules are what let
 * SECURITY.md describe it accurately.
 *
 * The bin exists because `npx @backstage-idp-plugin/backstage-idp` is the first
 * thing people try and npm otherwise answers "could not determine executable to
 * run", which reads as a broken package. That convenience is only acceptable
 * while the script stays inert: it prints and exits.
 */

const BIN = path.join(REPO_ROOT, 'npm', 'bin', 'backstage-idp.mjs');

test('the npm bin exists and is the only executable in the wrapper', () => {
  checkRule(
    'npm-bin-single-entrypoint',
    'npm/bin/ contains exactly one script, and it is the one package.json declares',
    'Every executable in a package published to a public registry is code an adopter runs without reading. One is a documented, auditable convenience; a directory of them is a surface nobody is tracking.',
    (r) => {
      if (!r.require(fs.existsSync(BIN), rel(BIN), {
        found: 'missing',
        expected: 'npm/bin/backstage-idp.mjs',
        fix: 'restore it, or remove the `bin` field from scripts/build-npm-package.mjs and drop these rules',
      })) return;

      const dir = path.dirname(BIN);
      const entries = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
      r.require(entries.length === 1, rel(dir), {
        found: `${entries.length} file(s): ${entries.join(', ')}`,
        expected: 'exactly one',
        fix: 'keep the published executable surface to a single auditable file',
      });
    },
  );
});

// The properties SECURITY.md promises about this file. Written as forbidden
// capabilities rather than as a description, so the promise is checkable.
const FORBIDDEN = [
  { what: 'filesystem writes', re: /\b(?:writeFileSync|writeFile|appendFile|mkdir|rm|rmSync|unlink|createWriteStream|cpSync|copyFile)\b/ },
  // `exec` and `fork` need a lookbehind: `re.exec(str)` is RegExp.prototype.exec
  // and is perfectly inert. Matching it flagged the skill-description parser.
  { what: 'child processes', re: /\bchild_process\b|\b(?:execSync|execFileSync|spawnSync)\b|(?<![.\w])(?:exec|spawn|fork)\s*\(/ },
  { what: 'network access', re: /\b(?:fetch|https?\.(?:get|request)|node:https|node:http|net\.|dgram)\b/ },
  { what: 'dynamic evaluation', re: /\b(?:eval|new Function|vm\.)\b/ },
  { what: 'process mutation', re: /\bprocess\.(?:env\s*\[|chdir|kill|abort)\b/ },
  { what: 'a dependency import', re: /^\s*import\s+[^;]*from\s+['"](?!node:|\.)/m },
];

test('the npm bin only reads and prints', () => {
  checkRule(
    'npm-bin-is-inert',
    'the published executable performs no filesystem writes, no child processes, no network access, no dynamic evaluation, and imports nothing outside node: builtins',
    'SECURITY.md tells adopters this script reads files and writes to stdout and does nothing else. That sentence is only worth printing if something checks it. A published bin is code every `npx` user executes without reading it.',
    (r) => {
      const src = readRaw(BIN);
      // Comments legitimately name these capabilities when explaining why they
      // are absent; strip them before scanning so documentation is not a
      // violation of what it documents.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !/^\s*(?:\/\/|\*)/.test(l))
        .join('\n');

      for (const f of FORBIDDEN) {
        const m = f.re.exec(code);
        r.require(!m, rel(BIN), {
          found: `${f.what}: ${String(m?.[0]).trim()}`,
          expected: 'read-only, stdout-only',
          fix: 'revert it, or change SECURITY.md first — the description of this file is a promise to adopters and must not become false',
        });
      }
    },
  );
});

test('the plugin bundle still contains no executable', () => {
  checkRule(
    'plugin-bundle-stays-code-free',
    'the bin lives in npm/, never inside plugins/backstage-idp/',
    'The .plugin bundle is what Claude Code loads and what an adopter reviews. Keeping it markdown and JSON only is the reason SECURITY.md can say the plugin ships no runtime code — a claim that survives the npm wrapper gaining a bin precisely because the two are separate artifacts.',
    (r) => {
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (!['.md', '.json'].includes(path.extname(e.name))) {
            r.violation(rel(p), {
              found: `extension "${path.extname(e.name) || '(none)'}" inside the plugin bundle`,
              expected: 'markdown and JSON only',
              fix: 'move it to npm/ if it belongs to the npm wrapper; the plugin bundle must stay reviewable as content',
            });
          }
        }
      };
      walk(PLUGIN_DIR);
    },
  );
});

test('SECURITY.md describes the executable it ships', () => {
  checkRule(
    'security-md-documents-the-bin',
    'SECURITY.md names the npm bin and states what it does',
    'The document opens by telling a security reviewer what this package contains. Shipping an executable it does not mention is the single fastest way to lose that reader.',
    (r) => {
      const sec = readRaw(path.join(REPO_ROOT, 'SECURITY.md'));
      for (const needle of ['bin/backstage-idp.mjs', 'stdout']) {
        r.require(sec.includes(needle), 'SECURITY.md', {
          found: `no mention of "${needle}"`,
          expected: 'the bin described explicitly, including what it may and may not do',
          fix: 'describe it; the rules in test/tier0/npm-bin.test.mjs are what keep the description true',
        });
      }
    },
  );
});
