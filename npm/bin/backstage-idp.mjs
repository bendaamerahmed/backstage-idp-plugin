#!/usr/bin/env node
/**
 * The only executable in this package.
 *
 * It exists because `npx @backstage-idp-plugin/backstage-idp` is the first thing
 * people try, and without a bin npm answers "could not determine executable to
 * run" — which reads as a broken package rather than as "this is not a CLI".
 *
 * Deliberate constraints, asserted by test/tier0/npm-bin.test.mjs:
 *
 *   - It writes to stdout and nothing else. No filesystem writes, no network,
 *     no child processes, no environment reads beyond argv.
 *   - It has no dependencies.
 *   - It lives in the npm wrapper, NOT in plugins/backstage-idp/. The .plugin
 *     bundle an adopter installs into Claude Code remains markdown and JSON
 *     only, which is what `plugin-bundle-contents` enforces.
 *
 * If you extend this, keep those properties. SECURITY.md describes this file to
 * adopters and the description has to stay true.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const manifest = JSON.parse(read('.claude-plugin/plugin.json'));

function skills() {
  const dir = path.join(ROOT, 'skills');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const file = path.join(dir, e.name, 'SKILL.md');
      let description = '';
      try {
        const m = /^description:\s*(.+)$/m.exec(fs.readFileSync(file, 'utf8').slice(0, 4000));
        if (m) description = m[1].replace(/^["']|["']$/g, '').trim();
      } catch {
        /* a skill without a readable SKILL.md is Tier 0's problem, not this script's */
      }
      return { name: e.name, description };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const REPO = 'bendaamerahmed/backstage-idp-plugin';

function usage() {
  const list = skills();
  return [
    '',
    `  ${manifest.displayName ?? manifest.name} ${manifest.version}`,
    `  ${manifest.description}`,
    '',
    '  This is a Claude Code plugin, not a command-line tool. There is nothing',
    '  to run here — the package contains markdown that Claude Code loads.',
    '',
    '  Install it into Claude Code:',
    '',
    `    /plugin marketplace add ${REPO}`,
    `    /plugin install ${manifest.name}`,
    '',
    '  Or from a terminal:',
    '',
    `    claude plugin marketplace add ${REPO}`,
    `    claude plugin install ${manifest.name}@backstage-idp-marketplace`,
    '',
    '  Update later (the marketplace-qualified name is required):',
    '',
    `    claude plugin update ${manifest.name}@backstage-idp-marketplace`,
    '',
    `  Commands:  --list   the ${list.length} skills and what each is for`,
    '             --path   where these files are on disk',
    '             --json   the plugin manifest',
    '',
    `  Docs: https://github.com/${REPO}#readme`,
    '',
  ].join('\n');
}

function listSkills() {
  const list = skills();
  const out = ['', `  ${list.length} skills`, ''];
  const width = Math.max(...list.map((s) => s.name.length));
  for (const s of list) {
    // Keep the first sentence; the full description is in the SKILL.md.
    const first = s.description.split(/(?<=\.)\s/)[0] ?? s.description;
    out.push(`  ${s.name.padEnd(width)}  ${first.slice(0, 96)}`);
  }
  out.push('', `  Agent: ${manifest.name === 'backstage-idp' ? 'backstage-fullstack-developer' : '(see agents/)'}`, '');
  return out.join('\n');
}

const arg = (process.argv[2] ?? '').replace(/^--?/, '');

switch (arg) {
  case 'list':
  case 'skills':
    process.stdout.write(listSkills());
    break;
  case 'path':
    process.stdout.write(`${ROOT}\n`);
    break;
  case 'json':
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    break;
  case 'version':
  case 'v':
    process.stdout.write(`${manifest.version}\n`);
    break;
  default:
    process.stdout.write(usage());
}
