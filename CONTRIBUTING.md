# Contributing

## Run everything

```bash
npm ci && npm test
```

That is the whole local setup. Node 22 or 24, nothing else required.

`npm test` runs every tier that can run in your environment and prints a summary
saying which ones did not run and what command would run them. A tier is never
silently skipped.

| Command | What it runs | Typical time |
| :--- | :--- | :--- |
| `npm run test:fast` | Tier 0 + Tier 1 offline | under 10 s |
| `npm test` | everything available, plus the coverage summary | 1-3 min |
| `npm run test:currency` | Tier 2, hits live npm and backstage.io | 30 s |
| `npm run test:tier3` | trigger evals + injection corpus | 1-2 min |
| `npm run fixtures:build` | builds the Tier 4 Backstage fixtures | 10-25 min, once |
| `npm run test:integration` | Tier 4 against those fixtures | 20-40 min |
| `npm run lint:md` | markdownlint | 2 s |

## How to read a failure

Every rule failure names the file, the line, what was found, what was expected,
and what to do — plus a `because:` line explaining what breaks if the rule is
removed. If you hit a rule you did not write and the `because:` does not convince
you, that is a legitimate thing to argue about in the PR. What is not legitimate
is relaxing the rule so the content passes.

**When a test fails, fix the content.** If the content is right and the test is
wrong, say so explicitly in the PR body and change the test in its own commit
with the reasoning. A test weakened in the same commit as the content it was
catching is the one review pattern that will get a PR rejected.

## Commit conventions

- One logical change per commit. Content changes and test changes go in separate
  commits, unless the test is new.
- The message body explains **why**, not what — the diff already says what. This
  repository's history is part of the deliverable; it is how the next maintainer
  learns which decisions are load-bearing.
- When you correct a Backstage fact, cite the official source in the commit body
  and update `baseline.json` with a fresh `verifiedOn` in the same commit.

## Changing plugin content

1. Read `docs/authoring.md` first. It is the skill contract, and Tier 0/Tier 1
   enforce most of it mechanically.
2. Never state a version-sensitive fact as settled. If it cannot be verified from
   official Backstage documentation *today*, mark it version-sensitive and
   instruct reading the installed package's types.
3. A change to a skill's `description` or `when_to_use` changes what fires. Run
   `npm run evals` and check the per-skill precision and recall in
   `test/tier3/thresholds.json` did not regress.
4. A change to a skill's `Procedure` needs a Tier 3 or Tier 4 scenario covering
   it, or an explicit entry in `docs/test-coverage.md` saying it is unverified.

## Changing the safety properties

The agent's `background: false`, the absence of `AskUserQuestion`, the absence of
`isolation` and the absence of `maxTurns` each have a dedicated Tier 0 rule and a
dedicated ADR. Each was already the cause of a real failure mode.

Changing one requires, in this order:

1. Evidence that the platform behaviour changed — a link, a version, a
   reproduction.
2. An update to the ADR recording the new evidence and superseding the old
   decision.
3. The Tier 0 rule updated in its own commit, referencing the ADR.
4. The frontmatter change.

Deleting the rule to make a run pass is not a contribution.

## Branch protection

The `main` branch is expected to be configured with:

- No direct pushes; changes land through a pull request.
- Required status checks: `validate (node 22)`, `validate (node 24)`,
  `evals`, `secret-scan`, `dependency-review`.
- At least one approving review, from `CODEOWNERS` for changes under
  `plugins/**`, `test/tier0/**`, `baseline.json` and `.github/workflows/**`.
- Dismiss stale approvals on new commits.
- Require branches to be up to date before merging.
- Require linear history.
- Include administrators.

The nightly integration job and the weekly currency job are **not** required
checks. They are slow and depend on live upstream state; blocking merges on them
would mean a Backstage release could block unrelated work. They open issues
instead — see `docs/runbook.md`.

Some of this cannot be configured until `OPEN-DECISIONS.md` #1 and #2 are
resolved.

## Releasing

Releases are cut by a maintainer, never by CI on a push.

```bash
node scripts/set-version.mjs <version>
# edit CHANGELOG.md: move Unreleased entries under the new version
npm test
npm run check:release-gate
git commit -am "Release v<version>"
git tag -a v<version> -m "v<version>"
```

Pushing the tag triggers the release workflow, which builds the `.plugin`
artifact, generates notes from `CHANGELOG.md`, attaches the artifact, updates the
marketplace entry, and publishes to npm. `check:release-gate` fails while any
item in `OPEN-DECISIONS.md` is unresolved, so no placeholder can reach a
published artifact.

### npm publishing

The package is `@backstage-idp-plugin/backstage-idp`, published by **OIDC trusted
publishing** — there is no `NPM_TOKEN` secret and nothing to rotate. The npm
registry trusts a specific workflow file in a specific repository, and each
publish uses a short-lived credential that cannot be extracted or reused.

Configured on npmjs.com under the package's Settings → Trusted Publisher:

| Field | Value |
| :--- | :--- |
| Publisher | GitHub Actions |
| Organization or user | `bendaamerahmed` |
| Repository | `backstage-idp-plugin` |
| Workflow filename | `release.yml` |
| Environment name | *(empty)* |
| Allowed actions | `Allow npm publish` |

Two constraints that are easy to get wrong:

- **npm must be 11.5.1 or later and Node 22.14.0 or later.** Node 22 clears the
  Node floor but bundles npm 10.9.8, which cannot do OIDC at all — and the
  failure is a generic auth error that says nothing about the npm version. The
  npm job therefore runs on Node 24 and asserts the npm version explicitly
  before it tries to publish.
- **Do not add `NODE_AUTH_TOKEN` or `--provenance`.** The CLI detects the OIDC
  environment on its own, and provenance is generated automatically. An unset
  `NPM_TOKEN` secret expands to an empty string, which reads as a configured
  token and fails more confusingly than having none.

If `Environment name` is ever filled in on npmjs.com, the `npm` job must also
declare a matching `environment:` or every publish will be rejected.
