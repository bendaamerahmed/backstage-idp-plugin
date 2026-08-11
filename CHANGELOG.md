# Changelog

All notable changes to the `backstage-idp` plugin are documented here.

The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versioning applies to the **plugin**, not to the harness around it. A change that
alters what the agent or a skill instructs is a plugin change and gets an entry.
A change to the tests, CI or docs does not, unless it changed plugin content as a
result — in which case the content change is what is listed.

## [Unreleased]

### Fixed

- The nightly integration job could never have passed. Yarn Berry enables
  immutable installs whenever `CI` is set, and `create-app`'s template lockfile
  does not exactly match what resolves at install time — so `yarn install`
  failed with `YN0028` and create-app reported "Failed to create app!". Every
  fixture, on every Node version, on every runner. It worked locally only
  because `CI` is unset on a laptop.

  The builder now sets `YARN_ENABLE_IMMUTABLE_INSTALLS=false` for that single
  command, scoped rather than unsetting `CI` globally so the rest of the build
  still behaves like CI. Reproduced with `CI=true` before fixing and verified
  after: the fixture builds and all five Tier 4 scenarios pass against it.

  Found by the nightly job on its first real scheduled run, which opened
  [#1](https://github.com/bendaamerahmed/backstage-idp-plugin/issues/1)
  automatically. No test could have caught this — it is a CI-environment bug,
  and the nightly job is the only thing that runs in a CI environment.

## [1.3.0] - 2026-08-07

### Added

- The npm package declares a `bin`. `npx @backstage-idp-plugin/backstage-idp`
  previously failed with "could not determine executable to run", which reads as
  a broken package rather than as "this is not a CLI". It now prints the install
  commands, and takes `--list`, `--path`, `--json` and `--version`.

  The script lives in the npm wrapper, never inside the plugin, so the `.plugin`
  bundle Claude Code loads remains markdown and JSON only. It reads its own
  package directory and writes to stdout; four Tier 0 rules enforce that it
  performs no filesystem writes, no child processes, no network access, no
  dynamic evaluation, and imports nothing outside `node:` builtins.

- `SECURITY.md` now distinguishes the plugin bundle (no executable code) from
  the npm package (exactly one, described and constrained). Shipping an
  executable that the security document did not mention would have been the
  fastest way to lose a reviewer.

- README: how to update a plugin (the marketplace-qualified name is required),
  what `npx` does and does not do, and `npm audit signatures` for verifying
  provenance.

## [1.2.4] - 2026-08-07

### Fixed

- The plugin described itself as **"twelve verified Backstage workflow skills"**
  while shipping fifteen. It had been wrong since 1.2.0, when `backstage-theming`,
  `backstage-kubernetes` and `kubernetes-crd-author` were added: the agent's §16
  count and both READMEs were updated, `plugin.json` and `marketplace.json` were
  not. That description is the text an adopter reads on npm, in the marketplace
  listing, and in `claude plugin details` — the first claim they can check, and
  it was wrong in three consecutive releases.

  Found by installing the published package and reading the output of
  `claude plugin details`, not by any test. The existing rule checked the count
  in the agent's §16 and nothing else.

- `docs/architecture.md`, `docs/adr/0009` and `docs/authoring.md` carried the
  same stale counts, plus a stale corpus size (167 cases, now 209). Statements
  that are historically accurate — the 1.0.0 changelog entry, and architecture's
  note that 1.0.0 listed twelve skills as a roadmap — are left alone.

### Added

- Tier 0 rule `skill-count-claims-accurate`: any "`<n>` skills" claim in
  `plugin.json`, `marketplace.json` or either README must match the number of
  skills that ship. Scoped to adopter-facing surfaces on purpose — a blanket
  scan would fire on prose that is correctly describing an older release, and a
  rule that fires on correct sentences gets suppressed rather than fixed.

## [1.2.3] - 2026-08-07

No change to the plugin; identical content to 1.2.0 through 1.2.2. This release
restores a valid provenance attestation after a history rewrite invalidated
1.2.2's.

### Changed

- `archive/` removed from the repository and from its published history. It held
  the pre-review agent definition and the review report that produced the
  load-bearing frontmatter decisions. Nothing was lost that the repository needs:
  ADR-0003 through ADR-0006 each state their own context, decision and failure
  mode without reference to the original documents, which is why they were
  written as standalone arguments rather than as pointers.

### Security

- 1.2.2's provenance attestation named a commit that no longer exists after the
  rewrite, so it no longer verifies. This release re-attests against the current
  history. Verify with
  `npm view @backstage-idp-plugin/backstage-idp@1.2.3 dist.attestations`.

## [1.2.2] - 2026-08-07

No change to the plugin; identical content to 1.2.0 and 1.2.1. This release
exists so the published package actually carries the provenance attestation
1.2.1's notes claimed for it.

### Security

- `npm publish` runs with `--provenance` again. Trusted publishing authenticates
  a publish but does not attest it, and `npm config get provenance` is `false` by
  default — the flag had been removed on the assumption that OIDC implied it,
  which is why 1.2.1 published with no attestation. Verify with
  `npm view @backstage-idp-plugin/backstage-idp@1.2.2 dist.attestations`.

## [1.2.1] - 2026-08-07

No change to the plugin. The agent definition and all fifteen skills are
byte-identical to 1.2.0 — this release exists to make the published artifact
verifiable and to fix a release pipeline that had never run green.

### Security

- npm publishing moved to **OIDC trusted publishing**. There is no longer an
  `NPM_TOKEN` secret anywhere: the registry trusts one workflow file in one
  repository, and each publish uses a short-lived credential that cannot be
  extracted or reused. Verifiable on the published package, whose `_npmUser` is
  `GitHub Actions` with a `trustedPublisher` record rather than a human account.

  **This release does not carry a provenance attestation.** The entry originally
  claimed it did. Trusted publishing authenticates a publish; it does not attest
  it, and `provenance` defaults to `false` — the `--provenance` flag had been
  removed on the assumption that OIDC implied it. Corrected in the workflow; the
  next release carries the attestation.

### Fixed

- The npm publish job ran on Node 22, which clears npm's documented Node floor
  for trusted publishing but bundles npm 10.9.8 — a version that cannot do OIDC
  at all, and fails with a generic auth error naming nothing useful. The job now
  runs on Node 24 and asserts `npm >= 11.5.1` before attempting to publish, so a
  future regression names its own cause.
- `npm run test:fast` — documented in the README and CONTRIBUTING as the
  sub-ten-second tier — had never worked. Every per-tier script used the
  bare-directory form (`node --test test/tier0/`), which fails on Windows and,
  as the first CI run proved, on Linux. All six scripts now use the portable
  glob form, and a new Tier 0 rule (`test-scripts-are-portable`) with its own
  mutant stops it recurring. A documented command that does not run is worse
  than a missing one: it is the first thing a new contributor types, and the
  failure looks like their environment rather than our packaging.

## [1.2.0] - 2026-08-07

The first version published to npm, as
`@backstage-idp-plugin/backstage-idp`. 1.1.0 was prepared and gated but never
tagged; its entries are below and ship as part of this release.

### Added

- `backstage-theming` — brand colours, logos and typography across the portal,
  covering both theme systems that coexist on a current line: `@backstage/ui`
  CSS custom properties and the Material UI unified theme. Most theming bugs are
  one being styled and the other not, so the skill leads with deciding which
  surface you are changing.
- `backstage-kubernetes` — cluster locators, auth, entity annotations, and
  surfacing your own CRDs through `kubernetes.customResources`. Four independent
  things must line up for the tab to populate and all four fail identically, so
  the procedure starts by querying the backend directly to tell them apart.
- `kubernetes-crd-author` — CRD API design, kubebuilder scaffolding, validation
  markers, idempotent reconcile loops, versioning and envtest. Treats a CRD as a
  published API, because once an object is stored the schema cannot be changed
  cheaply.
- Tier 4 scenario pinning the Kubernetes config surface against the published
  `@backstage/plugin-kubernetes-backend` schema, and a Tier 2 currency check on
  the same values. `customResources` taking exactly `group`/`apiVersion`/`plural`
  is worth pinning: getting it wrong is a silent no-match, not an error.
- npm packaging under `@backstage-idp-plugin/backstage-idp`, published from a
  staging directory so the plugin bundle stays content-only, with the version
  read from the plugin manifest and the name asserted to match it.

### Changed

- The agent's `## BLOCKED` contract now states that work for the blocked decision
  itself is not left on disk. A behavioural scenario caught the agent producing a
  perfect BLOCKED report *and* writing the `catalog-info.yaml` it was blocked on
  — non-deterministically, because the definition never said either way. A
  plausible-looking file outlives the report and gets committed by someone who
  did not read it, which is the exact harm stopping was meant to avoid. Partial
  artifacts now go in the report as a fenced block instead.
- `backstage-theming`, `backstage-kubernetes` and `kubernetes-crd-author`
  `when_to_use` boundaries tightened after measurement. Theming was absorbing
  MUI-to-BUI component swapping from `backstage-plugin-migrate` (precision 85% →
  100%), and `backstage-kubernetes` was absorbing CRD versioning and finalizers
  from `kubernetes-crd-author` (86% → 92%, and crd-author recall 73% → 100%).

### Security

- Committed eval results are sanitised of machine-local paths, checked in CI.

## [1.1.0] - 2026-08-07

The first release with any verification behind it. 1.0.0 was hand-authored and
had never been parsed, linted, or executed against a real Backstage repository.

### Added

- Validation harness covering Tiers 0-4 (structural, content invariants,
  currency, behavioural evals, integration against real Backstage monorepos).
  `npm test` runs everything available; `npm run test:fast` is the sub-10-second
  tier. See `docs/test-coverage.md` for what each tier covers and what it does not.
- `baseline.json` — every machine-checkable fact the plugin asserts, each with
  the artifact it was verified against and a `verifiedOn` date. The weekly
  currency job diffs it against live upstream sources and opens an issue naming
  the specific assertions to re-verify.
- Marketplace packaging: `.claude-plugin/marketplace.json`, so the plugin is
  installable by name rather than by copying files.
- Prompt-injection corpus and tests asserting the agent treats repository
  content as data.
- `docs/` — architecture, the skill authoring contract, ADRs for the
  load-bearing decisions, a runbook, and an honest coverage report.

### Changed

- `backstage-permissions`: `description` trimmed from 204 to under the 200-char
  cap; the trailing trigger phrasing moved to `when_to_use`, where it is
  budgeted separately.
- `pull-request-ready`: the "exactly" list of scripts in a default `create-app`
  repo omitted `build:backend`, `build:all` and `build-image`. Corrected against
  a real 1.53.0 tree and the published template; both agree on all fifteen.
- `backstage-incident-debug`: `when_to_use` rewritten around its actual boundary
  — a deployed instance failing with the layer not yet known — with an explicit
  deferral once the layer is known. It was previously absorbing work belonging
  to four other skills; measured trigger precision went from 59% to 91%.
- `pull-request-ready`, `backstage-repo-discovery`, `backstage-catalog`,
  `backstage-permissions`, `backstage-upgrade`: `when_to_use` extended with the
  user phrasings the trigger evals showed were being missed.
- The agent now enumerates the four kinds of fact it must never recall — import
  paths, function signatures, config keys, package names — rather than only the
  topic areas that move.
- `backstage-scaffolder`: `createBackendModule`'s option shape is no longer
  stated flatly one line after correctly telling the reader to read
  `createTemplateAction`'s type from the installed package.
- The agent's reference list cited `https://backstage.io/docs/releases/` as a
  release-notes index. No such page has ever existed; replaced with the
  per-line page, the path pattern, and the GitHub releases page.
- `backstage-plugin-migrate`: step 10 rewritten so a wrapped line no longer
  begins with `+`, which CommonMark was rendering as a stray bullet list.
- `backstage-auth`: `<provider>` in an error-message heading is now a code span.
  Previously markdown parsed it as an HTML tag and dropped it, leaving an error
  string the agent could not match against real logs.
- `backstage-upgrade`: `@backstage-community/plugin-x` in an error example
  replaced with an unambiguous placeholder; `plugin-x` reads as a real package
  name and does not exist on npm.
- Agent frontmatter: `permissionMode: auto` now carries a comment recording that
  it is **not** load-bearing for a plugin-shipped agent, so an audit of what
  gates the agent's write access is not misled by it.
- Fenced code blocks throughout now declare a language and sit inside blank
  lines, so they render as code rather than as list continuation.

### Fixed

- Three manifests declared two different versions. `scripts/set-version.mjs` is
  now the supported way to change them, and Tier 0 fails if they disagree.

### Security

- `SECURITY.md` states the trust model plainly: this plugin instructs an agent
  with write access to a repository. It enumerates what the agent will and will
  not do and what an operator must gate.
- Tier 1 forbids `npx backstage-cli`. The bare npm name `backstage-cli` is an
  unrelated third-party package, so that command does not run the Backstage CLI.
  The plugin never did this; the rule stops it starting.

## [1.0.0] - 2026-08-06

Initial hand-authored plugin: one subagent definition and twelve skills,
researched against official Backstage documentation. Never executed, never
tested, no release process. Recorded here for completeness; the review that
preceded it is summarised in the ADRs under `docs/adr/`.

[Unreleased]: https://github.com/bendaamerahmed/backstage-idp-plugin/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/bendaamerahmed/backstage-idp-plugin/releases/tag/v1.3.0
[1.2.4]: https://github.com/bendaamerahmed/backstage-idp-plugin/releases/tag/v1.2.4
[1.2.3]: https://github.com/bendaamerahmed/backstage-idp-plugin/releases/tag/v1.2.3
[1.2.2]: https://github.com/bendaamerahmed/backstage-idp-plugin/releases/tag/v1.2.2
[1.2.1]: https://github.com/bendaamerahmed/backstage-idp-plugin/releases/tag/v1.2.1
[1.2.0]: https://github.com/bendaamerahmed/backstage-idp-plugin/releases/tag/v1.2.0
[1.1.0]: https://github.com/bendaamerahmed/backstage-idp-plugin/releases/tag/v1.1.0
[1.0.0]: https://github.com/bendaamerahmed/backstage-idp-plugin/releases/tag/v1.0.0
