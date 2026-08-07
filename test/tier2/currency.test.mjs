import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadBaseline, REPO_ROOT } from '../helpers/repo.mjs';
import { checkRule } from '../helpers/rules.mjs';
import { fetchJson, fetchText, npmDistTags, urlResolves, mapLimit, saveCache, downloadPackage, BROKEN } from '../helpers/net.mjs';
import { extractAll } from '../../scripts/extract-assertions.mjs';

/**
 * Tier 2 — currency. Weekly, scheduled, never a required check on a PR.
 *
 * Everything here compares baseline.json against a LIVE source. A failure means
 * the plugin is asserting something that is no longer true, which is strictly
 * worse than asserting nothing: the agent acts on it.
 *
 * Findings accumulate into test/tier2/findings.json, which
 * scripts/currency-issue.mjs turns into an issue body listing exactly which
 * assertions to re-verify and where each one came from. A red X is not an
 * output anyone can act on.
 */

const baseline = loadBaseline();
const extracted = extractAll();
const FINDINGS_FILE = path.join(REPO_ROOT, 'test', 'tier2', 'findings.json');

const findings = [];
function finding(assertion, detail) {
  findings.push({ assertion, ...detail });
}
process.on('exit', () => {
  fs.writeFileSync(FINDINGS_FILE, JSON.stringify({ generatedOn: new Date().toISOString(), findings }, null, 2) + '\n');
});

/**
 * A newline constant. Findings are multi-line, and the escape sequence has been
 * mangled twice by tooling that rewrote this file; naming it removes the
 * opportunity.
 */
const NEWLINE = String.fromCharCode(10);

/** "1.53" -> 153, so lines can be compared and subtracted. */
function lineOrdinal(line) {
  const [maj, min] = String(line).split('.').map(Number);
  return maj * 1000 + min;
}

test('the baseline release line is within the staleness budget', { timeout: 60_000 }, async () => {
  const manifest = await fetchJson('https://versions.backstage.io/v1/tags/main/manifest.json');
  const liveVersion = manifest.releaseVersion;
  const liveLine = liveVersion.split('.').slice(0, 2).join('.');
  const behind = lineOrdinal(liveLine) - lineOrdinal(baseline.release.currentLine);
  const { warnLinesBehind, failLinesBehind } = baseline.stalenessBudget;

  if (behind >= warnLinesBehind) {
    finding('release.currentLine', {
      severity: behind >= failLinesBehind ? 'fail' : 'warn',
      baselineSays: baseline.release.currentLine,
      upstreamSays: liveLine,
      linesBehind: behind,
      source: baseline.release.source,
      verifiedOn: baseline.release.verifiedOn,
      whatToDo: [
        `Read the release notes for every line from ${baseline.release.currentLine} to ${liveLine}: ` +
          rangeOfLines(baseline.release.currentLine, liveLine)
            .map((l) => baseline.documentation.releaseNotesUrlPattern.replace('{major}.{minor}', l))
            .join(' , '),
        'Grep each for **BREAKING** entries touching: the frontend system, the backend system, catalog providers/processors, scaffolder actions, the permission framework, auth providers, TechDocs, or the config schema.',
        `Then update baseline.json release.currentLine to ${liveLine} and Section 0 of the agent definition together, with a fresh verifiedOn.`,
      ].join('\n'),
    });
  }

  checkRule(
    'baseline-within-staleness-budget',
    `baseline.release.currentLine is fewer than ${failLinesBehind} release lines behind the current mainline`,
    'Backstage ships monthly. One line behind is normal. Three means nobody has looked at this plugin for a quarter, and a removed API is now an instruction the agent will follow confidently. This is the single failure mode the whole harness exists to catch.',
    (r) => {
      r.require(behind < failLinesBehind, 'baseline.json', {
        found: `baseline says ${baseline.release.currentLine}, upstream is ${liveLine} (${behind} lines behind), verified ${baseline.release.verifiedOn}`,
        expected: `fewer than ${failLinesBehind} lines behind`,
        fix: 'see the generated issue for the exact assertions to re-verify, or run `node scripts/currency-issue.mjs` locally',
      });
    },
  );

  if (behind > 0 && behind < failLinesBehind) {
    console.warn(
      `  [currency] baseline is ${behind} release line(s) behind (${baseline.release.currentLine} vs ${liveLine}). Within budget, but re-verify soon.`,
    );
  }
});

function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function rangeOfLines(from, to) {
  const out = [];
  const [maj] = from.split('.').map(Number);
  for (let n = Number(from.split('.')[1]) + 1; n <= Number(to.split('.')[1]); n++) out.push(`${maj}.${n}`);
  return out;
}

test('the supported Node majors still match the create-app template', { timeout: 180_000 }, async () => {
  const tags = await npmDistTags('@backstage/create-app');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsidp-createapp-'));
  let enginesNode = null;
  let scripts = null;
  try {
    const pkg = await downloadPackage('@backstage/create-app', tags.latest, tmp);
    const hbs = fs.readFileSync(path.join(pkg, 'templates/default-app/package.json.hbs'), 'utf8');
    const parsed = JSON.parse(hbs.replace(/\{\{[^}]*\}\}/g, 'PLACEHOLDER'));
    enginesNode = parsed.engines?.node ?? null;
    scripts = Object.keys(parsed.scripts ?? {});
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (enginesNode !== baseline.node.enginesRange) {
    finding('node.enginesRange', {
      severity: 'fail',
      baselineSays: baseline.node.enginesRange,
      upstreamSays: enginesNode,
      source: `npm:@backstage/create-app@${tags.latest} templates/default-app/package.json.hbs`,
      verifiedOn: baseline.node.verifiedOn,
      whatToDo:
        'Update baseline.node.supportedMajors and enginesRange, then the "Supported Node.js" row of Section 0, then the CI matrix in .github/workflows/. All four must agree.',
    });
  }

  const missing = (baseline.createApp.rootScripts ?? []).filter((s) => scripts && !scripts.includes(s));
  const added = (scripts ?? []).filter((s) => !baseline.createApp.rootScripts.includes(s));
  if (missing.length || added.length) {
    finding('createApp.rootScripts', {
      severity: 'fail',
      baselineSays: baseline.createApp.rootScripts.join(', '),
      upstreamSays: (scripts ?? []).join(', '),
      source: `npm:@backstage/create-app@${tags.latest} templates/default-app/package.json.hbs`,
      verifiedOn: baseline.createApp.verifiedOn,
      whatToDo: `Scripts removed upstream: ${missing.join(', ') || '(none)'}. Scripts added upstream: ${added.join(', ') || '(none)'}. pull-request-ready step 2 enumerates this list for adopters; update it and baseline.createApp.rootScripts together.`,
    });
  }

  checkRule(
    'node-majors-match-upstream',
    'baseline.node.enginesRange equals the engines.node of the published create-app default template',
    'The supported Node majors are a hard compatibility boundary and they move: the policy is exactly two adjacent even majors, so every bump also DROPS one. Guidance written for a dropped major sends the agent to install a Node that Backstage rejects.',
    (r) => {
      r.require(enginesNode === baseline.node.enginesRange, 'baseline.json', {
        found: `baseline "${baseline.node.enginesRange}" vs create-app@${tags.latest} "${enginesNode}"`,
        expected: 'identical strings',
        fix: 'update baseline.node, Section 0, and the CI Node matrix together',
      });
    },
  );

  checkRule(
    'create-app-scripts-match-upstream',
    'baseline.createApp.rootScripts equals the script list in the published default template',
    'pull-request-ready tells adopters what a default create-app repo contains so they do not manufacture requirements it does not have. That list was already wrong once — it omitted build:backend, build:all and build-image — and the only way to keep it right is to read it from the artifact.',
    (r) => {
      r.require(missing.length === 0 && added.length === 0, 'baseline.json', {
        found: `missing from upstream: [${missing.join(', ')}]; new upstream: [${added.join(', ')}]`,
        expected: 'the same set',
        fix: 'update baseline.createApp.rootScripts and the enumeration in pull-request-ready step 2',
      });
    },
  );
});

test('the create-app CLI still exposes the flags the plugin names', { timeout: 180_000 }, async () => {
  const tags = await npmDistTags('@backstage/create-app');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsidp-flags-'));
  let liveFlags = [];
  try {
    const pkg = await downloadPackage('@backstage/create-app', tags.latest, tmp);
    const dist = fs.readFileSync(path.join(pkg, 'dist/index.cjs.js'), 'utf8');
    liveFlags = [...new Set([...dist.matchAll(/"(--[a-z][a-z0-9-]*)/g)].map((m) => m[1]))].sort();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const gone = baseline.createApp.flags.filter((f) => !liveFlags.includes(f));
  const back = baseline.createApp.removedFlags.filter((f) => liveFlags.includes(f));

  if (gone.length || back.length) {
    finding('createApp.flags', {
      severity: 'fail',
      baselineSays: `present: ${baseline.createApp.flags.join(' ')} / removed: ${baseline.createApp.removedFlags.join(' ')}`,
      upstreamSays: liveFlags.join(' '),
      source: `npm:@backstage/create-app@${tags.latest} dist/index.cjs.js`,
      verifiedOn: baseline.createApp.verifiedOn,
      whatToDo: `Flags the baseline claims exist but do not: ${gone.join(', ') || '(none)'}. Flags the baseline claims were removed but are back: ${back.join(', ') || '(none)'}. Section 0's "Frontend system" row asserts --next was replaced by --legacy; check it.`,
    });
  }

  checkRule(
    'create-app-flags-match-upstream',
    'every flag baseline.createApp.flags claims still exists, and no flag it claims was removed has returned',
    'Section 0 tells the agent that `create-app --next` was replaced by `--legacy`. If that reverses, the agent scaffolds the wrong app generation and nothing about the failure points at this line.',
    (r) => {
      r.require(gone.length === 0 && back.length === 0, 'baseline.json', {
        found: `claimed-but-absent: [${gone.join(', ')}]; claimed-removed-but-present: [${back.join(', ')}]`,
        expected: 'the baseline to match the shipped commander program',
        fix: 'update baseline.createApp and the Section 0 "Frontend system" row together',
      });
    },
  );
});

test('every config key the plugin names appears in the published config schema', { timeout: 240_000 }, async () => {
  // Backstage's config schema is assembled from every package's config.d.ts, so
  // there is no single published document. The closest authoritative artifact
  // is the schema embedded in the packages themselves. We check the ones we can
  // reach cheaply and record the rest as unverified rather than guessing.
  const roots = [...new Set(extracted.configKeys.map((k) => k.key.split('.')[0]))].sort();
  const schemaSources = {
    app: '@backstage/plugin-app-backend',
    auth: '@backstage/plugin-auth-backend',
    backend: '@backstage/backend-defaults',
    catalog: '@backstage/plugin-catalog-backend',
    integrations: '@backstage/integration',
    kubernetes: '@backstage/plugin-kubernetes-backend',
    // `organization.name` is read by the app shell, not by a backend plugin —
    // its schema lives in the app package rather than a plugin's config.d.ts.
    organization: '@backstage/plugin-app-backend',
    permission: '@backstage/plugin-permission-backend',
    scaffolder: '@backstage/plugin-scaffolder-backend',
    search: '@backstage/plugin-search-backend',
    techdocs: '@backstage/plugin-techdocs-backend',
  };
  const unreachable = roots.filter((r) => !schemaSources[r]);

  finding('configKeys.coverage', {
    severity: 'info',
    baselineSays: `${extracted.configKeys.length} config keys named across ${roots.length} roots`,
    upstreamSays: `schema packages known for ${roots.length - unreachable.length} roots; no mapping for: ${unreachable.join(', ') || '(none)'}`,
    source: 'per-package config.d.ts',
    verifiedOn: baseline.baselineVerifiedOn,
    whatToDo:
      'Full per-key schema verification runs in Tier 4, where a real fixture can execute `yarn backstage-cli config:schema` and produce the merged schema. This tier only checks that every config root the plugin names maps to a package we know how to reach. See docs/test-coverage.md.',
  });

  checkRule(
    'config-roots-have-a-schema-source',
    'every top-level config section the plugin names maps to a package whose config.d.ts defines it',
    'A config key with no owning package is either a typo or a key that was removed. Either way the agent will write it into app-config.yaml and `config:check --strict` will reject the whole file, which reads as a broken repository rather than a wrong instruction.',
    (r) => {
      for (const root of unreachable) {
        const example = extracted.configKeys.find((k) => k.key.startsWith(root + '.'));
        r.violation('baseline.json', {
          found: `config root "${root}" (e.g. \`${example?.key}\` at ${example?.firstSeen}) has no known schema-owning package`,
          expected: 'an entry in schemaSources in this test',
          fix: 'add the owning package, or correct the key if the root is a typo',
        });
      }
    },
  );
});

test('the Kubernetes plugin still exposes the config surface the skill writes', { timeout: 180_000 }, async () => {
  const pkgName = '@backstage/plugin-kubernetes-backend';
  const tags = await npmDistTags(pkgName);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsidp-k8s-'));
  let schema = null;
  try {
    const pkg = await downloadPackage(pkgName, tags.latest, tmp);
    schema = JSON.parse(fs.readFileSync(path.join(pkg, 'config.schema.json'), 'utf8'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const k = schema.properties?.kubernetes?.properties ?? {};
  const live = {
    clusterLocatorMethods: (k.clusterLocatorMethods?.items?.oneOf ?? k.clusterLocatorMethods?.items?.anyOf ?? [])
      .flatMap((x) => x.properties?.type?.enum ?? [x.properties?.type?.const]).filter(Boolean),
    serviceLocatorMethods: k.serviceLocatorMethod?.properties?.type?.enum ?? [],
    customResourcesFields: k.customResources?.items?.required ?? [],
    objectTypes: k.objectTypes?.items?.enum ?? [],
  };

  const drift = [];
  for (const [field, expected] of Object.entries(baseline.kubernetes).filter(([f]) => f in live)) {
    const gone = expected.filter((v) => !live[field].includes(v));
    const added = live[field].filter((v) => !expected.includes(v));
    if (gone.length || added.length) drift.push({ field, gone, added, live: live[field] });
  }

  if (drift.length) {
    finding('kubernetes.configSurface', {
      severity: 'fail',
      baselineSays: drift.map((d) => `${d.field}: ${baseline.kubernetes[d.field].join(', ')}`).join(' | '),
      upstreamSays: drift.map((d) => `${d.field}: ${d.live.join(', ')}`).join(' | '),
      source: `npm:${pkgName}@${tags.latest} config.schema.json`,
      verifiedOn: baseline.kubernetes.verifiedOn,
      whatToDo: [
        ...drift.map(
          (d) => `${d.field}: removed upstream [${d.gone.join(', ') || 'none'}], new upstream [${d.added.join(', ') || 'none'}]`,
        ),
        'Update baseline.kubernetes and the matching step in backstage-kubernetes together. A removed value the skill still names produces a config the adopter cannot load.',
      ].join(NEWLINE),
    });
  }

  checkRule(
    'kubernetes-config-surface-current',
    'the cluster locators, service locators, customResources fields and object types the plugin names still exist in the published schema',
    'backstage-kubernetes tells the agent to write these keys verbatim. A value that was removed upstream fails `config:check --strict` for the whole repository, which reads to an adopter as a broken portal rather than as wrong guidance.',
    (r) => {
      for (const d of drift) {
        r.violation('baseline.json', {
          found: `kubernetes.${d.field}: baseline has [${baseline.kubernetes[d.field].join(', ')}], upstream has [${d.live.join(', ')}]`,
          expected: 'the same set',
          fix: 'update baseline.kubernetes and backstage-kubernetes together, citing the schema version',
        });
      }
    },
  );
});

test('rate-limited hosts still resolve', { timeout: 180_000 }, async () => {
  // Excluded from Tier 1 because a 429 is not a dead link. Checked here, weekly,
  // where one flaky run costs a re-run rather than a blocked merge.
  const hosts = new Set(baseline.linkChecking.rateLimitedHosts);
  const urls = extracted.urls.filter((u) => !u.template && hosts.has(u.host));
  const results = await mapLimit(urls, 3, async (u) => ({ u, r: await urlResolves(u.url, 7) }));
  saveCache();

  for (const { u, r } of results.filter((x) => x.r.verdict === BROKEN)) {
    finding('documentation.links', {
      severity: 'fail',
      baselineSays: `${u.url} cited at ${u.firstSeen}`,
      upstreamSays: r.detail,
      source: u.url,
      verifiedOn: baseline.baselineVerifiedOn,
      whatToDo: 'Find the current page and update the citation.',
    });
  }

  checkRule(
    'rate-limited-urls-resolve',
    'URLs on rate-limited hosts still return a live page',
    'These are excluded from the every-commit tier so a 429 cannot block a merge. That exclusion is only defensible if something still checks them.',
    (r) => {
      for (const { u, r: res } of results) {
        if (res.verdict !== BROKEN) continue;
        r.violation(u.firstSeen.split(':').slice(0, -1).join(':'), {
          line: Number(u.firstSeen.split(':').pop()),
          found: `${u.url} — ${res.detail}`,
          expected: 'HTTP 2xx',
          fix: 'find the current page',
        });
      }
    },
  );
});

test('breaking changes in the intervening releases are surfaced, not classified', { timeout: 240_000 }, async () => {
  const manifest = await fetchJson('https://versions.backstage.io/v1/tags/main/manifest.json');
  const liveLine = manifest.releaseVersion.split('.').slice(0, 2).join('.');
  const lines = rangeOfLines(baseline.release.currentLine, liveLine);
  if (lines.length === 0) return; // up to date, nothing to diff

  // Areas the plugin covers. A BREAKING entry mentioning one of these is worth a
  // human read; deciding whether it actually breaks a skill is a judgement this
  // job deliberately does not attempt.
  const AREAS = [
    'frontend system', 'backend system', 'catalog', 'scaffolder', 'permission',
    'auth', 'techdocs', 'search', 'config', 'cli', '@backstage/ui', 'blueprint',
  ];

  for (const line of lines) {
    const url = `https://backstage.io/docs/releases/v${line}.0-changelog`;
    let text;
    try {
      text = await fetchText(url);
    } catch (err) {
      finding('release.changelog', {
        severity: 'warn',
        baselineSays: `expected a changelog for ${line}`,
        upstreamSays: err.message,
        source: url,
        verifiedOn: baseline.release.verifiedOn,
        whatToDo: 'Read the release notes for this line by hand; the changelog page shape may have changed.',
      });
      continue;
    }
    // The changelog is served as rendered HTML, so `**BREAKING**` never appears
    // as markdown — it is `<strong>BREAKING</strong>`. Matching only the
    // markdown form found zero entries on every line and reported that as
    // "no breaking changes", which is the worst possible failure for a staleness
    // detector: silent, confident, and wrong. Both forms are matched, and the
    // entry text is stripped of tags before it reaches the issue body.
    const breaking = [
      ...text.matchAll(/(?:\*\*BREAKING\*\*|<strong>BREAKING<\/strong>)\s*:?\s*([\s\S]{0,300}?)<\/li>/g),
    ].map((m) => stripTags(m[1]));
    const relevant = breaking.filter((b) => AREAS.some((a) => b.toLowerCase().includes(a)));
    if (relevant.length) {
      finding('release.breakingChanges', {
        severity: 'warn',
        baselineSays: `baseline is on ${baseline.release.currentLine}`,
        upstreamSays: `${relevant.length} BREAKING entries in ${line} touch areas this plugin covers`,
        source: url,
        verifiedOn: baseline.release.verifiedOn,
        whatToDo:
          `Read each and decide whether a skill asserts something it contradicts. This job does NOT classify them.\n` +
          relevant.slice(0, 25).map((b) => `  - ${b}`).join('\n'),
      });
    }
  }

  // Surfacing is the job; a breaking change upstream is not by itself a defect
  // in this plugin. The staleness budget is what fails.
  console.log(`  [currency] scanned changelogs for lines: ${lines.join(', ')}`);
});
