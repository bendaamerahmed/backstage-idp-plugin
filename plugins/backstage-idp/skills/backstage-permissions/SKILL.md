---
name: backstage-permissions
description: Enable and extend the Backstage permission framework — define permissions, write a PermissionPolicy, enforce server-side in backend routes, and reflect decisions in the UI.
when_to_use: 'Any authorization work in Backstage. "who can delete entities", "restrict this action", "add a permission check", "write a permission policy", "only owners should edit", "hide this button unless allowed", RBAC in Backstage, conditional decisions, permission rules, 403 from a plugin backend.'
---

# Backstage permissions

Add real authorization to a Backstage instance: permission definitions, a policy that
decides, and backend enforcement points that obey. The UI never enforces anything.

## Preconditions

- Repo uses the new backend system (`createBackend`, `backend.add()`). Detect first;
  the legacy backend wiring for permissions is different and unsupported on current lines.
- Frontend generation known (NFS: `createApp` from `@backstage/frontend-defaults`,
  `createFrontendPlugin`, blueprints, `/alpha` exports — vs legacy `createPlugin`,
  `<FlatRoutes>`). It changes where UI checks are placed, not whether they matter.
- `backstage.json` release line known; permission APIs moved (see step 5) and the
  installed packages are the source of truth, not memory.
- You know which principal the endpoint serves: end users, service-to-service, or both.
- Assume `yarn` from the repo root unless the repo says otherwise.

## Procedure

1. **Survey what exists.** Grep for `permission:` in `app-config*.yaml`,
   `@backstage/plugin-permission-backend` and
   `@backstage/plugin-permission-backend-module-allow-all-policy` in
   `packages/backend/src/index.ts`, and existing `PermissionPolicy` implementations
   under `packages/backend/src/extensions/`. See `backstage-repo-discovery`.
2. **Enable the framework.** Set `permission.enabled: true` in `app-config.yaml` and
   register `backend.add(import('@backstage/plugin-permission-backend'))`. With
   `enabled: false` the framework short-circuits to ALLOW and your policy is never
   called — every check you write is dead code until this flag is on.
3. **Define permissions in the plugin's `-common` package**, never the backend package —
   the frontend imports them too. Use `createPermission` from
   `@backstage/plugin-permission-common`: a unique dotted `name`
   (`<plugin>.<resource>.<action>`), `attributes: { action: 'create' | 'read' | 'update' | 'delete' }`,
   and export a `<plugin>Permissions` array so integrators can enumerate them.
4. **Choose basic vs resource.** A basic permission asks "may this user do X at all"
   (creation, where no resource exists yet). A resource permission adds
   `resourceType` and can be answered per-object. Resource type strings are global
   across the instance — namespace them.
5. **Register with the permissions registry.** In the plugin's `register`/`init`, take
   `coreServices.permissionsRegistry` and call `addPermissions([...])`. For resource
   permissions call `addResourceType({ resourceRef, permissions, rules, getResources })`,
   where `resourceRef` comes from `createPermissionResourceRef` and `getResources`
   maps refs to objects (returning `undefined` for missing ones). This service
   replaced `createPermissionIntegrationRouter`; if the repo still uses that function,
   migrate it. Read the installed `@backstage/backend-plugin-api` types for the exact
   shapes before writing.
6. **Enforce in every backend route that mutates or exposes protected data.**
   Get credentials with `httpAuth.credentials(req, { allow: ['user'] })`, then
   `permissions.authorize([{ permission, resourceRef }], { credentials })`, and throw
   `NotAllowedError` from `@backstage/errors` on `AuthorizeResult.DENY`. One check per
   route, at the top, before any read or write.
7. **For lists and paginated reads, use `authorizeConditional`.** On
   `AuthorizeResult.CONDITIONAL`, convert the returned conditions into your storage
   filter with `createConditionTransformer(permissionsRegistry.getPermissionRuleset(resourceRef))`
   and push the filter into the query. Never fetch everything and filter in memory.
8. **Write the policy as a backend module.** `createBackendModule({ pluginId: 'permission',
   moduleId: 'permission-policy' })`, depend on `policyExtensionPoint` from
   `@backstage/plugin-permission-node/alpha`, and call `policy.setPolicy(new YourPolicy())`
   in `init`. Implement `PermissionPolicy.handle(request, user)`: narrow with
   `isPermission(request.permission, somePermission)` for one permission, or
   `isResourcePermission(request.permission, 'catalog-entity')` to cover a whole family.
   Make the catch-all `return` explicit and deliberate — that single line is your
   instance's default posture.
9. **Return conditional decisions for ownership.** For the catalog, use
   `createCatalogConditionalDecision(request.permission, catalogConditions.isEntityOwner({
   claims: user?.info.ownershipEntityRefs ?? [] }))` — conditions from
   `@backstage/plugin-catalog-backend/alpha`, permissions from
   `@backstage/plugin-catalog-common/alpha`. Conditional decisions are only valid for
   resource permissions; returning one for a create-style permission is an error.
10. **Add custom rules only when no existing rule fits.** `createPermissionRule` from
    `@backstage/plugin-permission-node` with `name`, `description`, `resourceRef`,
    a zod `paramsSchema`, `apply` (in-memory predicate) and `toQuery` (storage filter).
    `apply` and `toQuery` must express the same predicate or conditional reads and
    single-resource checks will disagree. Wrap with `createConditionFactory` for use in
    policies and register via `permissionsRegistry.addPermissionRules` in a backend module.
11. **Reflect, do not enforce, in the UI.** `usePermission({ permission, resourceRef })`
    from `@backstage/plugin-permission-react` returns `{ loading, allowed }`; use it to
    disable or hide controls. `RequirePermission` wraps a route element. On NFS, wrap
    inside the component supplied to the page extension rather than editing `App.tsx`
    routes. Omitting `resourceRef` for a resource permission yields `allowed: false`,
    and results are stale-while-revalidate — never branch on either for security.
12. **Remove the allow-all module** (`@backstage/plugin-permission-backend-module-allow-all-policy`)
    from `packages/backend/src/index.ts` once a real policy is registered. Two policy
    providers is a startup failure, and leaving allow-all wins silently in some orders.
13. **Test the denied path first.** Unit-test the policy by calling `handle()` directly
    with a constructed permission and user, asserting DENY and asserting the exact
    conditions object for conditional cases. Route-test with the backend test utils'
    permissions mock (`mockServices.permissions.mock()`) with `authorize` resolved to
    DENY and assert HTTP 403 — an allow-only test suite proves nothing.

## Verification

- `yarn tsc` and `yarn test` clean. Run the plugin's backend tests specifically.
- `yarn start` and confirm the backend logs no "policy already set"/duplicate-module error.
- Hit the protected route directly with a real user token (`curl -H "Authorization: Bearer <token>"`),
  once as an allowed user (2xx) and once as a denied user (403 with a `NotAllowedError`
  body). Bypassing the UI is the only meaningful proof.
- For conditional reads, assert the filtered list differs between two users, and check
  the generated SQL/query count to confirm filtering happened at the data source.
- Temporarily flip `permission.enabled: false` and confirm the denied call now succeeds —
  that proves the check is wired to the framework, not to unrelated logic. Flip it back.

## Failure modes

- **`permission.enabled` unset.** Framework returns ALLOW for everything, policy never
  runs, `usePermission` reports allowed. Nothing is broken and nothing is enforced.
- **Allow-all policy module still registered.** The most common "my policy is ignored".
- **Enforcement only on the write path shown in the UI.** Bulk endpoints, refresh
  endpoints, and search/list routes on the same plugin are usually left open.
- **Transitive group membership is not in the claims.** Ownership refs resolve from
  *direct* `memberOf` relations only; a user in `team-a` does not get `org/engineering`
  in `ownershipEntityRefs`, so parent-group-owned entities appear unowned to them.
  Fix in the sign-in resolver's ownership resolution, not in the policy — see
  `backstage-auth`.
- **Entities with no owner.** No `spec.owner` means no `ownedBy` relation, so
  `isEntityOwner` matches nobody and the entity becomes uneditable by anyone. Always
  pair ownership conditions with an admin-group escape hatch.
- **Multiple owners.** `relations.ownedBy` is a list; rules that compare a single
  `spec.owner` string, or that assume the first element, silently deny co-owners.
- **Ownership annotations treated as proof.** `spec.owner` and annotations come from
  `catalog-info.yaml` in a source repo. Anyone who can merge to that repo can name
  themselves owner. Ownership is an authorization input only if you also control who
  can register locations and who can merge — otherwise it is a self-asserted claim.
  Discuss with `backstage-catalog` before basing destructive permissions on it.
- **Resource permission authorized without `resourceRef`.** The condition has nothing
  to evaluate against; the decision is meaningless even when it returns ALLOW.
- **`apply`/`toQuery` drift in a custom rule.** Single-item checks allow what list
  filtering hides, or vice versa. Test both against the same fixture.
- **Service-to-service traffic.** `allow: ['user']` rejects service principals with 401;
  `allow: ['user', 'service']` lets them through *without* a user policy decision.
  Decide per route which principals are acceptable and say so in the PR.
- **Policy throws.** An exception in `handle()` fails the request, usually as a 500 on
  every protected route at once. Guard lookups inside the policy.

## Do not

- Do not treat `usePermission`, `RequirePermission`, a hidden button, or a disabled
  menu item as an access control. They are cosmetics over a public API.
- Do not define permissions in a backend or frontend package — `-common` only.
- Do not return a conditional decision for a non-resource permission.
- Do not set `permission.enabled: false` to unblock a failing check.
- Do not invent condition names, rule names, or import paths; read the installed
  package's `/alpha` exports and types for the repo's release line.
- Do not ship a policy whose catch-all is ALLOW without stating that choice explicitly
  in the change description.
- Do not merge, push, or deploy a policy change without stopping for explicit
  authorization — a policy edit changes access for every user at once.
- Do not proceed if the correct default posture (allow-by-default vs deny-by-default)
  is undecided; return a BLOCKED report naming the permissions in question.
