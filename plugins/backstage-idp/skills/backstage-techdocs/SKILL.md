---
name: backstage-techdocs
description: Set up, debug, and CI-publish Backstage TechDocs — mkdocs.yml, techdocs-ref, builder/generator/publisher config, storage backends, and docs that are missing, stale, or fail to build.
when_to_use: techdocs, mkdocs.yml, backstage.io/techdocs-ref, docs tab empty, "No documentation found", stale docs, techdocs S3/GCS/Azure bucket, techdocs builder external, generator runIn docker, @techdocs/cli generate publish, broken docs nav.
---

# Backstage TechDocs

Wire the docs-like-code pipeline correctly, and tell apart the four places it breaks: the entity annotation, the mkdocs source, the generator, and the publisher.

## Preconditions

- Release line from `backstage.json`; TechDocs packages resolved with `yarn why @backstage/plugin-techdocs-backend` and `yarn why @techdocs/cli`.
- Backend generation: `backend.add(import('@backstage/plugin-techdocs-backend'))` in `packages/backend/src/index.ts` is the new backend system; a `createRouter` in `packages/backend/src/plugins/techdocs.ts` is legacy — migrate it (`backstage-plugin-migrate`) before adding a build-strategy module.
- Frontend generation: NFS (default since v1.49) registers TechDocs and its addon modules as `features` from `/alpha` exports; legacy has `TechDocsIndexPage`/`TechDocsReaderPage` inside `<FlatRoutes>` and an `EntityTechdocsContent` tab in `EntityPage.tsx`.
- The **effective merged** config, not `app-config.yaml` alone: `yarn backstage-cli config:print --lax`. Production almost always overrides `techdocs.*` in `app-config.production.yaml`.
- Whether the runtime has Docker (for `runIn: docker`) or Python with `mkdocs-techdocs-core` (for `runIn: local`).

## Procedure

1. **Read the triple before anything else.** `techdocs.builder`, `techdocs.generator.runIn`, `techdocs.publisher.type` determine which failures are even possible.
   - `builder: 'local'` — the backend generates and publishes on demand when a user opens the docs tab. Out-of-the-box default.
   - `builder: 'external'` — the backend only *reads* pre-built docs from storage. It will never build, no matter what is wrong with the source. This is the recommended production architecture.
   - `publisher.type`: `'local'` | `'awsS3'` | `'googleGcs'` | `'azureBlobStorage'`. `local` writes to `techdocs.publisher.local.publishDirectory`, defaulting to a `static` dir at the backend root — pod-local, lost on restart, and invisible to sibling replicas.
2. **Check the entity side second.** In `catalog-info.yaml`, `metadata.annotations['backstage.io/techdocs-ref']` is the only thing that points TechDocs at source:
   - `dir:.` — docs live beside `catalog-info.yaml`; `dir:./sub-folder` for a subdirectory.
   - `url:https://github.com/org/repo/tree/<branch>` (GitLab `url:https://host/org/repo`, Bitbucket `.../src/<branch>`, Azure `.../_git/<repo>`). Suffix a subdirectory path with `/` so relative paths resolve.
   - An entity with no `techdocs-ref` gets no docs tab content. A monorepo child that should show a parent's docs uses `backstage.io/techdocs-entity: <kind>:<namespace>/<name>` (plus `backstage.io/techdocs-entity-path` to deep-link), not a duplicate `techdocs-ref`.
   - A `url:` target must be reachable by an `integrations.*` credential in the *backend's* config, not just yours (`backstage-repo-discovery`).
3. **Check the source layout third.** At the root of whatever `techdocs-ref` resolves to: `mkdocs.yml` (or `mkdocs.yaml`) plus a `docs/` directory containing at minimum `index.md`. Minimum config:

   ```yaml
   site_name: 'example-docs'
   nav:
     - Home: index.md
   plugins:
     - techdocs-core

   ```

   `techdocs-core` is injected automatically when absent unless `techdocs.generator.mkdocs.omitTechdocsCorePlugin: true`. Rename `docs/` only via mkdocs' own `docs_dir` key. `nav` is optional — omitting it makes MkDocs infer navigation from the file tree.
4. **Reproduce locally before changing any config.** From the directory holding `mkdocs.yml`: `npx @techdocs/cli serve` (Docker, full Backstage-like reader on :3000) or `npx @techdocs/cli serve --no-docker`. `serve:mkdocs` gives a bare MkDocs server, which isolates whether a problem is MkDocs or the TechDocs reader. Add `--mkdocs-parameter-strict` to make warnings — dead links, files absent from `nav` — fail the build instead of silently producing empty pages.
5. **Choose `runIn` deliberately; it is a deployment constraint, not a preference.**
   - `docker` pulls `spotify/techdocs` and needs a usable Docker socket. Inside a containerised Backstage this means Docker-in-Docker or a mounted host socket — usually unavailable in Kubernetes, and a privilege escalation where it is.
   - `local` runs `mkdocs` from the backend image's `PATH`. You must bake it in: install `python3`/`python3-pip`/`python3-venv` before the `USER node` line in `packages/backend/Dockerfile`, create a venv, then `pip3 install mkdocs-techdocs-core` **after all other Python packages** so it wins dependency resolution. Python 3.11+.
   Pin the version (`mkdocs-techdocs-core==<x.y.z>`) so a backend rebuild cannot silently change rendering.
6. **For production, move generation out of the backend.** Set `techdocs.builder: 'external'`, configure a cloud publisher, and generate in each entity repository's CI. Do not do the config flip and the CI rollout in the same change — an `external` backend with nothing yet in the bucket serves 404s for every entity.
7. **Write the CI job as generate-then-publish, two distinct steps.**

   ```bash
   npx @techdocs/cli generate --no-docker --source-dir . --output-dir ./site --etag "$COMMIT_SHA"
   npx @techdocs/cli publish --publisher-type awsS3 --storage-name "$TECHDOCS_S3_BUCKET_NAME" \
     --entity default/Component/my-component --directory ./site

   ```

   - `--entity` is the `<namespace>/<kind>/<name>` triplet and must match the catalog entity exactly; it determines the storage path the backend later reads.
   - `--etag` (commit SHA) lands in `techdocs_metadata.json` and is what the backend compares to decide freshness. Omitting it disables staleness detection.
   - `--no-docker` requires `mkdocs-techdocs-core` in the CI runner. Without it, use the default Docker path and drop the flag.
   - Credentials: `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION`, `GOOGLE_APPLICATION_CREDENTIALS`, or Azure `DefaultAzureCredential` env vars. `publish` also accepts `--awsRoleArn`, `--awsBucketRootPath`, `--gcsBucketRootPath`, `--azureAccountName`/`--azureAccountKey`.
   - Trigger on merges to the default branch only, and only when docs paths changed, unless you want every commit rewriting the bucket.
8. **Split the credentials by direction.** CI needs write: S3 `s3:ListBucket`, `s3:PutObject`, `s3:DeleteObject`, `s3:DeleteObjectVersion`; GCS object+bucket create; Azure `Storage Blob Data Owner`. The Backstage backend with `builder: 'external'` needs read only: S3 `s3:ListBucket` + `s3:GetObject`; Azure `Storage Blob Data Reader`. Give the backend a read-only principal — it is the cheapest guarantee that a misconfigured backend cannot wipe published docs.
9. **Use a hybrid build strategy instead of an all-or-nothing flip when migrating.** Keep `builder: 'local'`, point the publisher at cloud storage, and implement `DocsBuildStrategy` from `@backstage/plugin-techdocs-node` in a backend module registered against `techdocsBuildsExtensionPoint` (`techdocs.setBuildStrategy(...)`), gated on an entity annotation. Read the extension point's method names from the installed package's types before writing the call.
10. **Add non-core mkdocs plugins in the place that actually executes MkDocs.** CI/`--no-docker`: install via pip in the runner image. `runIn: docker`: build a `FROM spotify/techdocs:<version>` image with the plugin pip-installed, publish it, and set `techdocs.generator.dockerImage`. Then declare it in each `mkdocs.yml`, or fleet-wide via `techdocs.generator.mkdocs.defaultPlugins` / the CLI's `--defaultPlugin`. Air-gapped runners also need `techdocs.generator.mkdocs.disableExternalFonts: true` (CLI `--disableExternalFonts`) or MkDocs blocks on Google Fonts.
11. **Install addons as modules, matching the app's generation.** Under NFS, `yarn --cwd packages/app add @backstage/plugin-techdocs-module-addons-contrib`, then register the module's `/alpha` export (e.g. `techDocsReportIssueAddonModule`) in the app's `features`. Addons render in registration order. Legacy apps wrap the reader page in `<TechDocsAddons>` in `App.tsx` instead.

## Verification

- Source builds standalone: `npx @techdocs/cli generate --no-docker --source-dir <dir> --output-dir ./site --verbose` exits 0 and produces `site/index.html` **and** `site/techdocs_metadata.json`. No metadata file means no publishable site regardless of exit code.
- Storage contains the entity: list the bucket under the lowercased `<namespace>/<kind>/<name>/` prefix and confirm `index.html` and `techdocs_metadata.json` are present with a recent timestamp.
- Backend can read it: hit the techdocs-backend metadata and static endpoints for the entity (`/api/techdocs/...`, with a token if auth is enforced) — confirm the exact route shapes against the installed `@backstage/plugin-techdocs-backend` router rather than assuming them. Metadata 200 + static `index.html` 200 means the publisher half is correct and any remaining problem is frontend.
- With `builder: 'local'`, the sync endpoint streams build events; a non-`cached`/`updated` terminal event is the real generator error, which the UI usually swallows.
- `yarn backstage-cli config:check --lax` after editing `techdocs.*`, and re-print the merged config to confirm the production override took.
- Nav integrity: `--mkdocs-parameter-strict` on `serve` turns orphaned files and dead links into failures.

## Failure modes

- **"No documentation found" / empty docs tab for one entity.** In order: missing or malformed `backstage.io/techdocs-ref`; the ref points at a directory with no `mkdocs.yml`; the entity was never published under that exact triplet (a rename in `metadata.name` orphans the old storage path); `builder: 'external'` and CI has simply never run for that repo. Distinguish by listing the bucket prefix — present in storage means a backend/annotation problem, absent means a pipeline problem.
- **Docs missing only for repos with a `.gitattributes`.** `export-ignore` strips markdown, assets, or `mkdocs.yml` from the archive the backend downloads, so the preparer sees a directory with no docs. The source looks perfect in the browser. Fix the `.gitattributes` or move that repo to CI generation.
- **Docs render but are permanently stale.** With `builder: 'external'`, the backend never rebuilds — the bucket is the only source of truth, so a stale page means CI did not run or published to a different triplet. With `builder: 'local'` and a cloud publisher, staleness is decided by the `etag` in `techdocs_metadata.json`; a pipeline that omits `--etag`, or that always writes the same value, makes every subsequent check report "up to date". Also check `techdocs.cache.ttl` before blaming the pipeline.
- **Docs stale or flapping across page loads with `publisher.type: 'local'` and >1 replica.** Each pod built its own copy into its own filesystem; the load balancer decides which vintage you see. `local` publishing is single-replica-only. Move to object storage.
- **`Config file '/content/mkdocs.yml' does not exist.`** The generator mounted a directory that has no mkdocs config at its root — usually `dir:.` on a monorepo where docs live in a subfolder, or `mkdocs.yaml` vs `mkdocs.yml` mismatched against a hardcoded name. Fix the ref, not the generator.
- **`The "<name>" plugin is not installed` from MkDocs.** The plugin is declared in `mkdocs.yml` but absent from whatever runs MkDocs. It builds on a laptop with the plugin pip-installed and fails in the generator image. Add it to the custom image (`runIn: docker`) or the CI/backend image (`--no-docker`/`runIn: local`) — never by removing the declaration, which silently drops the feature.
- **Nav renders but pages 404, or pages exist but are unreachable.** `nav` entries are paths relative to `docs_dir`; a typo yields a nav link to nothing, and a file absent from `nav` is built but unlinked. Both are MkDocs *warnings*, so the build succeeds and the site is quietly broken. Run with `--mkdocs-parameter-strict` in CI. Links between markdown files must target the `.md` file, not the generated URL.
- **`AccessDenied` / `403` from the publisher during `publish`.** A write failure: the CI principal lacks `s3:PutObject`/`DeleteObject` (deletes are needed to clear stale files, so a put-only policy fails only on *updates*), or the bucket policy/KMS key rejects it, or `techdocs.publisher.awsS3.sse` disagrees with the bucket's enforced encryption. The same error from the running backend is a *read* failure and means the backend's principal is missing `s3:GetObject`/`ListBucket` — the CI job is fine and the docs are in the bucket.
- **Build failure vs publish failure — they need opposite fixes.** `generate` failing is a source problem: MkDocs config, a missing plugin, bad markdown. Nothing reaches storage and the previously published site keeps serving, so users see stale docs and no error. `publish` failing after a successful `generate` is an infrastructure problem: credentials, bucket, network. Never wire them as one shell command with `&&` hidden behind a single step name; keep them separate so the CI log says which half broke.
- **Everything works in `yarn start` and nothing works in production.** Local dev defaults to `builder: 'local'` + `runIn: docker` + `publisher: 'local'` and quietly builds on demand. The deployed backend has no Docker socket, or `builder: 'external'`. Always reproduce against the merged production config, not the local default (`backstage-incident-debug`).
- **PlantUML diagrams blank.** `svg_object` output is stripped as untrusted HTML. Use `svg_inline`.

## Do not

- Do not flip `techdocs.builder` to `'external'` before docs are actually in the bucket for the entities users open.
- Do not run `techdocs-cli publish` or `migrate --removeOriginal` against a shared or production bucket without an explicit stop-and-get-authorization step; `migrate --removeOriginal` moves rather than copies.
- Do not give the Backstage backend write credentials to the docs bucket when `builder: 'external'`.
- Do not enable `runIn: docker` for a containerised backend without confirming a usable Docker socket; prefer baking mkdocs into the image.
- Do not remove a plugin from `mkdocs.yml` to make a generator error go away.
- Do not hand-edit files in the storage bucket; the next CI run overwrites them and the `etag` will lie.
- Do not change `metadata.name` or `metadata.namespace` on a documented entity without republishing — the old storage triplet becomes unreachable (`backstage-catalog`).
- Do not rely on default (non-strict) MkDocs builds in CI; broken nav and dead links exit 0.
