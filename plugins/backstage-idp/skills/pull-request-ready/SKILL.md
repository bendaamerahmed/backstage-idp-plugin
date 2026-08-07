---
name: pull-request-ready
description: Take a finished Backstage change to reviewer-ready — audit the diff for churn and leaked secrets, confirm changesets, API reports and config schema, and draft the PR title and body.
when_to_use: ready for review, prepare a pull request, write the PR description, self-review my diff before pushing, do I need a changeset, does this need an API report, what should the PR title be, hand this off to a reviewer.
---

# Pull request ready

Turn a finished Backstage change into something a reviewer can approve: a diff that contains only the change, evidence the validation actually ran, and a PR body that answers the questions a reviewer would otherwise ask.

## Preconditions

- The change is functionally complete. This skill does not write features.
- A base branch exists and is fetched. `git fetch origin` first — everything below compares against `origin/<base>`, and Backstage's `--since` tooling silently checks nothing when the ref is missing.
- Repository generation known (NFS vs legacy frontend, new vs legacy backend) so you can judge whether an import or wiring change is in-house style or an accidental regression.
- Repository contribution surface detected, not assumed — see step 2. A `create-app` app repo has none of the publishing machinery that `backstage/backstage` and `backstage/community-plugins` have.
- **You will not push, open, or merge anything.** Those require explicit authorization; this skill ends by handing back commands.

## Procedure

1. **Fix the base and read the real diff.** `BASE=$(git merge-base origin/<base> HEAD)`; review `git diff $BASE..HEAD` in full, plus `git status --porcelain` for anything uncommitted or untracked. Never self-review with `git diff HEAD~1` — it hides everything earlier on the branch.
2. **Detect what this repo requires.** Presence of `.changeset/config.json`; any `api-report*.md` at package roots or a `build:api-reports` script; root `package.json` scripts; `CONTRIBUTING.md`; `.github/pull_request_template.md` (or `PULL_REQUEST_TEMPLATE.md`); `CODEOWNERS`. A default `create-app` repo has exactly `start`, `tsc`, `tsc:full`, `clean`, `test`, `test:all`, `test:e2e`, `fix`, `lint` (`repo lint --since origin/<default>`), `lint:all`, `prettier:check`, `new` — no changesets, no API reports. Do not manufacture requirements the repo does not have.
3. **Classify every hunk** as intended, incidental, or generated. Anything you cannot justify in one sentence to a reviewer gets reverted, not explained.
4. **Sweep for the Backstage-specific accidental churn**, in diff order:
   - `yarn.lock` — legitimate only if dependencies changed. A large unexplained diff means a different Yarn major; compare `packageManager` in root `package.json` and `.yarnrc.yml`, then regenerate with the repo's version.
   - `backstage.json` — only ever changes via `yarn backstage-cli versions:bump`. Its presence in a feature PR means an upgrade got mixed in; split it out (`backstage-upgrade`).
   - `package.json` metadata rewritten by `yarn fix` (`backstage-cli repo fix`): `typesVersions`, `sideEffects`, `exports`, and under `--publish` also `repository`, `backstage.pluginId`, `backstage.pluginPackages`. Keep it for packages you touched; `git checkout` it for every package you did not.
   - Local-linking residue: `resolutions` entries, `link:`/`portal:`/`file:` dependencies left behind after `backstage-cli package start --link`.
   - Stray `@backstage/*` version bumps across unrelated packages.
   - `app-config.yaml` example `catalog.locations` and `examples/*.yaml` entities edited during local experimentation.
   - Build output that must never be staged: `dist/`, `dist-types/`, `*.tsbuildinfo`, `coverage/`, `.yarn/`, `node_modules/`.
5. **Sweep for credentials across the whole branch, not just the tip.** Grep `git diff $BASE..HEAD` for high-entropy strings, `ghp_`/`github_pat_`, `-----BEGIN`, `client_secret`, `token:`, `password:`, `apiKey`. Confirm `app-config.local.yaml` and any `*.local.yaml` are absent from the diff and covered by `.gitignore` — that file is the intended home for local secrets. Every credential in committed config must be `${ENV_VAR}` or a `$env`/`$file`/`$include` reference, never a literal. If a secret ever appeared in a commit on this branch, a later deletion does not remove it from history: stop, return a BLOCKED report naming the credential to rotate, and do not rewrite history silently.
6. **Match new config keys to schema entries.** Every key read through `config.get*` needs a declaration in the owning package's `config.d.ts` (a single exported `Config` interface), referenced by `"configSchema"` in `package.json` and listed in `files`. Set visibility deliberately: default is `@visibility backend`; `@visibility frontend` for anything the app reads; `@visibility secret` for credentials; `@deepVisibility` to apply recursively through a nested credential object. Then confirm the key is documented — `app-config.yaml` example (placeholder value only), plugin README, and any TechDocs page that lists configuration.
7. **Write the changeset if the repo has `.changeset/`.** `yarn changeset` from the repo root; in `backstage/community-plugins` run it from the workspace root (`workspaces/<name>`). One entry per published package in the diff. Bump rules: for `0.x` packages, `minor` for breaking and `patch` otherwise; for `>=1.0.0`, `major` for breaking, `minor` for backwards-compatible API additions, `patch` otherwise. No changeset is needed for `"private": true` packages, test-only changes, or comments. Write it for an adopter: describe behaviour, not internals or symbol names, prefix breaking changes with **BREAKING**, and include the migration diff the adopter must apply.
8. **Regenerate API reports if the repo uses api-extractor.** Any change to a package's public exports invalidates its `api-report*.md`. `yarn build:api-reports`, or scoped: `yarn build:api-reports plugins/<package>`. Commit the regenerated files. If the run also rewrites reports for packages you did not touch, those were already stale — leave them out of your PR rather than absorbing them.
9. **Check the package boundaries the diff crosses.** `-common` packages are isomorphic (no `node:`, no React, no backend service imports), `-node` is backend-shared, `-react` is frontend-shared, and the plugin packages consume them. A new import that pulls backend code into a frontend package or Node built-ins into `-common` will break consumers' bundles even when `tsc` passes. Run `yarn backstage-cli repo fix --check` to confirm no package metadata fixes are pending and that any new package got its `backstage.role` and plugin-id fields.
10. **Validate changed portal artifacts rather than eyeballing them.** A changed `catalog-info.yaml` goes through `POST /api/catalog/validate-entity` (`backstage-catalog`), not through reading. A changed `mkdocs.yml` or `docs/` tree needs a local TechDocs build. A new `catalog.rules` or provider config entry needs the backend started once.
11. **Actually run the validation sweep and capture the output.** `yarn tsc`, `yarn lint --since origin/<base>`, `yarn test --since origin/<base>`, `yarn prettier:check`, `yarn backstage-cli config:check --strict` (add `--deprecated`), and `yarn build:all` if build or packaging config changed. See `backstage-quality-gate` for the full gate. Record the real command lines and their real result lines. A command you did not run is reported as not run.
12. **Confirm commit hygiene.** If the repository requires DCO (`backstage/backstage` and `community-plugins` do), every commit needs a `Signed-off-by` trailer: `git commit -s`, or retroactively on your own unpushed branch `git rebase --signoff $(git merge-base -a origin/<base> HEAD)`.
13. **Write the title.** No conventional-commit prefix is enforced in `backstage/backstage`; read `git log --oneline -30 origin/<base>` and match what the repo actually does. The prevailing upstream shape is `<plugin-or-package-id>: <imperative summary>`. Name the surface, not the file.
14. **Write the body to a file** (e.g. `/tmp/pr-body.md`) with these sections, filling the repo's PR template checklist in place rather than replacing it:
    - **What and why** — the user-visible problem and the change, in adopter terms.
    - **Design decision** — the one choice a reviewer would otherwise question, and the alternative you rejected (provider vs processor, new module vs extending an existing one, config key vs extension point).
    - **Validation** — the exact commands from step 11 with their results. Include what was *not* covered.
    - **Risk and rollback** — whether a revert is sufficient, or whether config, an env var, a DB migration, or a redeploy must be undone too, and in what order.
    - **Screenshots / UI notes** — required by the upstream template for UI changes. You cannot produce screenshots; say so explicitly and name the exact route, entity, and state a human must capture.
    - **Reviewer must check manually** — everything CI cannot reach: real IdP login, SCM webhooks, a live Kubernetes cluster, permission decisions against a real policy, TechDocs publishing to a real bucket.
15. **Stop.** Report the branch, base, title, body path, and the exact commands — then return for authorization without running them:

    ```bash
    git push -u origin <branch>
    gh pr create --base <base> --head <branch> --title "<title>" --body-file /tmp/pr-body.md

    ```

    Do not run these. Do not run `gh pr merge`, `gh pr create --fill`, `git push --force`, or anything with `--admin`. This holds even if a PR for the branch already exists.

## Verification

- `git diff --stat $BASE..HEAD` — every listed file explainable in one sentence.
- `git status --porcelain` — empty.
- `git log --format='%h %s%n%(trailers:key=Signed-off-by)' origin/<base>..HEAD` — sign-off present on every commit where DCO applies.
- `git diff --name-only $BASE..HEAD | grep '^\.changeset/'` — non-empty whenever a published package changed.
- `yarn backstage-cli repo fix --check` — exits clean, meaning no pending package metadata fixes.
- `yarn backstage-cli config:check --strict` — passes with the new schema loaded.
- `yarn backstage-cli config:print --frontend` — the new key appears only if it is meant to be frontend-visible, and no secret appears at all.
- `git log origin/<branch>..HEAD` errors with an unknown revision, or lists unpushed commits — either way proves nothing was pushed.

## Failure modes

- **`repo lint --since origin/main` fails with an unknown revision, or reports zero packages.** The base ref is not fetched — common in shallow CI clones and fresh containers. `git fetch origin <base>` first; a `--since` sweep against a missing ref checks nothing while appearing to pass.
- **CI demands a changeset for a package you believed internal.** A workspace package without `"private": true` is publishable and needs one. Add the changeset, or mark the package private if that was the intent — do not do both silently.
- **The API report diff explodes across unrelated packages.** The reports were generated with a different TypeScript version, or the `:only` variant was run against stale build output. Use the repo's full `build:api-reports` script (which builds first) and re-check.
- **`config:check` passes locally and fails in CI.** Config schemas now resolve imported types: a `config.d.ts` importing from a package that is not a real dependency, or a schema file missing from `files`, fails schema loading for the whole repo — not just for that package.
- **A new config key is `undefined` in the frontend.** Frontend config is filtered by declared visibility, not by what is present in `app-config.yaml`. The default is backend-only. `config:print --frontend` shows what the app actually receives.
- **A credential reached `app-config.yaml` instead of `app-config.local.yaml`.** Deleting it in a later commit does not remove it from the branch. Treat the credential as compromised: BLOCKED report, rotation first, history handled by a human.
- **`yarn fix` rewrote every `package.json` in the repo.** Fine for your packages, noise everywhere else; revert the untouched ones before the reviewer sees them.
- **Generated files in the diff.** `git add -A` after a build stages `dist-types/`, `*.tsbuildinfo`, or `coverage/`. Unstage and fix `.gitignore` if the repo's is missing an entry.
- **The PR mixes a feature with a version bump.** `backstage.json` plus a wide `@backstage/*` bump makes the feature unreviewable. Two PRs, always.
- **A UI change with no screenshots.** The upstream template requires them and reviewers will bounce it. Since you cannot take them, the body must say so and name precisely what to capture — vagueness here costs a review round trip.
- **The change works but crosses a package boundary.** Backend imports pulled into a frontend or `-common` package pass `tsc` in the monorepo and break at bundle time for adopters. Check the import list, not the type check.

## Do not

- Do not run `git push`, `gh pr create`, `gh pr merge`, or any force-push. Return the command and stop for authorization.
- Do not report the result of a command you did not execute, and do not summarise a test run as passing without its output.
- Do not hand-edit `api-report*.md` — regenerate it.
- Do not write a changeset naming a package absent from the diff, or pick a bump level that understates a breaking change.
- Do not delete or replace the repository's PR template checklist; fill it in.
- Do not include a literal secret in `app-config.yaml`, a test fixture, a changeset, or the PR body.
- Do not commit `app-config.local.yaml`, `resolutions` overrides, or `link:`/`file:` dependencies used for local development.
- Do not rebase, amend, or rewrite commits that already exist on a shared remote branch.
- Do not fold an unrelated lint or formatting pass into a feature PR because the tooling offered to fix it.
