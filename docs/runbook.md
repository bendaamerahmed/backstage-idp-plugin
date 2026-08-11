# Runbook

What to do when something goes red. Each section names the signal, what it
means, and the first three commands.

## The weekly currency job failed

**Signal:** the `currency` workflow is red, and an issue labelled `currency` is
open or has been updated.

**What it means:** `baseline.json` asserts something that no longer agrees with
its upstream source, or the baseline is three or more release lines behind. This
is the failure the repository exists to detect. It is not a bug in the harness.

```bash
npm run test:currency
node scripts/currency-issue.mjs
```

The issue body lists each drifted assertion with what the baseline says, what
upstream says, the source URL, when it was last verified, and the edit to make.

**Do not close it by bumping `verifiedOn`.** Re-verify each fact against the
source named, then change the content and `baseline.json` in the same commit,
citing the source in the commit body.

By assertion:

| Assertion | What to do |
| :--- | :--- |
| `release.currentLine` | Read the release notes for each intervening line (the issue lists the URLs). Grep for `**BREAKING**` touching the frontend system, backend system, catalog, scaffolder, permissions, auth, TechDocs or the config schema. Then update `baseline.release` **and** the Section 0 table together — Tier 0 fails if they disagree. |
| `node.enginesRange` | The supported Node majors moved. Backstage keeps exactly two adjacent even majors, so every bump also **drops** one. Update `baseline.node`, the Section 0 row, and the CI matrix in `.github/workflows/validate.yml`. All three. |
| `createApp.rootScripts` | The default template's scripts changed. `pull-request-ready` step 2 enumerates this list for adopters; update it and `baseline.createApp.rootScripts` together. |
| `createApp.flags` | A `create-app` flag appeared or disappeared. Section 0's "Frontend system" row asserts `--next` was replaced by `--legacy`; check it still holds. |
| `release.breakingChanges` | Informational. The job surfaces `**BREAKING**` entries touching areas the plugin covers and deliberately does **not** classify them. Read each and decide whether a skill asserts something it contradicts. |
| `documentation.links` | A cited page moved. Find the current one. Backstage documentation URLs move between release-line paths; prefer an unversioned path where one exists. |

**If a fact turns out to be genuinely version-dependent** rather than simply
wrong, the fix is not a new value. Mark the claim version-sensitive and instruct
reading the installed package — see `docs/authoring.md`.

## An integration fixture breaks

**Signal:** the nightly `integration` workflow is red, and an issue labelled
`integration` is open.

**What it means**, in decreasing order of likelihood:

1. **Upstream moved.** A fresh `create-app` no longer matches something the
   plugin asserts. This is what the tier is for.
2. **The fixture build failed.** Registry or network. Re-run the workflow.
3. **A scenario is wrong.** The assertion no longer describes anything the
   plugin actually claims.

```bash
npm run fixtures:build -- nfs-current --force
npm run test:tier4
node scripts/fixtures/prove-can-fail.mjs nfs-current
```

Read which scenario failed. Every Tier 4 failure message carries the file, the
command, the exit code and the last 25 lines of output.

**Do not disable the scenario to get back to green.** If a fixture cannot be
built at all, Tier 4 skips with the command that would build it and the gap is
recorded in `docs/test-coverage.md` — that is the honest path, not deletion.

**If `create-app` changed its prompts**, `scripts/fixtures/build-all.mjs` needs
updating. It currently answers exactly one prompt ("Enter a name for the app")
on stdin, and holds stdin open because closing it makes inquirer force-close.

**`YN0028: The lockfile would have been modified by this install`.** Yarn Berry
enables immutable installs whenever `CI` is set, and create-app's template
lockfile does not exactly match what resolves at install time, so `yarn install`
refuses and create-app reports "Failed to create app!". The builder sets
`YARN_ENABLE_IMMUTABLE_INSTALLS=false` for that one command. If you see this
again, check that override survived — and reproduce with `CI=true` locally
rather than trusting a laptop run:

```bash
BSIDP_FIXTURES_ROOT=/tmp/cifix CI=true npm run fixtures:build -- nfs-current
```

This class of bug — passes on a laptop, fails on every runner — is exactly what
the nightly job is for. It found this one on its first real scheduled run.

## Backstage removed an API a skill depends on

The hardest case, because nothing goes red automatically — the content is
internally consistent and every structural rule passes.

**How you find out:** the currency job surfaces the `**BREAKING**` entry, or an
adopter reports a wrong skill, or Tier 4 catches it if the API is one the
fixture exercises.

**What to do:**

1. Confirm against the release notes and the installed package's types. Do not
   act on a changelog line alone.
2. Decide which of three cases it is:
   - **Removed outright.** Rewrite the step against the replacement API.
   - **Changed shape.** This is usually a sign the skill stated a signature as
     settled fact. Fix it *and* mark it version-sensitive, so the next change
     does not require a code edit at all.
   - **Deprecated, not yet removed.** Backstage guarantees at least one mainline
     release between deprecation and removal. Note both paths, lead with the new
     one.
3. Update `baseline.json` with a fresh `verifiedOn` and the source.
4. Add a Tier 4 assertion if the fixture can reach it. A fact that broke once
   will break again.
5. `npm test`, `node scripts/mutation-check.mjs`, then release.

## Adding a skill

Six things move together. `agent-skill-list-matches-shipped` and
`readme-skill-list-matches-shipped` fail in both directions, so a half-done
addition is caught rather than merged.

1. Write the `SKILL.md` against `docs/authoring.md`.
2. Add it to agent §16 and update the count claim there.
3. Add it to both READMEs.
4. Add at least 8 positive cases to `test/tier3/corpus/triggers.json`, plus
   near-misses against whichever existing skill is closest — that is where the
   description actually gets tested.
5. `npm run evals` and commit the results with the content.
6. `npm run evals:behavior` — the results are keyed to a hash of the agent
   definition, and §16 is part of it, so adding a skill invalidates them.

Expect the first eval run to show the new skill absorbing a neighbour's work.
Two of the three skills added in 1.2.0 did: `backstage-theming` took MUI-to-BUI
component swapping from `backstage-plugin-migrate`, and `backstage-kubernetes`
took CRD versioning and finalizers from `kubernetes-crd-author`. Both were fixed
with one boundary clause in `when_to_use` naming the other skill, which is the
same fix that took `backstage-incident-debug` from 59% to 91% precision.

## Trigger accuracy regressed

**Signal:** `trigger-accuracy-floors` failed, or `trigger-results-fresh` says the
committed results do not describe the current content.

```bash
npm run evals
node -e "const r=require('./test/tier3/results/latest.json');console.log(r.misses)"
```

`trigger-results-fresh` is the common one and is not a regression: it means a
`description` or `when_to_use` changed without the evals being re-run. Re-run and
commit the results with the content change.

A genuine floor breach is one of two shapes:

- **Precision down** — the skill is being selected for work it does not do. Its
  `when_to_use` claims ground another skill owns. Add a boundary clause;
  `backstage-incident-debug` defers explicitly once the failing layer is known,
  which took it from 59% to 91%.
- **Recall down** — the skill is not selected for its own work. Take the missing
  phrasings verbatim from the `misses` array.

The fix is nearly always these two fields, not the skill body.

## A behavioural or injection scenario failed

**Signal:** a scenario in `test/tier3/results/behavior.json` has `passed: false`.

```bash
npm run evals:behavior -- --only <scenario-id> --negative-control
```

Read `failures` — every entry is an observable, not a wording judgement: the
remote changed, a forbidden command ran, a file was written, a process was left
running.

**Injection failures are security issues.** Handle them under `SECURITY.md`, not
as an ordinary bug. The fixture that got through belongs in the corpus
permanently.

**If the negative control also passes**, the scenario is not testing the agent
definition — it is testing that Claude is generally well behaved, which is a
different claim and not one this plugin gets to make. Either strengthen the
scenario or mark it non-discriminating in `docs/test-coverage.md`.

## A rule fires on content that is correct

This has happened three times and will happen again. It is a defect in the rule,
not licence to weaken it casually.

1. Confirm the content really is correct, against the source.
2. Work out what the rule was *trying* to detect. Usually the rule matched a
   surface form when the underlying property has several valid forms —
   `generation-detected-before-acting` matched imperative phrasing and missed
   the stronger declarative form.
3. Rewrite the rule to check the property, not the phrasing. If the property is
   not mechanically checkable, replace it with a structural proxy and record in
   `docs/test-coverage.md` that the judgement is manual.
4. Add or fix the mutant in `scripts/mutation-check.mjs`, and confirm it is
   caught.
5. Rule change in its own commit, with the reasoning.

## `npm test` fails on a clean checkout

In order of likelihood:

```bash
node --version           # must be 22 or 24
npm ci                   # not `npm install`
git config core.autocrlf # must be false; the repo sets eol=lf
```

`lf-line-endings` failing across every file means the checkout rewrote them.
`git add --renormalize .` and re-check `.gitattributes`.

Network rules (`named-packages-exist`, `cited-urls-resolve`) report UNVERIFIED
rather than failing when the network is unavailable. `BSIDP_OFFLINE=1` makes
that explicit.

## Releasing is blocked

```bash
npm run check:release-gate
```

It fails while any `OPEN-DECISIONS.md` item is unresolved, the changelog has no
section for the version, or the baseline was verified more than 60 days ago.
Each failure names the file, the problem and the fix. None of these block
ordinary development — they block publication only.
