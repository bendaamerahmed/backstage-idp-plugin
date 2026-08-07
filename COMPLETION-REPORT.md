# Completion report

**Date:** 2026-08-07 · **Version prepared:** 1.1.0 (release gate passing; not tagged — see "Release status")

## What changed

The artifact arrived as a loose directory containing a hand-authored plugin that
had never been parsed, linted, or executed against anything. It is now a
repository with 18 commits, a five-tier validation suite that runs in 87
seconds, CI, a release path, and documentation that states its own gaps.

The plugin content itself changed in eight places. Every one was found by a test,
not by reading.

## What each tier covers

| Tier | Rules | Runs | Time |
| :--- | ---: | :--- | ---: |
| 0 — structural | 39 | every commit | ~200 ms |
| 1 — content invariants | 12 | every commit | ~1 s |
| 2 — currency | 6 | weekly | ~5 s |
| 3 — trigger accuracy | 209 cases x 3 votes | on content change | ~16 min |
| 3 — behaviour and injection | 11 scenarios x 2 runs | on content change | ~25 min |
| 4 — integration | 5 scenarios | nightly | ~7 s + fixture build |

Plus two meta-checks that make the rest mean something:

- `scripts/mutation-check.mjs` — 22 mutants, each breaking one thing, each
  required to be caught by the specific rule that claims to cover it. **22/22.**
- `scripts/fixtures/prove-can-fail.mjs` — 4 sabotages of a real Backstage
  fixture. **4/4.**

## Plugin facts a test disproved

| # | Claim | Reality | Found by |
| :-- | :--- | :--- | :--- |
| 1 | `backstage-permissions` description fits the listing budget | 204 chars against a 200 cap | Tier 0 `skill-description-bounds` |
| 2 | A default `create-app` repo has "exactly" 12 named scripts | 15; it omitted `build:backend`, `build:all`, `build-image` | Tier 2 + Tier 4 against a real 1.53.0 tree |
| 3 | `https://backstage.io/docs/releases/` is the release-notes index | No such page has ever existed. The sitemap has 572 release pages and no index | Tier 1 `cited-urls-resolve` |
| 4 | `@backstage-community/plugin-x` is a usable example name | 404 on npm; reads as a real package | Tier 1 `named-packages-exist` |
| 5 | `backstage-auth` renders its `'<provider>'` error string | Markdown parsed it as an HTML tag and dropped it, leaving `The '' provider is not configured` — an error string the agent could not match against real logs | markdownlint MD033 |
| 6 | `backstage-plugin-migrate` step 10 is one paragraph | A wrapped line began with `+`, which CommonMark rendered as a stray bullet list | markdownlint MD004 |
| 7 | `permissionMode: auto` gates the agent | It is ignored for a plugin-shipped agent. An audit would have concluded the opposite | Tier 0 `agent-ignored-fields-explained` |
| 8 | Three manifests agreed on a version | plugin.json said 1.0.0, the other two said 1.1.0 | Tier 0 `version-single-source` |

Two further changes were driven by measurement rather than by a wrong fact:

- **`backstage-incident-debug` had 59% trigger precision.** Its `when_to_use`
  was a list of production symptoms overlapping four other skills, so it
  absorbed "sign-in broke after an upgrade", "docs are stale", "CI is red" and
  "app won't start after the bump". Rewritten around its actual boundary — a
  deployed instance failing with the layer not yet known, with an explicit
  deferral once it is. **Precision 59% → 91%; near-miss accuracy 100%.**
- **`pull-request-ready` had 73% recall**, missing yarn-fix churn, "did I commit
  something I shouldn't have", and DCO sign-off. **Recall 73% → 91%.**

And one content addition: the agent named seven *topic areas* to re-check rather
than recall, but not the four *kinds of fact* that actually move — import paths,
function signatures, config keys, package names. Symbols relocate between
packages and in and out of `/alpha` without renaming, so "the frontend system"
as a topic did not cover it.

## Verified against real Backstage 1.53.0

`fixtures/nfs-current` is a genuine `create-app` tree. Five scenarios assert
against it using its own toolchain:

- `yarn tsc` exits 0 on the untouched fixture
- `engines.node` is `22 || 24`, matching Section 0 and `baseline.node`
- every root script `pull-request-ready` tells adopters exists, exists
- `App.tsx` imports `@backstage/frontend-defaults` — NFS really is the default
- `index.tsx` imports `@backstage/ui` — BUI really does ship in the default app

The last two were previously documentation claims. They are now facts checked
against an artifact, and they go red the month they stop being true.

## Measured results

**Trigger accuracy** (209 cases, 3-vote majority, claude-sonnet-5):
94.6% overall, **100% negative rejection (35/35)**, **100% near-miss (12/12)**.
Floors committed ~10 points below observed, with a rule preventing them from
being quietly raised to fit.

**Behaviour and injection**: 11/11 scenarios pass. **3 of 11 discriminate** —
the negative control fails only `blocked-on-undecidable`,
`assumptions-in-report` and `stops-before-push`.

**All six injection scenarios also pass under a deliberately compliant control
prompt.** The base model refuses them on its own. The accurate claim is that the
agent definition does not weaken injection resistance and reports the attempt
clearly — **not** that this plugin makes the agent injection-resistant. Anyone
running a security review should read `docs/test-coverage.md` on this before
citing the result.

## Gaps, and why they remain

Stated in full in `docs/test-coverage.md`. The three that matter:

1. **Eleven of fifteen skills have no scenario that executes their procedure.** The
   Tier 4 scenarios verify the *premises* the skills rest on, not their
   *outputs*. The scenarios named in the brief are listed individually
   with what each needs. The harness and one real fixture exist, so each is
   incremental work rather than new infrastructure — but the honest claim today
   is that those eleven skills are structurally sound, currently accurate on every
   machine-checkable fact, and trigger correctly, with their procedures
   unexecuted.

2. **Only one of three fixtures is built.** `legacy` and `hybrid` are scripted
   and cached in CI but were not built in this session. Tier 4 skips them with
   the exact build command, and `tier4-fixture-inventory` fails if a skip message
   does not name one.

3. **Three checks are heuristic or proxy**, each labelled:
   `api-signatures-marked-version-sensitive` detects the *shape* of an
   over-confident claim, not its truth; `failure-modes-symptom-first` enforces
   the structure that produces symptom-first ordering, not the judgement;
   `mutation-commands-gated` is applied in command position rather than to every
   occurrence of a mutation verb, with the reasoning recorded — 89 literal hits
   were almost all descriptive prose, and a rule that fires 89 times gets
   suppressed rather than fixed.

## Release status

`npm run check:release-gate` **passes** for v1.1.0.

The repository was created at `bendaamerahmed/backstage-idp-plugin` on
2026-08-07, which resolved decisions 1-3 in `OPEN-DECISIONS.md`. Decision 4 —
the support-matrix floor — remains open and deliberately does not block a
release: `1.44` is the oldest line the guidance was *written* against, not a
tested claim, and `docs/test-coverage.md` says so.

Nothing in this session pushed, tagged, published or opened a pull request. The
`origin` remote is configured locally; the commands are in the handover below.

Three things still need a human, none of them code:

- **The repository is private.** A marketplace entry can only be installed from
  a repository the installer can reach.
- **Branch protection** — documented in `CONTRIBUTING.md`; required checks and
  reviews need GitHub Pro or an organisation on a private repository.
- **Actions minutes** — the nightly integration job builds real `create-app`
  trees, which is billed on a private repository. Review the schedules in
  `integration.yml` and `currency.yml` before enabling them.

### To publish

```bash
git push -u origin main
git tag -a v1.1.0 -m "v1.1.0"
git push origin v1.1.0
```

The tag push triggers the release workflow, which re-runs the full suite and the
mutation check with `CLAUDE_CLI_REQUIRED=1`, runs the release gate, builds the
reproducible `.plugin` bundle, generates notes from `CHANGELOG.md`, and attaches
both.

## One thing worth reading if nothing else

The negative controls changed what this repository is allowed to claim. Without
them, eleven green behavioural scenarios would have read as "this plugin makes
the agent injection-resistant". With them, the honest finding is that the base
model does nearly all of that work, and what the plugin adds is that the agent
*names* the attempt and cites the rule it is applying — valuable, but a
reporting property rather than a containment one.

That distinction only exists because the harness was built to be able to
disprove its own claims. The same discipline caught three rules that were
measuring nothing, one assertion that penalised correct behaviour, and a harness
bug that hung for an hour on precisely the failure mode it was written to
detect.
