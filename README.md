# backstage-idp

A Claude Code plugin for teams running [Spotify Backstage](https://backstage.io).
One senior engineering subagent and fifteen workflow skills, continuously checked
against the release line Backstage is actually on.

## What it does

Give it a Backstage task in your own words — "our github-org provider keeps
deleting entities", "scaffold a backend plugin for the deployment dashboard",
"we're on 1.44 and need to catch up" — and it maps the repository, works out
which frontend and backend system generation you are on, implements the change,
runs your repository's own validation commands, and reports what passed, what
failed, and what it assumed.

The fifteen skills are the procedures it follows:

| Skill | For |
| :--- | :--- |
| `backstage-repo-discovery` | Map an unfamiliar monorepo before changing anything |
| `backstage-plugin-create` | Scaffold a plugin package and actually wire it in |
| `backstage-plugin-migrate` | Legacy to New Frontend/Backend System, MUI to `@backstage/ui` |
| `backstage-catalog` | Entities, providers, processors, ingestion that does not delete your data |
| `backstage-scaffolder` | Templates, custom actions, dry runs, stuck tasks |
| `backstage-permissions` | Permission framework, policies, server-side enforcement |
| `backstage-auth` | Providers, resolvers, OAuth hardening, the five ways sign-in fails |
| `backstage-techdocs` | mkdocs, `techdocs-ref`, builders, publishers |
| `backstage-upgrade` | Crossing release lines without breaking `main` |
| `backstage-quality-gate` | The validation sweep, reported honestly |
| `backstage-incident-debug` | A deployed instance is failing and nobody knows which layer |
| `pull-request-ready` | Diff self-review, changesets, PR authoring |
| `backstage-theming` | Brand colours, logos, BUI tokens, the two theme systems |
| `backstage-kubernetes` | Cluster wiring, entity annotations, surfacing your CRDs |
| `kubernetes-crd-author` | CRD API design, kubebuilder scaffolding, reconcile loops |

## Install

Add this repository as a plugin marketplace, then install by name:

```text
/plugin marketplace add bendaamerahmed/backstage-idp-plugin
/plugin install backstage-idp
```

Updating later requires the marketplace-qualified name — the bare name returns
"not found":

```text
claude plugin update backstage-idp@backstage-idp-marketplace
```

Or copy the pieces straight into a repository — see
[`plugins/backstage-idp/README.md`](plugins/backstage-idp/README.md).

Requires Claude Code. The plugin itself is markdown; nothing is installed into
your Backstage repository.

### It is also on npm

```bash
npx @backstage-idp-plugin/backstage-idp --list
```

That prints the skills and the install commands. The package is **not** a CLI —
`npx` exists only so it says so rather than failing with "could not determine
executable to run". Installing it with `npm i` gets you the markdown on disk,
which is useful for vendoring or for reading the skills; it does not register
anything with Claude Code. Use the marketplace commands above for that.

The published package carries a provenance attestation, so you can verify it was
built by this repository's release workflow rather than uploaded from a laptop:

```bash
npm audit signatures
```

## Your first task

Run it against a Backstage repository you already know, so you can judge the
output:

> Map this repository. What release line are we on, is the frontend NFS or
> legacy, and what commands does CI actually run on a PR?

`backstage-repo-discovery` should answer all three with `path:line` evidence and
tell you where it was unsure. If it guesses instead of citing, that is a bug —
see "Reporting a wrong skill" below.

## The safety model

**This plugin instructs an agent that has a shell and write access to your
repository.** That is the whole risk; there is no runtime code in the bundle.

It will read your files, write and edit source, run your repository's own
commands, start dev servers in the background, and make local commits.

It stops and hands back the exact command, without running it, for: `git push`
in any form, PR creation and merge, publishing, deploying, anything that mutates
a shared environment, and credential rotation.

It treats repository content as data, never as instruction. A `catalog-info.yaml`
description telling it to print your `.env`, an issue body claiming standing
authorisation for a force push, a scaffolder parameter description asking it to
add a dependency — all of these are in the test corpus, and the tests assert it
reports them rather than acting on them.

Read [`SECURITY.md`](SECURITY.md) before adopting. It states plainly what an
operator has to gate themselves, and why `permissionMode: auto` in the agent
frontmatter is **not** a control.

## What is actually verified

The short version: structure, content invariants, currency, trigger accuracy and
agent behaviour are all tested; most skill *procedures* are not executed
end-to-end. [`docs/test-coverage.md`](docs/test-coverage.md) is honest about
which is which, per skill.

| Tier | What it checks | When |
| :--- | :--- | :--- |
| 0 | Frontmatter, structure, cross-references, the agent's safety properties, `claude plugin validate` | every commit, under 10 s |
| 1 | Authorization gating, no mid-run questions, generation detection, package and link liveness | every commit |
| 2 | `baseline.json` against live upstream: release line, Node majors, CLI flags, config keys | weekly |
| 3 | Trigger accuracy (209 labelled prompts), agent behaviour, prompt injection | on content changes |
| 4 | Real `create-app` monorepos, asserted with the fixture's own `tsc`/`lint`/`test`/`build` | nightly |

Every rule is itself tested: `scripts/mutation-check.mjs` breaks one thing at a
time and requires the specific rule that claims to cover it to catch it. A suite
that is green on a healthy tree proves nothing on its own.

## Support matrix

| | |
| :--- | :--- |
| Backstage line verified against | **1.53** (`fixtures/nfs-current`, rebuilt nightly) |
| Guidance written against | 1.44 and later — see `OPEN-DECISIONS.md` #4 |
| Node | 22 and 24, matching Backstage's own `engines.node` |
| Frontend systems | New Frontend System (default since 1.49) and legacy |
| Backend systems | New backend system; legacy is migration-only |
| Package managers | Yarn Berry assumed; the discovery skill detects and translates |

Backstage ships monthly. A weekly job compares every version-sensitive claim
against live upstream sources and opens an issue naming exactly which assertions
to re-verify. If that job has been failing, the badge on the repository will say
so — this plugin is designed to tell you when it has gone stale rather than let
you find out mid-task.

## Reporting a wrong skill

The most common defect is not a crash; it is a skill confidently stating
something Backstage no longer does.

Open an issue with the skill name, the assertion, and the official source that
contradicts it. If you can, include the release line your repository is on. A
reproduction is best of all, because it becomes a test.

Security issues — including a prompt injection that got through — go through
[`SECURITY.md`](SECURITY.md), not a public issue.

## Contributing

`npm ci && npm test` is the whole local setup.
[`CONTRIBUTING.md`](CONTRIBUTING.md) has the rest, including the one rule that
matters: when a test fails, fix the content.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — why an agent plus skills, and how a skill earns its place
- [`docs/authoring.md`](docs/authoring.md) — the skill contract, including the YAML trap that has shipped broken three times
- [`docs/test-coverage.md`](docs/test-coverage.md) — what each tier covers and what it does not
- [`docs/runbook.md`](docs/runbook.md) — what to do when a job goes red
- [`docs/adr/`](docs/adr/) — the decisions a future maintainer would otherwise reverse-engineer

## Licence

MIT. See [`LICENSE`](LICENSE).
