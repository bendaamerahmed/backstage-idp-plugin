import test from 'node:test';
import { loadBaseline } from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';
import { npmPackageExists, urlResolves, mapLimit, saveCache, OK, BROKEN, UNVERIFIED, OFFLINE } from '../helpers/net.mjs';
import { extractAll } from '../../scripts/extract-assertions.mjs';

const baseline = loadBaseline();
const extracted = extractAll();

/**
 * A wildcard names a family (`@backstage/plugin-auth-backend-module-*`), not a
 * package. Checking it against the registry would fail for a reason that has
 * nothing to do with whether the content is right.
 */
const realPackages = extracted.packages.filter((p) => !p.wildcard);

test('every npm package the plugin names exists on the registry', { timeout: 180_000 }, async () => {
  const results = await mapLimit(realPackages, 8, async (p) => ({
    p,
    r: await npmPackageExists(p.name),
  }));
  saveCache();

  const unverified = results.filter((x) => x.r.verdict === UNVERIFIED);

  checkRule(
    'named-packages-exist',
    'every @backstage/* and @backstage-community/* package named anywhere in the plugin resolves on the npm registry',
    'A package name the agent writes into a package.json and cannot install is a hard stop mid-task, and the agent has no interactive channel to ask what was meant. Renames are routine here — community plugins moved scope one at a time.',
    (r) => {
      for (const { p, r: res } of results) {
        if (res.verdict !== BROKEN) continue;
        r.violation(p.firstSeen.split(':')[0], {
          line: Number(p.firstSeen.split(':')[1]),
          found: `${p.name} — ${res.detail}`,
          expected: 'a package that resolves on the npm registry',
          fix: 'correct the name, or if it is meant as a family placeholder write it with an explicit wildcard (`@backstage/plugin-auth-backend-module-*`) so it is not read as a real package',
        });
      }
    },
  );

  if (unverified.length) {
    // Not a failure — but it must not read as a pass either.
    console.warn(
      `  [named-packages-exist] ${unverified.length}/${realPackages.length} UNVERIFIED (registry unreachable or rate-limited): ` +
        unverified.map((x) => x.p.name).slice(0, 5).join(', ') +
        (unverified.length > 5 ? ', …' : '') +
        (OFFLINE ? ' — BSIDP_OFFLINE=1 is set.' : ''),
    );
  }
});

// ---------------------------------------------------------------------------
// Link checking
// ---------------------------------------------------------------------------
//
// Kept in Tier 1 rather than moved to the weekly job, but cached for 30 days so
// it costs nothing on a normal commit. Hosts known to rate-limit unauthenticated
// HEAD requests are excluded here and checked in Tier 2 instead — a 429 is not a
// dead link, and a link checker that cries wolf is a link checker somebody
// deletes.
const rateLimited = new Set(baseline.linkChecking.rateLimitedHosts);
const neverCheck = new Set(baseline.linkChecking.neverCheck);

const checkableUrls = extracted.urls.filter(
  (u) =>
    u.host &&
    !u.template &&
    !rateLimited.has(u.host) &&
    !neverCheck.has(u.host) &&
    !u.host.startsWith('localhost'),
);

test('every documentation URL the plugin cites resolves', { timeout: 240_000 }, async () => {
  const results = await mapLimit(checkableUrls, 6, async (u) => ({ u, r: await urlResolves(u.url) }));
  saveCache();

  checkRule(
    'cited-urls-resolve',
    'every non-rate-limited URL cited in the plugin returns a live page',
    'The agent is told to read these when a fact is version-sensitive. A 404 sends it to WebSearch instead, where it will find a page for a different release line and have no way to know.',
    (r) => {
      for (const { u, r: res } of results) {
        if (res.verdict !== BROKEN) continue;
        r.violation(u.firstSeen.split(':').slice(0, -1).join(':'), {
          line: Number(u.firstSeen.split(':').pop()),
          found: `${u.url} — ${res.detail}`,
          expected: 'HTTP 2xx',
          fix: 'find the current page. Backstage documentation URLs move between release-line paths; prefer the unversioned path where one exists.',
        });
      }
    },
  );

  const unverified = results.filter((x) => x.r.verdict === UNVERIFIED);
  if (unverified.length) {
    console.warn(
      `  [cited-urls-resolve] ${unverified.length}/${checkableUrls.length} UNVERIFIED: ` +
        unverified.map((x) => `${x.u.url} (${x.r.detail})`).slice(0, 3).join('; '),
    );
  }
});

test('rate-limited hosts are declared, not silently ignored', () => {
  checkRule(
    'link-exclusions-declared',
    'every URL excluded from link checking is excluded because its host is in baseline.linkChecking, not because the checker gave up on it',
    'An exclusion list that grows silently is how link checking stops checking anything. Keeping it in baseline.json means adding a host is a reviewable diff with a reason attached.',
    (r) => {
      const excluded = extracted.urls.filter((u) => !checkableUrls.includes(u));
      for (const u of excluded) {
        const declared =
          !u.host || u.template || rateLimited.has(u.host) || neverCheck.has(u.host) || u.host.startsWith('localhost');
        r.require(declared, u.firstSeen.split(':').slice(0, -1).join(':'), {
          found: `${u.url} is excluded but its host "${u.host}" is not declared in baseline.linkChecking`,
          expected: 'the host listed under rateLimitedHosts or neverCheck',
          fix: 'add the host with the reason, or let the URL be checked',
        });
      }
      // Guard against the exclusion list swallowing everything.
      const ratio = checkableUrls.length / Math.max(1, extracted.urls.length);
      r.require(ratio >= 0.4, 'baseline.json', {
        found: `only ${checkableUrls.length} of ${extracted.urls.length} cited URLs are actually checked (${Math.round(ratio * 100)}%)`,
        expected: 'at least 40% of cited URLs checked every run',
        fix: 'the exclusion list has grown too far — move hosts to the Tier 2 weekly check rather than excluding them outright',
      });
    },
  );
});

export { realPackages, checkableUrls, OK };
