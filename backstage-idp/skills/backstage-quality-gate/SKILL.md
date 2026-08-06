---
name: backstage-quality-gate
description: Validate a Backstage change — discover the repo's real scripts, run targeted test, type-check, lint, build, then repo-wide, and report an honest passed/failed/not-run summary.
when_to_use: Before declaring any Backstage change done or opening a PR. "Verify this change", "run the tests", "does this build", "is this ready to merge", "check the backend bundle", "validate the config", "why does CI fail but local passes".
---

# Backstage quality gate

Prove a Backstage change is sound by running the repository's own validation commands,
narrowest first, and report exactly what ran. A command that did not run and exit zero
is not a pass.

## Preconditions

- The repo is mapped (`backstage-repo-discovery`) or you have read the root
  `package.json` `scripts` and every CI workflow yourself.
- `node_modules` is installed. If not, `yarn install --immutable` is step zero and its
  cost belongs in the summary. Assume `yarn` unless the lockfile says otherwise.
- Node 22 or 24. Any other major invalidates every result — report BLOCKED.
- You know which workspace packages your edits touch (map changed paths → the owning
  `package.json` `name` and `backstage.role`).
- You can run long commands in the background and poll them. Foreground-blocking a
  watch-mode test run or a dev server wastes the whole turn.

## Procedure

1. **Discover the real commands.** Read the root `package.json` `scripts` verbatim, the
   `scripts` of each touched package, and `.github/workflows/*.y*ml` (or GitLab/Circle/
   Azure/Jenkins equivalents). CI is the contract; scripts are a hint. Scaffolded apps
   expose `tsc`, `tsc:full`, `lint` (`repo lint --since origin/<default-branch>`),
   `lint:all`, `test`, `test:all`, `build:all`, `build:backend`, `prettier:check`, `fix`
   — but any of these may be renamed, wrapped, or absent. Record command, working
   directory, and expected duration. Never invoke a script you have not seen defined.

2. **Make runs non-interactive.** `backstage-cli repo test` and `package test` default to
   Jest **watch mode** inside a git repo; run in the foreground they never exit. Pass
   `--watch=false` explicitly, or set `CI=1` (which is what CI does, and also makes
   `repo test` run all tests). Know the side effect: with `CI` set, `TestDatabases` from
   `@backstage/backend-test-utils` stops being SQLite-only and spins up every configured
   engine via testcontainers. Without Docker, prefer `--watch=false` over `CI=1`, or
   supply `BACKSTAGE_TEST_DATABASE_POSTGRES17_CONNECTION_STRING` (and siblings), and say
   which you chose in the summary.

3. **Run the targeted test first.** Jest config from the CLI roots at `src`, requires the
   `.test.` infix, and loads `src/setupTests.ts`. Filter from the repo root
   (`yarn backstage-cli repo test --watch=false packages/app/src/Foo.test.tsx`) or scope
   to the package (`yarn workspace <pkg-name> test --watch=false <pattern>`). Fix here,
   not after a 15-minute repo sweep.

4. **Run the whole touched package's suite** next (`yarn workspace <pkg-name> test
   --watch=false`). This is the cheapest place to catch cross-test leakage; a single
   green test file proves nothing about the file next to it.

5. **Type-check the repo, not the package.** There is no per-package type check — a
   Backstage monorepo is **one TypeScript compilation unit**, with incremental output in
   `dist-types/` at the repo root. Use `yarn tsc` for the fast loop. It runs with
   `skipLibCheck` on, so it does not verify types inside `node_modules`. Before calling
   anything done, run the CI-equivalent `yarn tsc:full`
   (`tsc --skipLibCheck false --incremental false`) in the background — it is slow and it
   is the only check that sees library-level type breakage.

6. **Lint the touched packages** (`yarn workspace <pkg-name> lint`, or
   `yarn backstage-cli package lint` inside it). Each package's `.eslintrc.js` derives
   from `@backstage/cli/config/eslint-factory`, so rules differ by `backstage.role`.
   Check `--max-warnings` in the CI invocation; the default allows warnings and CI often
   does not. Lint does **not** check formatting — run `yarn prettier:check` separately if
   the repo has it.

7. **Build.** `backstage-cli repo build` deliberately **excludes** bundled packages
   (roles `frontend` and `backend`); only `--all` (`yarn build:all`) includes the app and
   backend. Build the app bundle (`yarn workspace app build`) and the backend bundle
   (`yarn build:backend`) explicitly for any change that touches them. A successful
   `repo build` says nothing about either bundle. Background both.

8. **Confirm the backend bundle artifacts.** A backend `package build` writes
   `packages/backend/dist/bundle.tar.gz` plus `packages/backend/dist/skeleton.tar.gz`
   (package.json files only, for Docker layer caching). `ls -l` both. The backend build
   also builds its local dependencies — including the linked `app` package — unless
   `--skip-build-dependencies` is passed, so a failure reported by `build:backend` is
   often a frontend build failure wearing a backend label. Read the first error, not the
   last.

9. **Validate config twice.** `yarn backstage-cli config:check` defaults to
   `app-config.yaml` (+ `app-config.local.yaml`) — that is the dev answer. Then check the
   deployed set explicitly, because passing any `--config` disables the defaults:
   `yarn backstage-cli config:check --config app-config.yaml --config app-config.production.yaml`.
   Add `--strict` to reject keys with no schema, `--frontend` (or `--package app`) to
   check frontend-visible config, `--deprecated` to surface deprecated keys. Use `--lax`
   only to prove shape when env vars are unset, and label the result as such. If you
   added config keys, confirm they appear in `yarn --silent backstage-cli config:schema`.

10. **Then the repo-wide sweep**, in the order CI runs it: `yarn lint:all`, `yarn test:all`
    (or `repo test`), `yarn tsc:full`, `yarn build:all`. Redirect each to a log file,
    background it, poll, and capture the exit code explicitly — for example append
    `; echo "EXIT=$?"` to the log. Read the log, not the terminal tail.

11. **Do not trust caches or ref filters while validating a change.** `--success-cache`
    (default dir `node_modules/.cache/backstage-cli`) skips packages that were unchanged
    and successful on the previous run — a cached pass is not evidence about your change.
    Omit it, or clear the cache dir. For `--since <ref>`, verify the ref resolves
    (`git rev-parse --verify origin/main`) — in a shallow or detached checkout the
    selection can be empty and the command exits zero having tested nothing.

12. **Write the summary.** One line per command: the exact command, scope, exit code,
    wall time, and `PASSED` / `FAILED` / `NOT RUN`. Every `NOT RUN` carries a reason
    (no Docker, no `app-config.production.yaml`, timed out at N minutes, would require
    network). Never silently drop a check. Hand this to `pull-request-ready`; a gate with
    unexplained gaps is a BLOCKED report, not a green one.

## Verification

- Every `PASSED` maps to a command you invoked whose exit code you read as `0`.
- `yarn tsc:full` completed after your last source edit, not before it.
- `ls -l packages/backend/dist/bundle.tar.gz packages/backend/dist/skeleton.tar.gz`
  succeeds when the change touches the backend.
- `config:check` ran against the production config set, not only the defaults.
- The narrowest test from step 3 is re-run once after all edits and still passes.
- No result in the summary came from a `--success-cache` hit or an empty `--since`
  selection.

## Failure modes

- **Watch mode hang.** `yarn test` blocks forever waiting for keypresses; the tool times
  out and the run looks ambiguous. Always `--watch=false` or `CI=1`.
- **Green package, red repo.** Per-package builds emit types independently, but type
  checking is repo-wide. A signature change that compiles in its own package breaks a
  consumer three packages away, and only `yarn tsc` sees it.
- **`skipLibCheck` blindness.** `yarn tsc` passes, CI's `tsc:full` fails on a
  `node_modules` type conflict — typically duplicate `@backstage/*` or `@types/react`
  versions after a partial bump. See `backstage-upgrade`.
- **Stale incremental state.** `dist-types/` from an earlier branch makes `yarn tsc` pass
  on code that cannot compile clean. Re-check with `yarn tsc:full` or `yarn clean`.
- **App builds, backend bundle fails.** The webpack app build and the backend archive
  build share almost nothing. Backend-only breakage: a package missing `backstage.role`,
  a `src` import of a `devDependency`, a subpath export not declared, or a local
  dependency that was never built.
- **Config valid in dev, invalid in prod.** `app-config.production.yaml` is never loaded
  by default, its `${VAR}` substitutions are unset locally, and `--lax` will happily hide
  that. `--strict` then rejects a key whose owning plugin is not installed. Config
  schemas resolve imported types, so one bad import in a schema breaks schema loading
  repo-wide, not just for that plugin.
- **Tests pass alone, fail together.** Shared module state, mutated `process.env`,
  unreset MSW handlers, fake timers, or a reused test database. Reproduce with the full
  package suite; `--runInBand` distinguishes ordering from concurrency.
- **Docker-dependent tests.** `CI=1` switches `TestDatabases` to real engines, and
  TechDocs generation with `techdocs.generator.runIn: docker` needs a daemon. Without
  Docker these are `NOT RUN`, never `PASSED`.
- **Timeout read as success.** A backgrounded build that was killed produced no errors
  because it produced nothing. Absence of output is absence of evidence.
- **Lint green, CI red on formatting.** ESLint and Prettier are separate steps in a
  Backstage repo.

## Do not

- Do not mark a command `PASSED` unless it ran to completion and exited zero, and you
  read that exit code.
- Do not run `yarn test`, `yarn start`, or `repo start` in the foreground.
- Do not use `--success-cache` or rely on `--since` when validating your own change.
- Do not reach for green by adding `@ts-ignore`, `eslint-disable`, `it.skip`, or by
  deleting a failing test; report the failure.
- Do not edit `resolutions`, the lockfile, or package versions to clear a build error
  inside a quality gate — that is an upgrade, and it needs its own review.
- Do not substitute `yarn tsc` for `yarn tsc:full` in the final report, or `repo build`
  for `build:all` / `build:backend`.
- Do not invent script names; if a check has no command in this repo, report it as
  `NOT RUN — no such script` rather than improvising one.
- Do not push, tag, publish, or deploy from this skill.
