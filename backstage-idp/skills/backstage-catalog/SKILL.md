---
name: backstage-catalog
description: Model, ingest, and debug Backstage Software Catalog entities — descriptor format, refs, relations, custom EntityProviders and CatalogProcessors, and orphaned or vanishing entities.
when_to_use: catalog-info.yaml, entity kinds, annotations, relations, ownership, custom entity provider, catalog processor, ingest from external system, entities disappeared after refresh, orphaned entity, conflicting entity ref, location processing error.
---

# Backstage Software Catalog

Model entities correctly, ingest them from external systems without destroying data, and diagnose what the catalog actually believes.

## Preconditions

- Release line from `backstage.json`; catalog packages resolved via `yarn why @backstage/plugin-catalog-backend`.
- Backend generation: `packages/backend/src/index.ts` using `createBackend()` + `backend.add(import('@backstage/plugin-catalog-backend'))` is the new backend system. A `CatalogBuilder` in `packages/backend/src/plugins/catalog.ts` is the legacy backend — migrate it (`backstage-plugin-migrate`) before adding modules, or register through the builder and say so in your report.
- Exact interface shapes (`EntityProvider`, `EntityProviderConnection`, `CatalogProcessor`, `DeferredEntity`, `processingResult`) read from the **installed** `@backstage/plugin-catalog-node` types, not from memory.
- A running local backend or a reachable catalog base URL, plus a token if auth is enforced, before any debugging step.

## Procedure

1. **Read the catalog's current belief before changing anything.** Query the API rather than guessing:
   - `GET /api/catalog/entities/by-query?filter=kind=component&fields=metadata.name,metadata.annotations` — what exists and where it came from. `POST` to the same path for `$all`/`$any`/`$not`/`$exists`/`$in` predicates.
   - `GET /api/catalog/entities/by-query?filter=metadata.annotations.backstage.io/orphan=true` — the orphan set.
   - `GET /api/catalog/entity-facets?facet=kind` — a kind census, fastest way to spot a whole integration that stopped ingesting.
   - `GET /api/catalog/locations` — registered roots. Static `catalog.locations` entries cannot be removed through this API.
2. **Model the entity before writing ingestion code.** Envelope is `apiVersion` + `kind` + `metadata` + `spec`. `metadata.name` is 1–63 chars of alphanumerics separated by `[-_.]`, unique per kind per namespace; `metadata.namespace` defaults to `default`. Kinds: Component, API, Resource, System, Domain, Group, User, Location, Template. Use `metadata.title` for display strings that cannot be a valid name. `metadata.uid` is output-only — never reference entities by uid.
3. **Write entity refs as `[<kind>:][<namespace>/]<name>`, lowercased.** Kind and namespace default from context (`spec.owner` defaults to Group-ish org kinds, `providesApis` to `api`, namespace to the referring entity's). Produce refs with `stringifyEntityRef` from `@backstage/catalog-model` and parse with `parseEntityRef`; compare case-insensitively. Never hand-build refs with string concatenation across namespaces.
4. **Express relations through spec fields, never by hand.** Processors emit relations from the spec; stitching merges incoming and outgoing edges into the final entity. `relations` and `status` written into a descriptor are discarded.
   - `spec.owner` → `ownedBy` / `ownerOf`. This is the whole of ownership resolution: one owner ref per entity, normally a Group.
   - `spec.system`, `spec.domain`, `spec.subcomponentOf` → `partOf` / `hasPart`.
   - `spec.providesApis`, `spec.consumesApis` → `providesApi` / `apiProvidedBy`, `consumesApi` / `apiConsumedBy`.
   - `spec.dependsOn` → `dependsOn` / `dependencyOf`; `spec.memberOf` → `memberOf` / `hasMember`; `spec.parent`, `spec.children` → `parentOf` / `childOf`.
5. **Choose the ingestion mechanism deliberately.**
   - External system, scheduled or webhook-driven, fits in memory → **EntityProvider**.
   - Enrichment, custom-kind validation, or a custom file format already inside the processing loop → **CatalogProcessor**.
   - Paginated source too large to hold in memory (100k+ records) → **incremental entity provider** from `@backstage/plugin-catalog-backend-module-incremental-ingestion`.
   Processors cannot delete entities; providers can, eagerly. That asymmetry decides most cases. Before writing anything, check whether a built-in or `@backstage-community/plugin-catalog-backend-module-*` provider already covers the source (`backstage-repo-discovery`).
6. **Scaffold rather than hand-roll:** `yarn new --select catalog-provider-module` or `yarn new --select catalog-processor-module`. Both generate a `plugins/catalog-backend-module-<id>-*` package with the class, `readProviderConfigs`, schedule wiring, `config.d.ts`, tests, and a `module.ts` registered from `packages/backend/src/index.ts`.
7. **Wire the module against the right extension point** in `createBackendModule({ pluginId: 'catalog', moduleId: ... })`:
   - `catalogProcessingExtensionPoint` (`@backstage/plugin-catalog-node`) → `addEntityProvider(...)`, `addProcessor(...)`.
   - `catalogModelExtensionPoint` (`@backstage/plugin-catalog-node/alpha`) → `setEntityDataParser(...)` for non-`catalog-info.yaml` formats, `setFieldValidators(...)` for envelope/metadata rules.
   - `incrementalIngestionProvidersExtensionPoint` → `addProvider({ provider, options })`.
   Confirm the method names against the installed package's `.d.ts` before writing the call.
8. **Make the provider identity stable.** `getProviderName()` names the provider's private entity bucket in the database and must be unique and unchanged across restarts and deploys. Renaming it abandons the old bucket; with the default `orphanProviderStrategy` those entities are deleted.
9. **Stamp every emitted entity** with `ANNOTATION_LOCATION` (`backstage.io/managed-by-location`) and `ANNOTATION_ORIGIN_LOCATION` (`backstage.io/managed-by-origin-location`), both in `<type>:<target>` form (targets may contain colons — never split on the first one). Entities missing these are dropped at ingestion with only a warning log.
10. **Pick the mutation type.** `type: 'full'` replaces the whole bucket — correct when you can batch-fetch the complete set, and only then. `type: 'delta'` with `added`/`removed` is correct for webhook and event streams, where you never see the whole set. Do not emit a `full` mutation built from a partially successful fetch; let the task throw and retry on the next schedule instead.
11. **Set `locationKey` on every `DeferredEntity`** to a string identifying the provider *instance* (e.g. `frobs-provider:${id}`), and keep it constant. On a duplicate entity ref the catalog resolves:
    - existing entity has no location key → the incoming entity wins and takes it over;
    - existing key matches the incoming key → update;
    - existing key differs → the incoming entity is discarded, silently.
    This is the only defence against one provider taking over another's entities, so an entity emitted without a `locationKey` is permanently up for grabs.
12. **Handle upstream pagination and rate limits in the provider, not the processor.** Schedule via `scheduler.createScheduledTaskRunner` with a `frequency`/`timeout` read from `catalog.providers.<name>.schedule`. For incremental providers, tune `burstLength`, `burstInterval`, `restLength`, `backoff`, and set `rejectEmptySourceCollections: true` plus `rejectRemovalsAbovePercentage` so a degraded upstream cannot delete the catalog.
13. **In processors, do no network I/O.** Every processor runs on every entity every cycle. If you must call out, use the `CatalogProcessorCache` passed into `preProcessEntity`/`postProcessEntity` with an ETag and `If-None-Match`, and bump the cache key string whenever the cached shape or the processor logic changes.
14. **Implement processor methods for their actual stage**, all of which run on every entity on every cycle:
    - `preProcessEntity` — enrichment, before validation. Filter by kind first; skip when the field already has a value so a `catalog-info.yaml` can override you.
    - `validateEntityKind` — `true` for a kind you own and validated, `false` for a kind you do not recognise (passing it to other processors), throw to mark the entity invalid. Build it from `entityKindSchemaValidator(schema)` over a JSON schema exported from an isomorphic `*-common` package so frontend and backend share it.
    - `postProcessEntity` — emit relations and child entities via `processingResult.relation` / `.entity` / `.location`, errors via `.generalError` / `.inputError` / `.notFoundError`.
    - `readLocation` — only for genuinely new location types; prefer a provider.
15. **Register new kinds in config.** If `catalog.rules` has an `allow` list, add the kind or nothing will be ingested. Use `catalog.processorOptions.<processorName>.priority` (default `20`, lower runs earlier) when order matters — registration order is only guaranteed within a single module.
16. **Run locally and prove the loop:** `yarn start-backend`, then trigger the provider's schedule and re-query the endpoints from step 1.

## Verification

- `yarn tsc` and `yarn test` from the repo root; `yarn backstage-cli config:check --lax` if you added `config.d.ts`.
- Descriptor sanity without registering: `POST /api/catalog/validate-entity` with `{ entity, location }`, or `POST /api/catalog/locations?dryRun=true` with `{ type: 'url', target: ... }`.
- Entity present and final: `GET /api/catalog/entities/by-name/<kind>/<namespace>/<name>` returns `relations` populated and no `metadata.annotations['backstage.io/orphan']`.
- Processing errors: same response's `status.items` — empty means the last processing pass was clean.
- Provenance: `metadata.annotations['backstage.io/managed-by-location']` must name *your* provider for entities you own. A different value means another source won the ref.
- Parentage: `GET /api/catalog/entities/by-name/<kind>/<namespace>/<name>/ancestry` shows which root keeps the entity alive.
- Force a cycle instead of waiting: `POST /api/catalog/refresh` with `{ entityRef }`; for incremental providers `POST /api/catalog/incremental/providers/:provider/trigger` and `GET /api/catalog/incremental/providers/:provider` for state.

## Failure modes

- **Entities vanish after a refresh.** A provider emitted `type: 'full'` from a failed, partial, or empty upstream response. Providers delete eagerly: the bucket entity *and* the entire subtree processed out of it go immediately. Fix the provider to throw on partial reads; recovery is a successful re-run, not a manual re-import.
- **Everything from one integration disappeared after a deploy.** `getProviderName()` changed, or the provider was removed from the backend. Its bucket is now an orphaned provider and is deleted by default. Restore the exact old name, or set `catalog.orphanProviderStrategy: keep` before the deploy.
- **`backstage.io/orphan: 'true'` appears.** A parent stopped emitting the child — a moved `catalog-info.yaml`, a removed `target` from a `Location`, or a crawler that no longer finds the source. The default `orphanStrategy` deletes these; `keep` retains them with the annotation. Use `/ancestry` to find the severed parent. A file that is unreadable or corrupt does *not* orphan — it surfaces as a hard error in `status.items`.
- **Deleting an entity in the UI does nothing.** An active parent re-emits it on the next processing cycle. Only genuinely orphaned entities stay deleted; otherwise remove the registration root — which also removes every entity under it.
- **Two sources claim the same entity ref.** Whoever wrote it first with a `locationKey` keeps it; the loser is discarded with no visible error. Compare `managed-by-location` across the two sources. Separately, two `catalog-info.yaml` files with the same `metadata.name` mean one is processed and the rest are skipped with a log line only. If the correct owner is not determinable from the repo, return a BLOCKED report naming both sources.
- **Entity never appears at all.** In order of likelihood: missing `managed-by-location`/`managed-by-origin-location` annotations; kind excluded by `catalog.rules`; no processor returned `true` from `validateEntityKind` for a custom kind; `catalog.readonly: true` blocking API registration.
- **No errors in the logs.** Catalog processing errors stopped being logged by default (Backstage v1.26.0 / `@backstage/plugin-catalog-backend` v1.21.9). Read `status.items` on the entity, place `EntityProcessingErrorsPanel` on the entity page, or subscribe to catalog error events through `@backstage/plugin-events-backend` — the durable fix when operators keep asking why an entity is stale (`backstage-incident-debug`).
- **The processing loop falls behind.** A processor doing synchronous HTTP, or a `full` mutation dumping a huge bucket at once and flooding the queue. Move I/O to a provider, or switch to incremental ingestion. `catalog.processingInterval` is a suggested minimum only — raising it will not fix a blocking processor.
- **An entity re-stitches every cycle for no reason.** The entity hash covers body, relations, errors, referred entities and parents — including array order, so a source that returns `metadata.tags` in shifting order churns the catalog. Sort arrays in the provider.
- **A custom processor works locally, not in the deployed backend.** Cross-module processor ordering follows module load order. Set `getPriority()` or `catalog.processorOptions.<name>.priority`.

## Do not

- Do not `applyMutation` when the upstream fetch was incomplete, and never emit `full` from an event handler.
- Do not change `getProviderName()` or `locationKey` on a populated catalog without an explicit stop-and-get-authorization step — both destroy entities.
- Do not call `DELETE /entities/by-uid/...`, `DELETE /locations/...`, or the incremental `cleanup` endpoint against a shared or production catalog without explicit authorization.
- Do not reference entities by `metadata.uid`, or split location strings on the first colon.
- Do not hand-write `relations`, `status`, or `backstage.io/orphan` into a descriptor.
- Do not invent annotation keys under the reserved `backstage.io/` prefix; use your own domain prefix.
- Do not loosen `setFieldValidators` to import legacy names without checking for colons, slashes, and URL-unsafe characters — plugins assume they never occur.
- Do not make processors that fetch remote data or that mutate entities they do not filter by kind.
- Do not use `type: file` locations for anything but local development and examples.
