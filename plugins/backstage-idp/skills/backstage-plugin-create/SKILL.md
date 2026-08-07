---
name: backstage-plugin-create
description: Scaffold a new Backstage plugin package (frontend, backend, common, node) with `yarn new` and wire it into packages/app and packages/backend for the repo's actual system generation.
when_to_use: '"create a new Backstage plugin", "add a plugin to our Backstage", "scaffold a backend plugin", "we need a -common package", "wire this plugin into the app", "yarn new", new plugin ID / package naming questions.'
---

# Create a Backstage plugin

Scaffold a new plugin package in a Backstage monorepo and wire it into `packages/app`
and/or `packages/backend` so it actually loads.

## Preconditions

- Repo generation is known. Run `backstage-repo-discovery` first, or determine it yourself:
  - **NFS** (new frontend system): `packages/app/src/App.tsx` uses `createApp` from
    `@backstage/frontend-defaults`; plugins use `createFrontendPlugin`, blueprints,
    `/alpha` imports.
  - **Legacy frontend**: `createApp` from `@backstage/app-defaults`, `<FlatRoutes>`,
    `bindRoutes`, `createPlugin` / `createRoutableExtension`.
  - **New backend**: `packages/backend/src/index.ts` is a short `createBackend()` +
    `backend.add(...)` file. `createServiceBuilder` or `plugins/*.ts` env wiring means the
    removed legacy backend — stop and report BLOCKED.
- Release line read from `backstage.json`. Node 22 or 24 only.
- Plugin ID decided: lowercase, dash-separated, stable (it becomes the URL path, the
  backend mount point `/api/<pluginId>`, and `backstage.pluginId`). If the ID or the
  package split cannot be determined from the task, return BLOCKED rather than guessing.
- `yarn` unless the repo's `packageManager` field says otherwise.

## Procedure

1. **Decide the package split** before generating anything. Follow ADR011 naming, where
   `x` is `plugin-<id>`:
   - `x` — frontend plugin (React, extensions/blueprints, pages).
   - `x-backend` — HTTP routes, DB, service dependencies. Never imported by frontend.
   - `x-common` — isomorphic: types, permission definitions, API client interfaces,
     constants. Must not import Node built-ins or React. Everything else may depend on it.
   - `x-node` — Node-only utilities other *backends* consume (the backend plugin's own
     private code stays in `x-backend`).
   - `x-react` — shared React widgets/hooks other frontend plugins consume.
   Create only what is needed now; add `-common` the moment a type is needed on both sides.

2. **Scaffold** from the repo root: `yarn new` (a shortcut for
   `backstage-cli new --select <template>`). Non-interactive form:
   `yarn new --select frontend-plugin --option pluginId=<id>`.
   Built-in templates live in `@backstage/cli-module-new/templates`: `frontend-plugin`,
   `legacy-frontend-plugin`, `frontend-plugin-module`, `backend-plugin`,
   `backend-plugin-module`, `plugin-common-library`, `plugin-node-library`,
   `plugin-web-library`, `web-library`, `node-library`, `cli-module`,
   `catalog-provider-module`, `scaffolder-backend-module`. Since v1.49.0 the CLI
   auto-detects the app's frontend system and offers only the matching plugin template —
   do not force `legacy-frontend-plugin` unless the app is legacy. A
   `backstage.cli.new.templates` array in the root `package.json` replaces the built-ins
   entirely; read it before assuming a template exists.

3. **Inspect what the generator actually did** — `git status --short`, `git diff --stat`.
   Expect `plugins/<id>[-backend]/` plus edits to `packages/app/package.json` and/or
   `packages/backend/package.json`, and possibly `packages/backend/src/index.ts`. Do not
   assume; templates differ per release line.

4. **Fix package naming and metadata.** In-repo private plugins use the repo's existing
   scope (commonly `@internal/plugin-<id>`); match sibling plugins exactly. Verify in the
   generated `package.json`: `backstage.role` (set by the template), `backstage.pluginId`
   equal to the plugin ID, and `backstage.pluginPackages` listing every package of the
   split once more than one exists. Keep `"private": true` for plugins that will not be
   published.

5. **Frontend — NFS.** The plugin's default export is the `createFrontendPlugin({ pluginId,
   extensions, routes })` instance. Route refs go in `src/routes.ts` via `createRouteRef`.
   Build features from blueprints — `PageBlueprint`, `SubPageBlueprint` and `ApiBlueprint`
   from `@backstage/frontend-plugin-api`, `EntityCardBlueprint` / `EntityContentBlueprint`
   from `@backstage/plugin-catalog-react/alpha` — and list them in `extensions`. A sidebar
   entry comes from the page extension's own `title` and `icon`; there is no separate nav
   blueprint (`NavItemBlueprint` was removed in v1.51 — `NavContentBlueprint` in
   `@backstage/plugin-app-react` replaces the whole navbar and is not what you want here).
   Read the blueprint's `make()` params from the installed package's
   types; blueprint param shapes change between releases. Do not export individual
   extensions from the package. If the plugin package must also serve legacy consumers,
   put the NFS plugin behind an `/alpha` subpath: `exports` maps `"./alpha"` to
   `./src/alpha.tsx` and `typesVersions` maps `alpha` to the same file (see
   `backstage-plugin-migrate`).

6. **Frontend — wire into `packages/app`.** Add the dependency:
   `yarn --cwd packages/app add @internal/plugin-<id>@^0.1.0`.
   - NFS with feature discovery: nothing else is needed if `app-config.yaml` has
     `app: packages: all`. If it uses `app.packages.include`, add the package name to that
     list; if `exclude`, confirm it is not listed.
   - NFS without discovery: import the default export from the plugin's entry point
     (`/alpha` if the package uses that split) and add it to the `features` array of
     `createApp` in `packages/app/src/App.tsx`.
   - Legacy: register the routable extension in `<FlatRoutes>` in `App.tsx`, add a
     `SidebarItem` in `packages/app/src/components/Root/Root.tsx`, and add any
     `bindRoutes` entries for external route refs.

7. **Backend.** `plugins/<id>-backend/src/plugin.ts` holds `createBackendPlugin({ pluginId,
   register(env) { env.registerInit({ deps, async init(...) }) } })`. Take services from
   `coreServices` (`logger`, `httpRouter`, `rootConfig`, `database`, `auth`,
   `httpAuth`, `discovery`) — plugin-scoped services arrive already scoped to your
   `pluginId`, so `httpRouter.use(router)` mounts at `/api/<pluginId>`. Export the plugin
   as the package default export. Expose extension points with `createExtensionPoint` only
   if modules will extend the plugin.

8. **Backend — wire into `packages/backend`.** Add the dependency:
   `yarn --cwd packages/backend add @internal/plugin-<id>-backend@^0.1.0`, then add one
   line to `packages/backend/src/index.ts` next to the existing entries. Copy the exact
   call shape used by the neighbouring lines (`backend.add(import('...'))` vs
   `backend.add(somePlugin())`) — whether `createBackendPlugin` returns a feature or a
   factory is release-dependent, so match the file. `backend.start()` stays last.

9. **Config schema.** If the plugin reads config, add `config.d.ts` exporting a single
   `Config` interface, then in `package.json` set `"configSchema": "config.d.ts"` and
   include `"config.d.ts"` in `"files"`. Annotate each field with `@visibility frontend`
   (readable by the browser), `backend` (default), or `secret`; use `@deepVisibility` for
   whole subtrees. Namespace keys under the plugin ID. Read config through
   `coreServices.rootConfig` in the backend and the config API in the frontend.

10. **Tests.** Backend: `startTestBackend({ features: [...] })` plus `mockServices.*`
    factories from `@backstage/backend-test-utils`, and `supertest` against the returned
    `server`. NFS frontend: `renderInTestApp`, `createExtensionTester`, and
    `TestApiProvider` from `@backstage/frontend-test-utils`. Legacy frontend:
    `@backstage/test-utils`. Replace — never delete — the generated test that asserts the
    scaffolded sample endpoint/component once the sample code goes.

11. **Changesets.** If the repo has `.changeset/`, add one for every new package.

## Verification

- `yarn install` at the root completes and the new workspace resolves.
- `yarn tsc`, `yarn lint --since origin/main`, and `yarn test <package-name>` pass.
- `yarn build:all` succeeds — catches a `-common` package that imported Node or React.
- Frontend: `yarn dev`, then the page renders at `http://localhost:3000/<pluginId>` and
  the nav item appears. Standalone: `yarn workspace <pkg> start` uses the `dev/` folder.
- Backend: `yarn workspace <pkg> start`, then `curl localhost:7007/api/<pluginId>/<route>`
  returns the expected payload; `yarn start-backend` logs the plugin's init cleanly.
- `yarn backstage-cli config:check --lax` if you added a config schema; a schema that
  fails to load breaks app startup, not just validation.

## Failure modes

- **Legacy-templated plugin in an NFS app.** Older CLI, or the auto-detection read the app
  as legacy. Symptom: generated `src/plugin.ts` uses `createPlugin` /
  `createRoutableExtension` while `App.tsx` imports `@backstage/frontend-defaults`. The
  plugin will not appear anywhere. Rewrite the wiring to `createFrontendPlugin` +
  blueprints (`backstage-plugin-migrate`), or bump the CLI first.
- **Plugin installed but invisible.** Feature discovery only runs when the app is built by
  `@backstage/cli`, and only for packages that are dependencies of `packages/app`. Check
  the dependency exists, `app.packages` does not exclude it, the package default-exports
  the plugin, and `backstage.features` in `package.json` points at the right entry point.
- **Backend 404 on every route.** Either the plugin was never added to
  `packages/backend/src/index.ts`, or `pluginId` differs from the path being called —
  plugin-scoped `httpRouter` mounts strictly under `/api/<pluginId>`.
- **`-common` package breaks the app build.** It pulled in a Node built-in, a
  `-backend` package, or React. `-common` is isomorphic; move the offender to `-node` or
  `-react`.
- **Duplicate React / duplicate `@backstage/core-plugin-api`.** The new package pinned a
  different version than the rest of the monorepo. Run `yarn backstage-cli versions:bump`
  and confirm against `backstage.json`'s release line.
- **Config schema load failure after adding `config.d.ts`.** Schemas now resolve imported
  types; an import the loader cannot follow fails the whole schema and takes down startup.
  Keep `config.d.ts` self-contained.
- **Plugin ID collision.** An installed `@backstage-community/plugin-<id>` using the same
  ID gives two plugins claiming the same routes and `/api` mount. Search existing
  `package.json` files before settling on an ID.

## Do not

- Do not hand-create plugin directories; always start from `yarn new` so role, build
  config, and entry points are correct.
- Do not import from `plugins/<id>-backend` in frontend code, or from `-node` in `-common`.
- Do not export individual NFS extensions from a plugin package — only the plugin.
- Do not both pass the plugin to `features` in `createApp` and rely on discovery.
- Do not invent blueprint params, `createRouter` signatures, or service interfaces from
  memory — read the installed package's `.d.ts` for the repo's release line.
- Do not publish, push, or open a PR without an explicit authorization step; hand off to
  `pull-request-ready`.
