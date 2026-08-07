---
name: backstage-incident-debug
description: Diagnose a failing production or staging Backstage instance — collect evidence, narrow to one layer, read backend logs and health endpoints, and correlate with recent deploys and config changes.
when_to_use: A DEPLOYED Backstage instance is failing right now and the failing layer is not yet known. Backstage down or 500ing in production or staging, backend crash-looping on config, entities vanished from a running instance, catalog stale or slow, integration rate limit exhausted, correlate a failure with a recent deploy. Once the layer IS known, or the problem is on a laptop or an unmerged branch, use that domain's skill instead.
---

# Backstage Incident Debugging

Narrow a failing Backstage deployment to one layer with evidence before proposing a cause. Read-only by default; anything that mutates a shared environment stops for authorization.

## Preconditions

- The exact symptom, its first-seen timestamp, and which environment. Without a timestamp you cannot correlate with deploys, and correlation is most of the diagnosis.
- Read access to the failing environment's **merged** config, not the repo's `app-config.yaml`. `app-config.production.yaml` overrides nearly everything that matters.
- Backend reachability plus a token if auth is enforced. A `401` with `Missing credentials` from every endpoint is your missing token, not the incident. External callers use `backend.auth.externalAccess` — `type: static` (with `token`, `subject`, optional `accessRestrictions`) or `type: jwks`.
- Release line from `backstage.json`, and `yarn backstage-cli info --format json` for Node, CLI, and resolved `@backstage/*` versions.
- Generation, because half the diagnostics below do not exist in the other one. Backend: `createBackend()` in `packages/backend/src/index.ts` is the new backend system; `createRouter` files under `packages/backend/src/plugins/` are legacy. Frontend: `createApp` from `@backstage/frontend-defaults` is NFS (default since v1.49); `@backstage/app-defaults` plus `<FlatRoutes>` is legacy.

## Procedure

1. **Record symptom and blast radius before forming any hypothesis.** One entity, one user, one plugin, or everyone. This single fact eliminates most layers: one entity is data or processing; one user is auth or permissions; one plugin is that plugin's config, backend, or upstream; everyone is process, config, or database.
2. **Establish whether the backend is up.** `GET /.backstage/health/v1/liveness` and `GET /.backstage/health/v1/readiness` (new backend system, v1.29.0+; legacy backends expose `/healthcheck`). Liveness OK with readiness failing means the process is alive and a dependency — usually the database — is not. Neither answering plus a restarting pod is a crash loop; jump to step 5.
3. **Build the change timeline** covering the 48h before first-seen: application deploy, changes to any `app-config.*` file, credential or secret rotation, a `backstage.json` bump (`backstage-upgrade`), permission policy change, and `catalog-info.yaml` changes in target repos. "Nothing changed" almost always means an expiring credential, a scheduled provider run, or an upstream quota reset.
4. **Reproduce against the failing environment's merged config, never the local default.** `yarn backstage-cli config:print --lax --format yaml`, passing `--config` for each file in the same order the deployment does; `--frontend` prints exactly what the browser receives; `--with-secrets` only if authorized. Validate with `yarn backstage-cli config:check --lax --deprecated`; `--strict` additionally rejects keys no schema declares. `config:schema` shows which keys are even known. `BACKSTAGE_ENV` takes comma-separated values, so you can stack the deployed config layers locally.
5. **Split frontend from backend with the browser network tab, not with logs.**
   - `/api/*` returning 4xx/5xx → backend; go to that plugin's layer below.
   - Request 200 but the data is wrong → data or processing, not transport.
   - Blank page with no failing request → the bundle got the wrong config. Frontend config is injected at container start by the nginx entrypoint from environment variables, not baked at build time, and a single missing variable makes the whole `${VAR}` value evaluate to undefined. Diff `config:print --frontend` against what the deployment sets.
   - Origin and CORS errors are `app.baseUrl` / `backend.baseUrl` disagreeing with the real hostname, not a Backstage bug.
6. **Raise log level surgically.** `LOG_LEVEL=debug` (env var, takes precedence over config) is fine locally and a firehose in production. Prefer `backend.logger.overrides` with `matchers: { plugin: catalog }` and `level: debug` to raise one plugin, and `backend.logger.meta` to stamp every line with the environment. Levels are `error`, `warn`, `info` (default), `debug`.
7. **Read the logs for the right lines.** Every line carries the plugin id from the plugin-scoped logger — filter on it first. The useful signals are the startup sequence for the failing plugin, and the last successful scheduled-task line for the relevant provider. Catalog processing errors are **not** logged by default, so an absence of catalog errors in the log is not evidence of a healthy catalog.
8. **Catalog layer.** Query the catalog's own belief rather than reading provider code (`backstage-catalog`):
   - `GET /api/catalog/entity-facets?facet=kind` — a census. A whole integration that stopped ingesting is visible in one request.
   - `GET /api/catalog/entities/by-query?filter=metadata.annotations.backstage.io/orphan=true` — the orphan set.
   - `GET /api/catalog/entities/by-name/<kind>/<ns>/<name>` — read `status.items`; that is where processing errors actually live.
   - `.../by-name/<kind>/<ns>/<name>/ancestry` — which root is keeping the entity alive, or which one stopped.
   - `GET /api/catalog/locations` — registered roots. `POST /api/catalog/refresh` with `{ entityRef }` forces one cycle instead of waiting out `catalog.processingInterval`.
9. **Scaffolder layer.** Find the task id from the task list page under `/create/tasks`, then read its status and event log. Read the exact backend route paths and client method names from the installed `@backstage/plugin-scaffolder-backend` router and `@backstage/plugin-scaffolder-react` types — they are version-sensitive. Tasks are database rows with a heartbeat, so a task claimed by a backend instance that died stays claimed.
10. **TechDocs layer.** Establish which of the four stages broke — annotation, mkdocs source, generator, publisher — by listing the storage bucket under the entity's lowercased `<namespace>/<kind>/<name>/` prefix before touching anything else (`backstage-techdocs`).
11. **Auth layer.** Drive the flow by hand at `/api/auth/<provider>/start?env=<auth.environment>` and watch the callback. Watch `/api/auth/<provider>/refresh` in the network tab for session-persistence problems. Decode the issued token in the console with `atob(token.split('.')[1])` and check `sub` and `ent` claims against the catalog.
12. **Permissions layer.** Confirm `permission.enabled` in the merged config for that environment — permissions are frequently on in production and off locally, which alone explains "works on my machine". Then confirm whether the policy sees the identity you think it does: an empty ownership claim set from the sign-in resolver denies everything a policy conditions on group membership.
13. **Database layer.** With no `backend.database` config, each plugin gets an in-memory SQLite database that is discarded on restart — that is the cause of "everything is empty again after every deploy". Otherwise check connection-pool saturation, which presents as readiness failing and every plugin slowing at once rather than one plugin breaking.
14. **Integration layer.** Rate-limit exhaustion is partial, not total: discovery returns fewer repos than it did, refreshes stall, 403s arrive in bursts, and it recovers on its own at the quota reset. GitHub Apps (`integrations.github.apps`) get substantially higher limits than a PAT; note that `This endpoint requires you to be authenticated` from a correctly configured app usually means the app is not installed on that organization, not that the credential is wrong.
15. **Stop after three hypotheses.** Form at most three candidate causes, each with a stated disproof test, and run them cheapest-to-disprove first. If all three are disproved, return a **BLOCKED** report containing:
    - the symptom, first-seen timestamp, and blast radius;
    - the change timeline you built in step 3;
    - the three hypotheses and the specific evidence that killed each;
    - the layer you narrowed to and what remains ambiguous within it;
    - the exact access, log, or authorization you would need to continue.
    Do not start a fourth round, and do not apply a speculative fix to see what happens.
16. **Stop for authorization before any production mutation.** Restarting a pod, re-running a provider, deleting or re-registering a location, cancelling or retrying a scaffolder task, editing deployed config, rotating a credential, and running a migration all change shared state and most of them destroy evidence. Propose the exact command, its blast radius, and how you would undo it, then wait.

## Verification

- State the causal chain explicitly: change → mechanism → symptom. It must account for the blast radius *and* the first-seen timestamp. A cause that cannot explain why it started at that moment is not the cause.
- Disprove before declaring: revert or toggle the suspected input in staging and show the symptom follows it in both directions.
- `yarn backstage-cli config:check --lax --deprecated` exits 0 against the deployed config set.
- `/.backstage/health/v1/readiness` returns `{"status":"ok"}` and stays green across a restart.
- The affected entity returns from `GET /api/catalog/entities/by-name/...` with empty `status.items`, populated `relations`, and no `backstage.io/orphan` annotation.
- If OpenTelemetry is wired (`packages/backend/src/instrumentation.js`, Prometheus exporter on `:9464/metrics` by default), confirm recovery against `catalog.processing.duration`, `scaffolder.task.duration`, and backend task-run counters rather than against a page load.
- The incident report names the layer, the change, the evidence, and the durable fix separately from the mitigation.

## Failure modes

- **Entities vanished.** Distinguishing evidence: `entity-facets?facet=kind` shows a whole kind or source collapsed, and `/ancestry` on a survivor points at a root that no longer emits. Causes, in order: a provider emitted `type: 'full'` built from a failed, partial, or rate-limited upstream fetch; `getProviderName()` changed in the deploy so the old bucket became an orphaned provider; or the provider was removed from the backend. `catalog.orphanProviderStrategy: keep` prevents the second and third, but only if set *before* the deploy.
- **Entities present but annotated `backstage.io/orphan: 'true'`.** A parent stopped emitting the child — moved `catalog-info.yaml`, removed `Location` target, crawler no longer finds the source. Default `orphanStrategy` then deletes them, which is why this often reads as "vanished" instead. A corrupt or unreadable file does *not* orphan; it surfaces in `status.items`.
- **Catalog processing falling behind.** Distinguishing evidence: entities are correct but their timestamps lag far past `catalog.processingInterval`, and the lag grows monotonically rather than oscillating. Cause is nearly always a processor doing network I/O — every processor runs on every entity every cycle — or a `full` mutation dumping a huge bucket into the queue at once. Raising `catalog.processingInterval` does not help; it is a suggested minimum, not a rate limit.
- **Slow catalog reads with healthy processing.** Reads hit stitched final entities, so slowness here is stitching or the database, not processors. Check `catalog.stitchingStrategy` (`pollingInterval`, `stitchTimeout`), unfiltered `by-query` calls from a frontend page pulling every entity with every field, and pool saturation. An entity re-stitching every cycle for no reason means its hash is unstable — usually an upstream returning array fields in shifting order.
- **Scaffolder task stuck in a running state.** Distinguishing evidence: the task's last event is old and the step never completes, while other tasks submitted later succeed. The owning backend instance was redeployed or killed mid-task. Recovery is opt-in: `scaffolder.EXPERIMENTAL_recoverTasks: true` with `EXPERIMENTAL_recoverTasksTimeout` (heartbeat timeout, default 30s), plus `spec.EXPERIMENTAL_recovery.EXPERIMENTAL_strategy: startOver` on the template — which re-runs from the beginning and is therefore only safe for idempotent actions. Without it the task stays stuck forever and cancelling is the only exit. A task that fails *fast* and repeatedly is instead an action or credential problem; read the step's error, not the task state.
- **TechDocs 404 / "No documentation found".** The decisive test is whether the entity's prefix exists in storage. Present in storage means the annotation, the entity triplet, or the backend's read credential is wrong. Absent means the pipeline never ran for it — most often `techdocs.builder: 'external'` flipped on before CI published anything, or `metadata.name` changed and orphaned the old storage path.
- **Sign-in broke after a config change or upgrade.** Read the error string; each maps to exactly one cause.
  - `... provider is not configured to support sign-in` — no sign-in resolver configured for that provider.
  - `Auth provider registered for ... is misconfigured` — an environment variable is unset in the deployed environment. `.env` files are not read; confirm with `config:print --lax`.
  - `Login failed; caused by NotAllowedError: Origin '...' is not allowed` — `app.baseUrl` does not match the browser's origin. `auth.experimentalExtraAllowedOrigins` exists but is a workaround, not the fix.
  - `Failed to sign-in, unable to resolve user identity` / user not found — auth succeeded and no matching User entity is in the catalog. This is a catalog ingestion incident wearing an auth costume; go to step 8.
  - After an upgrade, also suspect OAuth redirect-URI hardening: cross-host and path wildcards, implicit protocols, and embedded credentials are all rejected now, and a redirect URI that worked for years can start failing on a patch bump.
- **Permission denials after a policy change.** Distinguishing evidence: content is missing or greyed out rather than erroring, and it differs per user. Confirm the policy is reached at all by temporarily flipping it to a constant result in a non-production environment; if the flip changes nothing, the problem is upstream in identity resolution, not in the policy. Denials also appear when nothing changed in the policy but the ownership claims did — a resolver or org-ingestion change that empties group membership denies every conditional rule.
- **Backend crash-looping on config schema validation.** The message names a config path rather than a stack frame, which misleads you into editing config. Three distinct causes:
  - a key no schema declares any more — deprecated keys removed in an upgrade, e.g. the top-level `bitbucket` integration key removed in v1.49.0 in favour of `bitbucketCloud`/`bitbucketServer` (`backstage-upgrade`);
  - a required value resolving to undefined because one variable inside a `${...}` expression is unset — the whole value becomes undefined, not just the missing part;
  - a **schema-loading** failure: config schemas resolve imported types, so a bad import in a `config.d.ts` breaks schema collection before any value is read.
  The third looks like a config error and is a code error. Reproduce it with `config:schema`; `config:check` will not isolate it.
- **Integration rate-limit exhaustion.** Distinguishing evidence: intermittent 403s from one host, degradation that tracks the provider schedule, and self-recovery at the quota window. The dangerous secondary effect is catalog deletion when a provider turns a truncated response into a `full` mutation. Move to a GitHub App, stagger provider schedules, and for incremental providers set `rejectEmptySourceCollections: true` and `rejectRemovalsAbovePercentage`.
- **"Works in `yarn start`, fails in production."** Local defaults differ from deployed config in ways that produce exactly these incidents: permissions off, TechDocs building locally with Docker, in-memory SQLite, no external-access tokens, a single replica. Always reproduce against the merged production config before believing any local result.

## Do not

- Do not propose a cause before the blast radius and the first-seen timestamp are both written down.
- Do not restart, redeploy, or scale anything in a shared environment to "see if it clears" — it destroys the evidence and usually the logs.
- Do not run `DELETE /api/catalog/entities/by-uid/...`, `DELETE /api/catalog/locations/...`, cancel a scaffolder task, or re-run a provider against production without an explicit stop-and-get-authorization step.
- Do not set `LOG_LEVEL=debug` globally on a production backend; scope it with `backend.logger.overrides` matchers.
- Do not run `config:print --with-secrets` where the output is logged or shared, and never paste its output into a report.
- Do not treat an absence of catalog errors in the logs as a healthy catalog; read `status.items` on the entity.
- Do not set `backend.auth.dangerouslyDisableDefaultAuthPolicy` or `dangerouslyAllowSignInWithoutUserInCatalog` to unblock an incident — both trade an outage for a security hole and both get forgotten.
- Do not fix forward past three disproved hypotheses; return a BLOCKED report.
- Do not close an incident on the mitigation alone — name the durable fix, even when it is out of scope to apply.
