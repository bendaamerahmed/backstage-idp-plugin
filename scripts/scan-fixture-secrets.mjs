#!/usr/bin/env node
/**
 * Scan generated fixture output for credentials.
 *
 *     node scripts/scan-fixture-secrets.mjs nfs-current
 *
 * A Tier 4 fixture is a real install performed inside CI. If a token from that
 * environment ever lands in a generated config, lockfile or log, it must not
 * reach the fixture cache or an uploaded artifact. Repository secret scanning
 * does not cover this, because the fixture is gitignored and never committed —
 * which is exactly why it needs its own pass.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, rel } from '../test/helpers/repo.mjs';

const PATTERNS = [
  { name: 'GitHub personal access token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'generic client secret assignment', re: /client[_-]?secret['"\s:=]+[A-Za-z0-9_\-]{20,}/i },
  { name: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._-]{40,}\b/ },
];

// Files a real install legitimately fills with high-entropy strings that are
// not secrets. Scanning them produces noise that trains people to ignore this.
const SKIP_DIRS = new Set(['node_modules', '.git', '.yarn', 'dist', 'dist-types', 'coverage']);
const SKIP_FILES = /\.(lock|tgz|zip|png|jpg|ico|woff2?|map)$/;

const name = process.argv[2];
if (!name) {
  console.error('usage: node scripts/scan-fixture-secrets.mjs <fixture-name>');
  process.exit(2);
}
const root = path.join(REPO_ROOT, 'fixtures', name);
if (!fs.existsSync(root)) {
  console.log(`fixture "${name}" is not built; nothing to scan.`);
  process.exit(0);
}

const findings = [];
let scanned = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name));
      continue;
    }
    const p = path.join(dir, e.name);
    if (SKIP_FILES.test(e.name)) continue;
    let text;
    try {
      const stat = fs.statSync(p);
      if (stat.size > 2 * 1024 * 1024) continue;
      text = fs.readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    scanned++;
    text.split('\n').forEach((line, i) => {
      for (const pat of PATTERNS) {
        const m = pat.re.exec(line);
        if (!m) continue;
        findings.push({ file: rel(p), line: i + 1, pattern: pat.name, sample: `${m[0].slice(0, 8)}…` });
      }
    });
  }
}

walk(root);

console.log(`Scanned ${scanned} files in fixtures/${name}.`);
if (findings.length === 0) {
  console.log('No credentials found.');
  process.exit(0);
}

console.error(`\n${findings.length} possible credential(s) in generated fixture output:\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`      ${f.pattern} (${f.sample})`);
}
console.error('\nDo NOT cache or upload this fixture. Rotate the credential, then rebuild with --force.');
process.exit(1);
