#!/usr/bin/env node
/**
 * Scrape every machine-checkable fact the plugin asserts.
 *
 * This is the input to baseline.json and to the Tier 1 / Tier 2 checks. It is a
 * script rather than a test so a maintainer can run it after editing content and
 * diff the result against the committed baseline:
 *
 *     node scripts/extract-assertions.mjs --diff
 *
 * It reads only the shipped plugin markdown, never the tests or docs — a fact
 * that lives in a doc is not something the agent will act on.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_DIR, REPO_ROOT, rel } from '../test/helpers/repo.mjs';

function markdownFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) markdownFiles(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const FILES = markdownFiles(PLUGIN_DIR);

/** Occurrences of a regex across the plugin, with file:line provenance. */
export function scan(re, pick = (m) => m[0]) {
  const hits = new Map();
  for (const file of FILES) {
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
        let m;
        while ((m = rx.exec(line)) !== null) {
          const value = pick(m);
          if (!value) continue;
          if (!hits.has(value)) hits.set(value, []);
          const where = `${rel(file)}:${i + 1}`;
          if (!hits.get(value).includes(where)) hits.get(value).push(where);
        }
      });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// npm package names
// ---------------------------------------------------------------------------
// Matches scoped Backstage packages wherever they appear — prose, backticks or
// code fences. A wildcard suffix (`@backstage/plugin-auth-backend-module-*`) is
// a family reference, not a package, and is excluded from registry checks.
const PACKAGE_RE = /@(?:backstage|backstage-community|techdocs|roadiehq|spotify)\/[a-z0-9][a-z0-9._-]*\*?/;

export function packages() {
  const out = [];
  for (const [name, where] of scan(PACKAGE_RE)) {
    // Trailing punctuation swept up from prose.
    const clean = name.replace(/[.,;:)]+$/, '');
    // `@backstage/plugin-auth-backend-module-*` and the bare `@backstage/core-`
    // left behind when the `*` is outside the backticks both name a family, not
    // a package. They are recorded but never sent to the registry.
    const wildcard = clean.endsWith('*') || clean.endsWith('-');
    out.push({
      name: clean.replace(/[*-]+$/, (s) => (s.includes('*') ? '*' : '-')),
      wildcard,
      occurrences: where.length,
      firstSeen: where[0],
    });
  }
  return dedupe(out, 'name');
}

// ---------------------------------------------------------------------------
// app-config keys
// ---------------------------------------------------------------------------
// Only dotted paths inside backticks, rooted at a known top-level config
// section. Bare prose words would produce hundreds of false positives.
const CONFIG_ROOTS = [
  'app',
  'auth',
  'backend',
  'catalog',
  'integrations',
  'organization',
  'permission',
  'proxy',
  'scaffolder',
  'search',
  'techdocs',
  'kubernetes',
  'events',
];
const CONFIG_KEY_RE = new RegExp(
  '`((?:' + CONFIG_ROOTS.join('|') + ')(?:\\.[A-Za-z][A-Za-z0-9]*){1,5})`',
);

export function configKeys() {
  const out = [];
  for (const [, where] of scan(CONFIG_KEY_RE, (m) => m[1])) void where;
  for (const [key, where] of scan(CONFIG_KEY_RE, (m) => m[1])) {
    if (/\.\*$/.test(key)) continue;
    out.push({ key, occurrences: where.length, firstSeen: where[0] });
  }
  return dedupe(out, 'key');
}

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------
const CLI_COMMAND_RE = /(?:backstage-cli|yarn)\s+((?:repo|package|versions|config|new|build|migrate)[a-z:0-9-]*(?:\s+[a-z:0-9-]+)?)/;
const CLI_FLAG_RE = /(?<![\w-])--[a-z][a-z0-9-]{2,}/;

/**
 * Which CLI a flag belongs to, inferred from the rest of the line. Tier 2 can
 * only check a flag against a documented surface if it knows whose surface to
 * look in — `--since` means one thing to `backstage-cli repo lint` and another
 * to `git log`, and `--strict` is on three different tools here.
 */
const FLAG_OWNERS = [
  ['backstage-cli', /backstage-cli|\byarn (?:repo|package|versions|config|new|fix|lint|test|build|tsc|start)\b|versions:bump|config:check|config:print|config:schema|migrate package-exports/],
  ['create-app', /create-app/],
  ['techdocs-cli', /techdocs-cli|@techdocs\/cli/],
  ['mkdocs', /\bmkdocs\b/],
  ['git', /\bgit \b/],
  ['gh', /\bgh \b/],
  ['docker', /\bdocker\b/],
  ['yarn', /\byarn\b/],
  ['npm', /\bnpm\b/],
];

/** CSS custom properties are not CLI flags. `--bui-*` is Backstage UI theming. */
const NOT_A_FLAG = /^--(?:bui|mui|backstage)-/;

export function cliFlags() {
  const out = [];
  for (const file of FILES) {
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const rx = new RegExp(CLI_FLAG_RE.source, 'g');
        let m;
        while ((m = rx.exec(line)) !== null) {
          const flag = m[0];
          if (NOT_A_FLAG.test(flag)) continue;
          const owner = FLAG_OWNERS.find(([, re]) => re.test(line))?.[0] ?? 'unattributed';
          out.push({ flag, owner, occurrences: 1, firstSeen: `${rel(file)}:${i + 1}` });
        }
      });
  }
  return dedupe(out, 'flagOwner', (x) => `${x.owner} ${x.flag}`);
}

export function cliCommands() {
  const out = [];
  for (const [cmd, where] of scan(CLI_COMMAND_RE, (m) => m[1].trim())) {
    out.push({ command: cmd, occurrences: where.length, firstSeen: where[0] });
  }
  return dedupe(out, 'command');
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------
const URL_RE = /https?:\/\/[^\s)\]`"']+/;

export function urls() {
  const out = [];
  for (const [url, where] of scan(URL_RE)) {
    const clean = url.replace(/[.,;:]+$/, '');
    // `https://backstage.io/docs/releases/v1.<N>.0` is a URL TEMPLATE the reader
    // fills in, not a link. Checking it produces a 404 that says nothing about
    // whether the content is right, and the original regex stopped at the `<`
    // which turned the template into a plausible-looking dead link.
    const isTemplate = /[<>{}]|\$\{/.test(clean);
    out.push({
      url: clean,
      host: safeHost(clean),
      template: isTemplate,
      occurrences: where.length,
      firstSeen: where[0],
    });
  }
  return dedupe(out, 'url');
}

function safeHost(u) {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}

function dedupe(list, key, keyFn = (item) => item[key]) {
  const seen = new Map();
  for (const item of list) {
    const k = keyFn(item);
    const prev = seen.get(k);
    if (!prev) seen.set(k, item);
    else prev.occurrences += item.occurrences;
  }
  return [...seen.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([, v]) => v);
}

export function extractAll() {
  return {
    packages: packages(),
    configKeys: configKeys(),
    cliFlags: cliFlags(),
    cliCommands: cliCommands(),
    urls: urls(),
  };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('extract-assertions.mjs')) {
  const all = extractAll();
  const summary = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.length]));
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(all, null, 2) + '\n');
  } else {
    console.log('Extracted from', FILES.length, 'plugin markdown files under', rel(PLUGIN_DIR));
    console.log(summary);
    for (const [kind, items] of Object.entries(all)) {
      console.log(`\n== ${kind} (${items.length}) ==`);
      for (const it of items) {
        const label = it.name ?? it.key ?? it.flag ?? it.command ?? it.url;
        console.log(`  ${label}  [${it.occurrences}x, ${it.firstSeen}]`);
      }
    }
  }
  void REPO_ROOT;
}
