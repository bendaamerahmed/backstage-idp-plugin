---
name: backstage-plugin-migrate
description: Migrate a Backstage plugin from the legacy frontend system to the New Frontend System and from the legacy to the New Backend System, preserving behavior via /alpha dual exports.
when_to_use: '"migrate this plugin to the new frontend system", "convert createPlugin to createFrontendPlugin", "add an /alpha export", "move this backend plugin to createBackendPlugin", "our plugin breaks in the NFS app", "replace Material UI with @backstage/ui".'
---

# Migrate a Backstage plugin to the new frontend/backend systems

Convert a legacy plugin package to the New Frontend System (NFS) and/or New Backend
System without changing what users see, using dual exports so one package serves both
systems during the transition. Scope, map, verify parity.

## Preconditions

- Generation known for **both** plugin and host app. Run `backstage-repo-discovery`,
  or grep: `createPlugin`/`createRoutableExtension`/`<FlatRoutes>`/`createApp` from
  `@backstage/app-defaults` = legacy frontend; `createFrontendPlugin`/`createApp` from
  `@backstage/frontend-defaults`/`/alpha` imports = NFS. `createBackend` +
  `backend.add()` = new backend; `createRouter` + `plugins/*.ts` env wiring in
  `packages/backend/src` = legacy backend.
- `backstage.json` release line recorded, workspace build and tests green on `main`
  before you touch anything. Migration on a red baseline is unverifiable.
- The plugin's consumers are known. If it is published outside this repo, legacy
  exports must survive; if internal-only, they may be deleted at the end.
- Node 22 or 24, `yarn` at the repo root.

## Procedure

1. **Scope the migration.** Inventory the plugin's surface: pages, entity page tabs,
   entity cards, utility APIs, route refs (internal and external), nav items, search
   result items, context-menu items, backend routers and modules. Each maps to exactly
   one blueprint below. Do NOT migrate frontend and backend in one commit, and never
   fold a Material UI → `@backstage/ui` rewrite into the same change (step 13).
2. **Add the `/alpha` entrypoint, do not rewrite `src/index.ts`.** Create
   `src/alpha.tsx` and add to `package.json`:
   `"exports": { ".": "./src/index.ts", "./alpha": "./src/alpha.tsx", "./package.json": "./package.json" }`
   plus a matching `typesVersions` map with `"alpha": ["src/alpha.tsx"]`. Run
   `yarn backstage-cli migrate package-exports` to sync subpath export config rather
   than hand-editing every field. Legacy consumers keep importing the root entrypoint.
3. **Extract route refs to a shared module.** In NFS, refs come from
   `@backstage/frontend-plugin-api` (`createRouteRef`, `createSubRouteRef`,
   `createExternalRouteRef`) and carry no `id` — identity comes from the `routes`/
   `externalRoutes` keys on the plugin. To avoid two incompatible ref objects for the
   same route, keep the single legacy ref and wrap it with `convertLegacyRouteRef` /
   `convertLegacyRouteRefs` from `@backstage/core-compat-api` in `alpha.tsx`.
4. **`createPlugin` → `createFrontendPlugin`.** In `alpha.tsx`, export default a
   `createFrontendPlugin({ pluginId, extensions: [...], routes, externalRoutes })`.
   `id` becomes `pluginId`; the `apis` option no longer exists (APIs are extensions).
   Extensions are not exported individually — only the plugin is.
5. **Pages: `createRoutableExtension` → `PageBlueprint`.** `PageBlueprint.make({ params: { path, routeRef, loader: () => import('./components').then(m => <m.Page />) } })`.
   The `path` moves out of the app's `<Route>` into the plugin — copy the exact path
   the app used, or every existing bookmark and `<RouteRef>` link breaks.
6. **Sidebar entries.** This is version-sensitive: `NavItemBlueprint` existed through
   v1.50 and is gone from v1.51 onward, where `PageBlueprint`'s optional `title` and
   `icon` params produce the nav entry. Check the installed
   `@backstage/frontend-plugin-api` types before writing either. App-side sidebar
   layout is overridden with `NavContentBlueprint` from `@backstage/plugin-app-react`,
   which receives `navItems` (`take(id)`, `rest()`, `withComponent()`).
7. **Entity page tabs → `EntityContentBlueprint`** from
   `@backstage/plugin-catalog-react/alpha`: params `path`, `title`, `loader`, optional
   `group`, `icon`, `routeRef`, `filter` (an annotation expression string or an
   `(entity) => boolean`). Replace the `isFooAvailable(entity)` guard the app used in
   `EntityLayout.Route if=` with `filter`. `defaultPath`/`defaultTitle` are errors on
   current lines — use `path`/`title`.
8. **Entity cards → `EntityCardBlueprint`** from the same package: params `loader`,
   `filter`, and `type` (`'info' | 'content'`). The old `variant` and `gridSizes`
   props no longer exist; card placement is now the layout's concern. Context menu
   items use `EntityContextMenuItemBlueprint`.
9. **Utility APIs → `ApiBlueprint`.** `ApiBlueprint.make({ params: defineParams => defineParams({ api: fooApiRef, deps: { ... }, factory: deps => new FooClient(deps) }) })`.
   Move the `createApiRef` declaration to the `-react` package (or wherever legacy
   consumers already import it from) and re-export, so both systems share one ref
   object. Add the blueprint to `extensions`; delete the `apis` array only once no
   legacy app installs the same factory, or the app fails on a duplicate API.
10. **Remaining kinds.** Search results use `SearchResultListItemBlueprint`
    (`@backstage/plugin-search-react/alpha`); app-level ones live in
    `@backstage/plugin-app-react` (`SignInPageBlueprint`, `ThemeBlueprint`,
    `IconBundleBlueprint`, `TranslationBlueprint`, `SwappableComponentBlueprint`).
    Only when no blueprint fits, drop to `createExtension` + `createExtensionInput`
    + `createExtensionDataRef`.
11. **Compatibility layer — only for plugins you do not own.** In an NFS app, wrap a
    third-party legacy plugin with `convertLegacyPlugin(legacyPlugin, { extensions: [...] })`
    from `@backstage/core-compat-api`, building those extensions with
    `convertLegacyPageExtension` and `convertLegacyEntityContentExtension` /
    `convertLegacyEntityCardExtension` (`@backstage/plugin-catalog-react/alpha`).
    App-level leftovers use `convertLegacyAppOptions` (apis, icons, components,
    themes, featureFlags) and `convertLegacyAppRoot` (the JSX root), both passed to
    `createApp({ features: [...] })` from `@backstage/frontend-defaults`.
12. **Backend migration.** Replace the exported `createRouter` entrypoint with
    `createBackendPlugin({ pluginId, register(env) { env.registerInit({ deps: { ... }, async init({ ... }) { ... } }) } })`
    from `@backstage/backend-plugin-api`. Map old `RouterOptions` fields to core
    services: `logger` → `coreServices.logger`, `config` → `coreServices.rootConfig`,
    `discovery` → `coreServices.discovery`, plus `database`, `auth`, `httpAuth`,
    `userInfo`, `scheduler`, `cache`, `urlReader`, `permissions`, `lifecycle`,
    `auditor`. Register the router with `httpRouter.use(router)` instead of returning
    it. Keep `createRouter` internal, called by `init`, and mark the public export
    `@deprecated`; `export { fooPlugin as default }`. Delete `src/run.ts` /
    `src/service/standaloneServer.ts` and add `dev/index.ts` using `createBackend()`
    from `@backstage/backend-defaults`. Extensibility that used to be constructor
    options becomes `createExtensionPoint` declared in a sibling
    `-node` package, registered via `env.registerExtensionPoint`, and consumed by
    `createBackendModule({ pluginId, moduleId, register })`. Confirm every service ref
    and the `createRouter` signature against the installed types — these move.
13. **Material UI → `@backstage/ui` (BUI): separate change, separate PR**, started
    only after the NFS migration is merged and green. `yarn add @backstage/ui`; import
    `@backstage/ui/css/styles.css` exactly once at the app root
    (`packages/app/src/index.tsx`) — never from a plugin. Navigating components
    (`Link`, `ButtonLink`, `Tabs`, `Menu`, `TagGroup`, `Table`) require a `BUIProvider`
    inside a React Router context; NFS apps get it from `@backstage/plugin-app`, legacy
    apps from the `@backstage/core-app-api` shell. Migrate one component tree at a
    time, use current tokens (`--bui-bg-neutral-*`; `--bui-bg-surface-*` and
    `--bui-gray-*` are deprecated), and read `https://ui.backstage.io/` per component —
    prop APIs still move (`Checkbox` takes `isSelected`, `Collapsible` became
    `Accordion`). MUI and BUI coexist; a half-migrated component does not.
14. **Preserve tests.** Move test files with their components; do not rewrite
    assertions. Legacy `renderInTestApp`/`TestApiProvider` come from
    `@backstage/test-utils`, their NFS equivalents plus `createExtensionTester` from
    `@backstage/frontend-test-utils`. Add one `createExtensionTester` test per migrated
    extension asserting rendered output and resolved path; backend tests use
    `startTestBackend` and `mockServices` from `@backstage/backend-test-utils`.

## Verification

- `yarn tsc`, then `yarn backstage-cli repo lint` and `yarn backstage-cli repo test`.
  Type errors mentioning `.../alpha` mean step 2's `typesVersions` entry is missing.
- `yarn build:api-reports` if the repo has them; commit the regenerated files.
- Run the plugin's dev app (`yarn start` in the plugin dir) and the host app. Install
  `@backstage/plugin-app-visualizer` and open `/visualizer` to confirm each new
  extension is attached where you expect and none is duplicated.
- Diff behavior, not code: every route path, entity tab path/title, card position and
  API id identical before and after. Enumerate from the app on `main` and compare.
- Backend: `curl` each route through `/api/<pluginId>/...` and confirm identical
  status codes and payloads against the pre-migration backend.

## Failure modes

- **Duplicate entity cards or tabs.** The NFS app installs the plugin's extensions
  automatically while the legacy `EntityPage.tsx` still renders the same components.
  Remove them from the app's entity page, not from the plugin.
- **Route ref identity mismatch.** Two `createRouteRef` calls for one logical route,
  one legacy and one NFS, make `useRouteRef` return undefined. Keep one ref object,
  wrapped with `convertLegacyRouteRef`.
- **`Invalid element inside FlatRoutes`** during app conversion: something other than
  `<Route>` sits inside `FlatRoutes`. That logic belongs in a plugin extension.
- **Extension silently absent.** Either the app is not discovering the package
  (`app.packages` config) or the extension is disabled by default and needs an
  `app.extensions` entry. The visualizer distinguishes the two.
- **Duplicate API factory error.** The API is registered by both the legacy `apis`
  array and `ApiBlueprint`. Only one system may own it at a time.
- **Backend plugin starts but every route 404s.** `httpRouter.use(router)` was never
  called, or `init` returned before the router was registered.
- **Extension point undefined in a module.** Wrong `pluginId`, or the point is
  declared in the plugin package instead of a `-node` package (dependency cycle).
- **BUI `Link` causes a full page reload.** No `BUIProvider`, or it is outside the router.
- **Legacy consumers break on publish.** The root entrypoint changed. `/alpha` is
  additive; the root export stays identical until removed in a breaking release.

## Do not

- Do not use `convertLegacy*` helpers on a plugin in this repository.
- Do not change route paths, extension names, API ids or plugin ids while migrating —
  a rename and a migration must never be the same commit.
- Do not delete legacy exports, the `apis` array, or `EntityPage` entries until the
  NFS path is verified in the running app.
- Do not bump Backstage versions here; that is `backstage-upgrade`.
- Do not state an import path or blueprint param from memory — read the installed
  package's `.d.ts` or the docs for this repo's release line.
- Do not publish, push, or open a PR without explicit authorization; hand off to
  `pull-request-ready` when the diff is verified.
- If the host app's generation is ambiguous, or the plugin has consumers whose
  generation you cannot determine, stop and return a BLOCKED report.
