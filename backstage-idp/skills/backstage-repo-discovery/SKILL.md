---
name: backstage-repo-discovery
description: Map an unfamiliar Backstage monorepo — release line, frontend/backend generation, plugin inventory, config layering, real validation commands — before changing anything.
when_to_use: First step in any Backstage task in a repo you have not mapped this session. "What version of Backstage is this", "is this NFS or legacy", "how do I build/test this repo", "where is the permission policy", "orient me in this Backstage repo".
---

# Backstage repo discovery

Produce a compact, evidence-backed map of a Backstage monorepo. Every other Backstage
skill assumes this map exists. Detect by import source and composition, never by
version number alone.

## Preconditions

- Repository root is readable and `ripgrep` (`rg`) is available; fall back to `grep -rn`.
- Discovery is read-only: no installs, builds, or codegen.
- If `backstage.json`, `packages/app` and `packages/backend` are all absent, this is
  probably a standalone plugin repo, not an app monorepo; note that and adapt.

## Procedure

1. **Anchor the repo.** Read `backstage.json` at the root — its `version` field is the
   release line the app was last bumped to (not the version of any single package).
   Read root `package.json`: `name`, `workspaces` globs, `engines.node`,
   `packageManager`, `resolutions`, and the whole `scripts` block. Record all of it.

2. **Package manager and Node.** `yarn.lock` + `.yarnrc.yml` means Yarn Berry (Backstage's
   default; recent scaffolds pin Yarn 4.x via `packageManager` + `corepack`).
   `package-lock.json` or `pnpm-lock.yaml` means the repo diverged from upstream — every
   later command must be translated. Current Backstage supports Node 22 and 24 only; an
   `engines.node` allowing older majors means the repo is behind.

3. **Inventory packages.** Expand every `workspaces` glob (commonly `packages/*` and
   `plugins/*`). For each, capture `name`, `version`, `private`, and `backstage.role` from
   its `package.json`. `backstage.role` (`frontend-plugin`, `backend-plugin`,
   `backend-plugin-module`, `node-library`, `web-library`, `common-library`, `frontend`,
   `backend`) is the authoritative statement of what a package is — trust it over naming.

4. **Detect the frontend generation.** Run all of these and reason from the hits, not
   from the release line:
   - NFS: `rg -n "@backstage/frontend-defaults|@backstage/frontend-plugin-api|@backstage/frontend-test-utils" packages plugins`
   - NFS composition: `rg -n "createFrontendPlugin|createFrontendModule|PageBlueprint|ApiBlueprint|EntityCardBlueprint|EntityContentBlueprint" packages plugins`
   - A `NavItemBlueprint` hit dates the app: it was removed in v1.51.
   - Legacy: `rg -n "@backstage/app-defaults|createRoutableExtension|createComponentExtension|<FlatRoutes|bindRoutes" packages plugins`
   - `/alpha` consumption: `rg -n "from '@backstage/plugin-[^']*/alpha'" packages/app/src`
   - Hybrid bridge: `rg -n "@backstage/core-compat-api|convertLegacyApp" packages/app/src`

   Decide: **NFS** if `createApp` in `packages/app/src/App.tsx` comes from
   `@backstage/frontend-defaults` (NFS `app.createRoot()` takes no arguments);
   **legacy** if it comes from `@backstage/app-defaults` and JSX with `<FlatRoutes>` is
   passed to `createRoot`; **hybrid** if an NFS app pulls legacy features through
   `@backstage/core-compat-api`, or a legacy app consumes `/alpha` exports. Hybrid is
   common and normal — record which side each plugin sits on, per plugin.

5. **Detect the backend generation.** Read `packages/backend/src/index.ts` first.
   `createBackend` from `@backstage/backend-defaults` plus a run of `backend.add(...)`
   calls is the new backend system. `createServiceBuilder`, `makeCreateEnv`, a
   `types.ts` exporting `PluginEnvironment`, or a `packages/backend/src/plugins/*.ts`
   directory of `createRouter` wirings is the legacy backend. `rg -n "legacyPlugin\("
   packages/backend/src` marks a hybrid backend still bridging old plugin files.
   In local backend plugins, `rg -n "createBackendPlugin|createBackendModule|createExtensionPoint"`
   confirms new-system authoring.

6. **Map app-config layering.** `ls app-config*.yaml`. Backstage loads `app-config.yaml`
   then `app-config.local.yaml` by default; any other file (`app-config.production.yaml`,
   `app-config.staging.yaml`) only applies when passed with `--config`, so find who
   passes it: search `Dockerfile*`, Helm/`k8s` manifests, CI workflows and the root
   `scripts` for `--config`. Note `${VAR}` / `${VAR:-default}` substitutions,
   `$env`/`$file`/`$include` keys, and that `APP_CONFIG_*` env vars override everything.
   `BACKSTAGE_ENV` accepts comma-separated values to stack configs.

7. **Read the feature config surface** out of the merged config files, recording the file
   each key came from:
   - `integrations.*` — which SCM hosts (top-level `bitbucket` was removed; expect
     `bitbucketCloud` / `bitbucketServer`).
   - `auth.environment`, `auth.providers.*`, sign-in resolvers, installed
     `@backstage/plugin-auth-backend-module-*` packages, and how the app supplies a
     sign-in page. See `backstage-auth`.
   - `permission.enabled`, and whether
     `@backstage/plugin-permission-backend-module-allow-all-policy` is still wired or a
     custom `PermissionPolicy` is registered via `policyExtensionPoint` (typically under
     `packages/backend/src/extensions/`).
   - `catalog.locations`, `.providers`, `.rules`, `.processingInterval`, `.orphanStrategy`,
     plus processors/providers registered through `catalogProcessingExtensionPoint`;
     count in-repo `catalog-info.yaml` files.
   - `scaffolder.*`, `rg -l "apiVersion: scaffolder.backstage.io" --glob '*.yaml'` for
     templates, `rg -n "createTemplateAction|scaffolderActionsExtensionPoint"` for custom
     actions, and custom field extensions in the app.
   - `techdocs.builder` (`local` vs `external`), `techdocs.generator.runIn`
     (`docker`/`local`), `techdocs.publisher.type` (`local`/`googleGcs`/`awsS3`/
     `azureBlobStorage`); count `mkdocs.yml` files.
   - `search.*` — `plugin-search-backend-module-elasticsearch` (`search.elasticsearch`) or
     `-module-pg` (`search.pg`); absent means the in-memory Lunr default, a finding worth
     reporting for any production repo.
   - `backend.database.client` — `better-sqlite3` (dev only) vs `pg`, plus
     `pluginDivisionMode` and per-plugin overrides.

8. **Find the real validation commands.** Read root `package.json` `scripts` verbatim,
   then every CI definition — `.github/workflows/*.y*ml`, `.gitlab-ci.yml`,
   `.circleci/config.yml`, `azure-pipelines.yml`, `Jenkinsfile` — and extract the exact
   command sequence each PR job runs, in order. CI is the contract; the scripts block is
   only a hint. Scaffolded apps usually expose `tsc` / `tsc:full`, `lint:all`, `test:all`,
   `build:all`, `build:backend`, `prettier:check`, `new`, and CI usually calls
   `backstage-cli repo lint|test|build`, sometimes with `--success-cache`. Record what you
   found, not what you expected; hand it to `backstage-quality-gate` verbatim.

9. **Note deviation from upstream.** Flag what will bite later: patched packages
   (`.yarn/patches`, `patch-package`), pinned `resolutions`, forks of `@backstage/*` under
   a private scope, `@backstage-community/plugin-*` usage, custom theme packages, and any
   package whose `@backstage/*` deps trail the `backstage.json` line (a partial bump — see
   `backstage-upgrade`).

10. **Emit the map.** Write a compact markdown artifact to a scratch path outside the
    working tree (e.g. `/tmp/backstage-map.md`) — never commit it. One to five lines per
    section: Release line & Node · Package manager · Workspace layout · Frontend
    generation (+ `path:line` evidence) · Backend generation (+ evidence) · Plugin table
    (name, role, generation, local/external) · Config files & who loads them · Auth ·
    Permissions · Catalog · Scaffolder · TechDocs · Search · Database · CI jobs ·
    Validation commands · Deviations · Unknowns.

11. **Persist durable findings.** Write the stable subset — release line, package manager,
    frontend/backend generation, validation commands, notable deviations — to project
    memory as a topic file (e.g. `backstage-repo.md`) and link it from the memory index.
    Never persist secrets, tokens, internal hostnames, or anything from
    `app-config.local.yaml`.

## Verification

- Frontend and backend generation each cite at least one concrete `path:line`.
- The workspace globs expand to the same package set you inventoried (`ls` the globs).
- Every validation command in the map appears literally in `package.json` or a CI file.
- Re-run one cheap listed command (`yarn tsc`) only if `node_modules` exists; otherwise
  record commands as unverified rather than running `yarn install`.
- Contradictory evidence (both `@backstage/app-defaults` and `@backstage/frontend-defaults`
  present) is reported as `hybrid`, never resolved by picking the newer one.

## Failure modes

- **Version-number inference.** `backstage.json` says v1.53 but the app is still legacy
  frontend, or says v1.20 while someone hand-migrated to NFS. The release line predicts
  nothing about composition. Only imports do.
- **Partial bumps.** Root `backstage.json` bumped but individual package deps left
  behind, or `resolutions` pinning a single `@backstage/*` package to an old version.
  Symptom: duplicate React context / "found multiple versions" at runtime.
- **Plugins with both entrypoints.** Many `@backstage/plugin-*` ship a legacy default
  export and an `/alpha` NFS export. Which one the app imports is the fact; the package
  being installed is not.
- **Config that never loads.** `app-config.production.yaml` exists but nothing passes
  `--config` for it, so its settings are dead. Verify a loader before trusting a key.
- **CI that is not the scripts block.** CI runs `backstage-cli repo test --since origin/main`
  while `package.json` has `test:all`; assuming the script gives you a green local run
  and a red PR.
- **Monorepo is not an app.** A plugin-only repo has no `packages/app`; its release line
  lives in devDependencies and `backstage.json` may be absent entirely.
- **Missing `backstage.role`.** Hand-written packages omit it and the CLI then guesses the
  build role — report as a deviation, it changes what `repo build` does to that package.
- **Fork camouflage.** Private-scope packages that re-export `@backstage/*` make grep for
  `@backstage/` miss the real dependency graph. Check `resolutions` and private scopes.

## Do not

- Do not run `yarn install`, `yarn build`, migrations, or codegen during discovery.
- Do not read or copy secret values out of `app-config.local.yaml` or `.env`; record only
  that a key is set and from which source.
- Do not conclude NFS/legacy from `package.json` dependencies alone — read the imports in
  `packages/app/src/App.tsx` and the plugin entrypoints.
- Do not assume `yarn`; if the lockfile says otherwise, translate every command and say so
  in the map.
- Do not commit the map artifact or leave it inside the repository working tree.
- Do not guess an import path or API signature to fill an unknown — put it under
  **Unknowns** and let the consuming skill read the installed package's types.
- Do not proceed to a migration or refactor from an incomplete map; return BLOCKED naming
  the specific unknown.
