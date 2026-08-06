---
name: backstage-scaffolder
description: Author Backstage Software Templates and custom scaffolder actions — parameters, pickers, steps, outputs, action backend modules, dry runs, permissions, and failed or stuck tasks.
when_to_use: template.yaml, software template, scaffolder, golden path template, RepoUrlPicker, OwnerPicker, EntityPicker, ui:field, custom scaffolder action, createTemplateAction, action not found, template not showing in /create, scaffolder task stuck or failed, dry run a template.
---

# Backstage Scaffolder

Write `Template` entities and custom scaffolder actions that survive review, run under the permission framework, and fail loudly instead of silently.

## Preconditions

- Release line from `backstage.json`; scaffolder packages resolved via `yarn why @backstage/plugin-scaffolder-backend`.
- Backend generation: `createBackend()` + `backend.add(import('@backstage/plugin-scaffolder-backend'))` in `packages/backend/src/index.ts` is the new backend system. A `packages/backend/src/plugins/scaffolder.ts` router is legacy — migrate first (`backstage-plugin-migrate`) or register actions through the router's options and say so in your report.
- Frontend generation matters only for custom field extensions: NFS uses `FormFieldBlueprint` + `createFormField` from `@backstage/plugin-scaffolder-react/alpha`. Read the installed package's exports rather than assuming the legacy registration shape.
- `@backstage/plugin-catalog-backend-module-scaffolder-entity-model` present in the backend — without it `kind: Template` does not validate and no template appears.
- Working SCM `integrations` in `app-config.yaml` for whichever host the template publishes to.
- A local backend you may run. Any run that touches a real SCM org is an external mutation — stop and get authorization first.

## Procedure

1. **Inventory before authoring.** `GET /api/scaffolder/v2/actions` (or the `/create/actions` page) for installed actions and their input/output schemas; `GET /api/scaffolder/v2/templating-extensions` for available filters and globals. Never guess an action's input keys — they are published there.
2. **Start the entity.** `apiVersion: scaffolder.backstage.io/v1beta3`, `kind: Template`, `metadata.name`, and `spec.owner` + `spec.type`. Body is `spec.parameters`, `spec.steps`, `spec.output`.
3. **Write `spec.parameters` as one `FormStep` or an array of them.** Each step is JSON Schema (`title`, `description`, `required`, `properties`) with rjsf `ui:*` keys merged in — `ui:autofocus`, `ui:emptyValue`, `ui:help`, `ui:widget`, `ui:options`. Array elements become separate wizard pages; use them to keep any one page short. Custom validation messages follow `ajv-errors`.
4. **Use the built-in pickers instead of free-text strings.**
   - `ui:field: RepoUrlPicker` with `ui:options.allowedHosts` (must match an `integrations` host), plus `allowedOwners` / `allowedRepos` to narrow. Value is a repo spec string like `github.com?repo=x&owner=y`, not a URL.
   - `ui:field: OwnerPicker` with `ui:options.catalogFilter` — either `kind: [Group, User]` or a list of full catalog API filters (`metadata.annotations.github.com/team-slug: { exists: true }`).
   - `ui:field: EntityPicker` for arbitrary catalog entities; `RepoBranchPicker` and `RepoOwnerPicker` for autocomplete, both of which require `requestUserCredentials` (and `host` for the owner picker) to function.
   - Set `ui:options.requestUserCredentials: { secretsKey: USER_OAUTH_TOKEN, additionalScopes: { github: [workflow] } }` when the template must act as the user; consume it as `${{ secrets.USER_OAUTH_TOKEN }}`. Requires a configured auth provider and `ScmAuthApi` (`backstage-auth`).
5. **Route every credential through secrets, never parameters.**
   - `ui:field: Secret` keeps the value out of the task record and REST responses and masks it in the review step. Read it as `${{ secrets.name }}` — `${{ parameters.name }}` will be undefined.
   - For programmatic task creation declare `spec.secrets.schema` with `required`/`properties`. A missing secret then fails task *creation* with `400` and `secrets.X is required`, instead of mid-run.
   - Org-wide values belong in `scaffolder.defaultEnvironment` in `app-config.yaml`, read as `${{ environment.parameters.* }}` and `${{ environment.secrets.* }}`. Environment secrets are masked in logs and never reach the frontend.
6. **Write `spec.steps`** as `id`, `name`, `action`, `input`, with optional `if` and `each`. Use camelCase step and action ids: a dash makes `${{ steps.my-action.output.x }}` evaluate to `NaN`, and the bracket form `${{ steps['my-action'].output.x }}` is the only workaround. With `each`, the iteration value is `${{ each.value }}` (or `${{ each.value.field }}`), and the step's outputs become an array.
7. **Prefer built-ins over custom code.**
   - Shipped in `@backstage/plugin-scaffolder-backend`: `fetch:plain`, `fetch:plain:file`, `fetch:template`, `fetch:template:file`, `catalog:register`, `catalog:write`, `debug:log`, `debug:wait`, `fs:delete`, `fs:rename`, `fs:readdir`.
   - Publish/PR actions come from `@backstage/plugin-scaffolder-backend-module-{github,gitlab,azure,bitbucket-cloud,bitbucket-server,gerrit,gitea}`; add one with `yarn --cwd packages/backend add <pkg>` then `backend.add(import('<pkg>'))`.
   - Community actions live under `@backstage-community/plugin-scaffolder-backend-module-*`. Read the handler before installing one.
8. **Template the skeleton with `fetch:template`.** Inside skeleton files the variables are `${{ values.x }}` — only `template.yaml` itself sees `${{ parameters.x }}` — and they must be passed explicitly through `input.values`. Use `copyWithoutTemplating` for files whose own `${{ }}` syntax must survive (GitHub Actions workflows, Helm charts), `targetPath` to place output in a subdirectory, and `replace: true` only when overwriting existing workspace files is intended.
9. **Glue steps with expressions.**
   - `${{ }}` is evaluated by Nunjitsu, a deliberately reduced subset of Nunjucks. Check its compatibility guide before using any Nunjucks tag or filter; do not assume full Nunjucks.
   - Built-in filters: `parseRepoUrl`, `parseEntityRef` (accepts `{ defaultKind, defaultNamespace }`), `pick('name')`, `projectSlug`. Custom filters and globals are registered from a backend module against `scaffolderTemplatingExtensionPoint`.
   - `${{ user.entity }}` gives the caller's catalog `User` entity — useful for `gitAuthorName` / `gitAuthorEmail` — and requires a sign-in resolver that maps to a catalog user.
10. **Handle failure paths explicitly.** After a step fails, later steps are skipped unless their `if` invokes `${{ always() }}` or `${{ failure() }}`. Any template that creates external resources before a step that can fail needs a `failure()` cleanup step; `if: ${{ true }}` will not run.
11. **Finish with `spec.output`.** `links` take `title` plus `url`, or `icon` + `entityRef` for a catalog link; `text` items take `title` + `content` markdown. Both accept a per-item `if`. Source values from `${{ steps['publish'].output.remoteUrl }}` / `${{ steps['register'].output.entityRef }}`.
12. **Gate sensitive parameters and steps** with `backstage:permissions: { tags: [<tag>] }` on the parameter step or the step, then enforce in the policy (step 15). `backstage:featureFlag` hides parameters or fields but cannot gate `spec.steps[].if` — expose a boolean parameter and branch on it instead.
13. **Scaffold custom actions, do not hand-roll.** `yarn backstage-cli new` → `scaffolder-backend-module` generates the package, `module.ts`, an action and a test.
    - `createTemplateAction` from `@backstage/plugin-scaffolder-node` takes `id` (namespaced `provider:entity:verb`, camelCase segments), `description`, `examples`, `supportsDryRun`, `schema.input` / `schema.output`, `handler`.
    - Current schemas are per-property zod callbacks — `contents: z => z.string({ description: '...' })`. The accepted schema shape has changed across releases, so read `createTemplateAction`'s type from the **installed** package before writing it.
    - `examples: TemplateExample[]` (YAML strings of a `steps` snippet) is what renders on `/create/actions`. Without it, template authors cannot discover the action's usage.
14. **Register the action** in `createBackendModule({ pluginId: 'scaffolder', moduleId: ... })`.
    - Depend on `scaffolderActionsExtensionPoint` from `@backstage/plugin-scaffolder-node` and call `scaffolder.addActions(myAction(...))`.
    - Pass core services (`coreServices.rootConfig`, `coreServices.cache`, `coreServices.discovery`, `coreServices.auth`) as `deps` and close over them in the action factory; never reach for globals inside a handler.
    - Inside the handler use only `ctx`: `ctx.input`, `ctx.output(key, value)`, `ctx.logger`, `ctx.workspacePath`, `ctx.createTemporaryDirectory()`, `ctx.isDryRun`, `ctx.metadata.name`, `ctx.checkpoint` (experimental idempotency — version the key whenever its return type changes, or a retried task fails on the stale cached value).
    - Resolve every path with `resolveSafeChildPath(ctx.workspacePath, ctx.input.filename)` from `@backstage/backend-plugin-api`.
15. **Enforce permissions in the policy** (`backstage-permissions`). Without one, every signed-in user may execute every template and every action.
    - Permissions from `@backstage/plugin-scaffolder-common/alpha`: `templateParameterReadPermission`, `templateStepReadPermission`, `actionExecutePermission`, `taskCreatePermission`, `taskReadPermission`, `taskCancelPermission`.
    - Decisions and rules from `@backstage/plugin-scaffolder-backend/alpha`: `createScaffolderTemplateConditionalDecision` + `scaffolderTemplateConditions.hasTag`; `createScaffolderActionConditionalDecision` + `scaffolderActionConditions.hasActionId` / `hasProperty`; `createScaffolderTaskConditionalDecision` + `scaffolderTaskConditions.isTaskOwner`.
    - Rules compose with `not` / `allOf` / `anyOf` — e.g. deny `debug:log` only when `hasProperty({ key: 'message', value: 'not-this!' })`.
16. **Register the template** as a `Location` — `catalog.locations` with `rules: [{ allow: [Template] }]`, or `/catalog-import`. Restrict which repositories may contribute `Template` entities: scaffolder jobs run on the backend host with the backend's credentials, so template authorship is a privileged capability.

## Verification

- `yarn tsc` and `yarn test` from the repo root; `yarn backstage-cli config:check --lax` after touching `config.d.ts`.
- Action unit tests: `createMockActionContext` from `@backstage/plugin-scaffolder-node-test-utils`, with an explicit `workspacePath` from `createMockDirectory()` (`@backstage/backend-test-utils`) when called inside `it`. Assert on `ctx.output` calls. Add a case with `isDryRun: true` proving no external call happens.
- Template iteration: Template Editor at `/create/edit` → *Load Template Directory*, fill the form, `Create` runs a dry run and opens a drawer with the resulting file tree plus per-action logs. Equivalent API: `POST /api/scaffolder/v2/dry-run` with `{ template, values, secrets, directoryContents }`.
- Form-only check: `GET /api/scaffolder/v2/templates/{namespace}/{kind}/{name}/parameter-schema` returns the rendered steps — empty or 404 means the entity is not in the catalog.
- Real run: `yarn start` + `yarn start-backend`, execute the template against a scratch org only, then confirm the created entity resolves in the catalog. If the repo does not identify a non-production target org, return a BLOCKED report instead of picking one.
- Action registered: it appears in `GET /api/scaffolder/v2/actions` with its schema and `examples`.

## Failure modes

- **Template does not appear under `/create`.** Check in this order, and read the entity's `status.items` before touching the YAML — schema errors there are silent in the UI:
  - the `Location` was never refreshed after the edit (refresh from the Locations view, or `POST /api/catalog/refresh` with the location's `entityRef`);
  - `catalog.rules` does not `allow: [Template]` for that location;
  - `@backstage/plugin-catalog-backend-module-scaffolder-entity-model` is absent, so `kind: Template` never validates;
  - `spec.type` or `spec.owner` is missing, or the file still says `v1beta2`.
- **`Template action with ID '<id>' is not registered`.** The module is installed but not `backend.add`-ed; or it was registered on a legacy `scaffolder.ts` router while the app now boots `createBackend()`; or the id differs by case or namespace. `/create/actions` is the source of truth, not the module's README.
- **A step output is `NaN` or empty.** Dashed step/action id read with dot notation. Rename to camelCase, or use `${{ steps['id'].output.x }}`.
- **A secret arrives `undefined` in the action.** Read as `${{ parameters.x }}` instead of `${{ secrets.x }}`, or `requestUserCredentials.secretsKey` does not match the name used in the step. Secrets are also absent on retry unless re-supplied — `POST /v2/tasks/{taskId}/retry` accepts a `secrets` body for exactly this.
- **Task sits in `open`/`processing` forever.**
  - `scaffolder.concurrentTasksLimit: 0` disables task workers on that deployment entirely; otherwise every replica that could claim it is down or saturated (default limit 10).
  - A crashed worker leaves the task apparently alive: stale tasks are only reaped against `scaffolder.taskTimeout` (default 24h) on the `taskTimeoutJanitorFrequency` cycle (default 5m).
  - `EXPERIMENTAL_recoverTasks` + `EXPERIMENTAL_workspaceSerialization` (with `EXPERIMENTAL_recoverTasksTimeout`) are what make restarts resumable; without them a rolling deploy strands in-flight tasks.
  - `POST /v2/tasks/{taskId}/cancel` to clear one; treat it as a mutation of someone else's run.
- **Task failed mid-run and left real resources behind.** `GET /api/scaffolder/v2/tasks/{taskId}/events` (poll with `after=<eventId>`) is the per-step log; `GET /v2/tasks/{taskId}` gives status and the recorded steps; `GET /v2/tasks?createdBy=&status=` lists them. The repository created by an earlier step still exists — the scaffolder does not roll back. Add `if: ${{ failure() }}` cleanup steps rather than deleting by hand, and prefer `POST /v2/tasks/{taskId}/retry` (which resumes from the failed step) over re-running the whole template.
- **Works in the editor, fails for real.** Dry run skips actions that lack `supportsDryRun` and short-circuits handlers guarding on `ctx.isDryRun`, so publish and webhook steps are simply never exercised.
- **`fetch:template` emits raw `${{ }}` or mangles a workflow file.** The variable was not passed through `input.values`, or a file containing its own template syntax needed `copyWithoutTemplating`.
- **A Nunjucks snippet from the web does not work.** The engine is Nunjitsu, a subset. Check its compatibility guide before concluding the template is broken.
- **Users see a step or parameter they should not.** Tags in `backstage:permissions` do nothing on their own; a policy must return a conditional decision on `templateStepReadPermission` / `templateParameterReadPermission`. Absent that, the parameter schema is served to everyone who can read the template.

## Do not

- Do not run a template whose steps include `publish:*`, `catalog:register`, or any infra-creating action against a shared or production SCM org without an explicit stop-and-get-authorization step. Use a scratch org or a dry run.
- Do not install or write an action that executes arbitrary shell input from a template parameter; that turns any template author into a backend-host RCE.
- Do not build paths with `path.join(ctx.workspacePath, ...)` or accept absolute paths from input — use `resolveSafeChildPath`.
- Do not put tokens, passwords, or keys in `parameters`, in `output.text`, or in a `ctx.logger` dump of `ctx.input`.
- Do not use dashed ids for steps or custom actions.
- Do not use `${{ parameters.x }}` inside skeleton files, or expect `backstage:featureFlag` to gate a step.
- Do not allow `Template` entities from repositories outside the trusted set, and do not add a third-party action package without reading its handler.
- Do not hardcode an action's input keys from memory when `/create/actions` publishes its schema.
