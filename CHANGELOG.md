# Changelog

All notable changes to the `backstage-idp` plugin are documented here.

The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versioning applies to the **plugin**, not to the harness around it. A change that
alters what the agent or a skill instructs is a plugin change and gets an entry.
A change to the tests, CI or docs does not, unless it changed plugin content as a
result — in which case the content change is what is listed.

## [Unreleased]

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
tested, no release process. Recorded here for completeness — see
`archive/HARDENING-REPORT.md` for the review that preceded it.

[Unreleased]: https://github.com/bendaamerahmed/backstage-idp-plugin/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/bendaamerahmed/backstage-idp-plugin/releases/tag/v1.1.0
[1.0.0]: https://github.com/bendaamerahmed/backstage-idp-plugin/releases/tag/v1.0.0
