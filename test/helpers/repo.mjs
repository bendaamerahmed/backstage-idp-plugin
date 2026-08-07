/**
 * Shared filesystem + parsing helpers for every tier.
 *
 * Everything here is deliberately dependency-light: `node:fs` plus the `yaml`
 * package. The `yaml` package is not optional — the whole point of Tier 0 is to
 * catch frontmatter that a real YAML parser rejects, so a hand-rolled
 * "split on ---, split on :" parser would defeat the test it exists to run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
export const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');
export const PLUGIN_DIR = path.join(PLUGINS_DIR, 'backstage-idp');
export const SKILLS_DIR = path.join(PLUGIN_DIR, 'skills');
export const AGENTS_DIR = path.join(PLUGIN_DIR, 'agents');
export const AGENT_FILE = path.join(AGENTS_DIR, 'backstage-fullstack-developer.md');
export const PLUGIN_MANIFEST = path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json');
export const MARKETPLACE_MANIFEST = path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json');
export const BASELINE_FILE = path.join(REPO_ROOT, 'baseline.json');

/** Repo-relative, forward-slashed path — what a failure message should show. */
export function rel(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

export function readRaw(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

export function readJson(absPath) {
  const raw = readRaw(absPath);
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${rel(absPath)} is not valid JSON: ${err.message}`);
  }
}

/** Every skill directory that ships in the plugin, sorted for stable output. */
export function listSkills() {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((dirName) => {
      const file = path.join(SKILLS_DIR, dirName, 'SKILL.md');
      return { dirName, file, relFile: rel(file), exists: fs.existsSync(file) };
    });
}

/** Skills plus their parsed content. Throws only on unreadable files. */
export function loadSkills() {
  return listSkills().map((s) => ({ ...s, ...parseMarkdownFile(s.file) }));
}

export function loadAgent() {
  return { file: AGENT_FILE, relFile: rel(AGENT_FILE), ...parseMarkdownFile(AGENT_FILE) };
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Split a markdown file into raw text, raw frontmatter, parsed frontmatter and
 * body. Parsing never throws: a YAML error is returned as `frontmatterError` so
 * the test that cares about it can produce a good message, and every other test
 * can keep running against the same file.
 */
export function parseMarkdownFile(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return {
      raw,
      frontmatterRaw: null,
      frontmatter: null,
      frontmatterError: 'no YAML frontmatter block found at the top of the file',
      body: raw,
      bodyOffsetLine: 1,
    };
  }
  const frontmatterRaw = match[1];
  const body = raw.slice(match[0].length);
  const bodyOffsetLine = raw.slice(0, match[0].length).split('\n').length;
  let frontmatter = null;
  let frontmatterError = null;
  try {
    // strict: reject duplicate keys and other things a lenient parser tolerates
    // but a stricter loader in the host may not.
    frontmatter = YAML.parse(frontmatterRaw, { strict: true });
    if (frontmatter === null || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
      frontmatterError = `frontmatter parsed to ${Array.isArray(frontmatter) ? 'an array' : typeof frontmatter}, expected a mapping`;
      frontmatter = null;
    }
  } catch (err) {
    frontmatterError = err.message;
  }
  return { raw, frontmatterRaw, frontmatter, frontmatterError, body, bodyOffsetLine };
}

/** Headings in body order: `{ level, text, line }` with 1-based file lines. */
export function headings(parsed) {
  const out = [];
  const lines = parsed.body.split(/\r?\n/);
  let inFence = false;
  let fenceMarker = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) out.push({ level: h[1].length, text: h[2], line: parsed.bodyOffsetLine + i });
  }
  return out;
}

/**
 * Body lines with code fences blanked out, preserving line numbers. Content
 * rules apply to prose, not to sample code — a `Do not` rule that fired inside
 * an example would be unfixable without deleting the example.
 */
export function proseLines(parsed) {
  const lines = parsed.body.split(/\r?\n/);
  let inFence = false;
  let fenceMarker = null;
  return lines.map((line, i) => {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    const fileLine = parsed.bodyOffsetLine + i;
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      return { text: '', line: fileLine, fenced: true };
    }
    if (inFence) return { text: '', line: fileLine, fenced: true };
    return { text: line, line: fileLine, fenced: false };
  });
}

/** The section of a skill under a given `## Heading`, as prose lines. */
export function section(parsed, headingText) {
  const hs = headings(parsed);
  const startIdx = hs.findIndex((h) => h.level === 2 && h.text === headingText);
  if (startIdx === -1) return null;
  const start = hs[startIdx].line;
  const next = hs.slice(startIdx + 1).find((h) => h.level <= 2);
  const end = next ? next.line : Infinity;
  return proseLines(parsed).filter((l) => l.line > start && l.line < end);
}

export function loadBaseline() {
  return readJson(BASELINE_FILE);
}
