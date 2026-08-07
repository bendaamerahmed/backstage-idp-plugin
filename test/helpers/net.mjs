/**
 * Cached network access for the tiers that check live upstream state.
 *
 * Three things this has to get right:
 *
 *  - **Cheap on repeat.** Package existence and link liveness change on the
 *    scale of months. Re-checking 50 packages and 28 URLs on every commit would
 *    make the fast tier not fast and would rate-limit the repository out of npm.
 *  - **Honest when offline.** A network failure must never read as a pass. It
 *    reports as UNVERIFIED, distinct from both OK and BROKEN, and the caller
 *    decides whether that is tolerable for its tier.
 *  - **Distinguish "gone" from "unreachable".** A 404 is a defect. A timeout,
 *    a 429 or a DNS failure is not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './repo.mjs';

const CACHE_DIR = path.join(REPO_ROOT, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'net.json');

export const OK = 'OK';
export const BROKEN = 'BROKEN';
export const UNVERIFIED = 'UNVERIFIED';

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

let cache = loadCache();
let dirty = false;

export function saveCache() {
  if (!dirty) return;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + '\n');
  dirty = false;
}

process.on('exit', saveCache);

export function cacheStats() {
  const entries = Object.values(cache);
  return {
    total: entries.length,
    ok: entries.filter((e) => e.verdict === OK).length,
    broken: entries.filter((e) => e.verdict === BROKEN).length,
  };
}

/** Offline mode: never touch the network; serve the cache and report the rest as UNVERIFIED. */
export const OFFLINE = process.env.BSIDP_OFFLINE === '1';

/**
 * @param {string} key       cache key
 * @param {number} ttlDays   how long a cached verdict stays good
 * @param {() => Promise<{verdict: string, detail?: string}>} probe
 */
export async function cached(key, ttlDays, probe) {
  const hit = cache[key];
  const ageDays = hit ? (Date.now() - Date.parse(hit.checkedOn)) / 86_400_000 : Infinity;
  if (hit && ageDays < ttlDays) return { ...hit, fromCache: true };

  if (OFFLINE) {
    if (hit) return { ...hit, fromCache: true, stale: true };
    return { verdict: UNVERIFIED, detail: 'offline and not cached', fromCache: false };
  }

  let result;
  try {
    result = await probe();
  } catch (err) {
    result = { verdict: UNVERIFIED, detail: `probe threw: ${err.message}` };
  }

  // Never cache an inconclusive result — it would turn one flaky moment into a
  // week of pretending we checked.
  if (result.verdict !== UNVERIFIED) {
    cache[key] = { ...result, checkedOn: new Date().toISOString() };
    dirty = true;
  }
  return { ...result, fromCache: false };
}

const UA = 'backstage-idp-validation-harness (+https://github.com/bendaamerahmed/backstage-idp-plugin)';

async function request(url, { method = 'GET', timeoutMs = 20_000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': UA, ...headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Does an npm package exist? 404 is BROKEN; anything else non-2xx is UNVERIFIED. */
export async function npmPackageExists(name, ttlDays = 7) {
  return cached(`npm:${name}`, ttlDays, async () => {
    const url = `https://registry.npmjs.org/${name.replace('/', '%2f')}`;
    const res = await request(url, {
      method: 'GET',
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    });
    if (res.ok) {
      res.body?.cancel?.();
      return { verdict: OK, detail: `${res.status}` };
    }
    if (res.status === 404) return { verdict: BROKEN, detail: '404 not found on the npm registry' };
    return { verdict: UNVERIFIED, detail: `registry returned ${res.status}` };
  });
}

/** npm dist-tags for a package, uncached — currency checks want the live value. */
export async function npmDistTags(name) {
  const res = await request(`https://registry.npmjs.org/-/package/${name.replace('/', '%2f')}/dist-tags`);
  if (!res.ok) throw new Error(`dist-tags for ${name}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchJson(url) {
  const res = await request(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchText(url) {
  const res = await request(url, { timeoutMs: 30_000 });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/**
 * Is a URL live? HEAD first, GET on 403/405 — several documentation hosts refuse
 * HEAD. 404/410 is BROKEN; 429 and 5xx are UNVERIFIED, because a rate limit is
 * not a dead link and treating it as one is how link checking gets deleted.
 */
export async function urlResolves(url, ttlDays = 30) {
  return cached(`url:${url}`, ttlDays, async () => {
    let res;
    try {
      res = await request(url, { method: 'HEAD' });
      if (res.status === 403 || res.status === 405 || res.status === 501) {
        res = await request(url, { method: 'GET' });
      }
    } catch (err) {
      return { verdict: UNVERIFIED, detail: `${err.name}: ${err.message}` };
    }
    res.body?.cancel?.();
    if (res.ok) return { verdict: OK, detail: `${res.status}` };
    if (res.status === 404 || res.status === 410) {
      return { verdict: BROKEN, detail: `HTTP ${res.status} — the page is gone` };
    }
    return { verdict: UNVERIFIED, detail: `HTTP ${res.status}` };
  });
}

/**
 * Download and unpack a published npm tarball into `destDir`, returning the
 * directory containing its `package/` root.
 *
 * Deliberately does NOT shell out to `npm pack`. On Windows npm is a `.cmd`
 * shim, which execFileSync refuses to spawn without `shell: true`, and
 * `shell: true` concatenates arguments instead of escaping them — a package
 * name is attacker-influenced input in a currency job that reads dist-tags. The
 * registry gives us the tarball URL directly, so the whole question disappears.
 *
 * `tar` is used for extraction only, with a fixed argument list.
 */
export async function downloadPackage(name, version, destDir) {
  const packument = await fetchJson(`https://registry.npmjs.org/${name.replace('/', '%2f')}`);
  const tarballUrl = packument.versions?.[version]?.dist?.tarball;
  if (!tarballUrl) throw new Error(`no tarball for ${name}@${version}`);

  const res = await request(tarballUrl, { timeoutMs: 120_000 });
  if (!res.ok) throw new Error(`tarball ${tarballUrl}: HTTP ${res.status}`);

  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');

  mkdirSync(destDir, { recursive: true });
  const tgz = join(destDir, 'package.tgz');
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['-xzf', 'package.tgz'], { cwd: destDir, stdio: 'pipe', timeout: 120_000 });
  return join(destDir, 'package');
}

/** Run probes with bounded concurrency so we do not open 60 sockets at once. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
