---
name: backstage-upgrade
description: Upgrade a Backstage monorepo across release lines using versions:bump, the Upgrade Helper and a per-release breaking-change review, one release line at a time.
when_to_use: '"upgrade Backstage to 1.53", "we''re on 1.44 and need to catch up", "run versions:bump", "app won''t start after the upgrade", "move plugins to @backstage-community", "which release broke this config key".'
---

# Upgrade a Backstage monorepo

Move a repo from its current Backstage release line to a target line without a broken
`main`. The CLI moves versions; the app code, config and Dockerfile are yours to move.

## Preconditions

- `backstage.json` at the repo root read — it holds the app's current release line
  (`{"version": "1.x.y"}`). If missing, derive the line from `@backstage/core-components`
  in `packages/app/package.json`.
- Baseline green on a clean tree: `yarn install --immutable`, `yarn tsc:full`,
  `yarn backstage-cli repo lint`, `yarn backstage-cli repo test`. A red baseline makes
  every later failure unattributable — return BLOCKED.
- Repo generation known (NFS vs legacy frontend, new vs legacy backend) — it decides
  which Upgrade Helper hunks apply. Run `backstage-repo-discovery` if unsure.
- Known: yarn version (`yarn -v`; the Backstage yarn plugin needs ≥ 4.1.1), whether
  `"backstage:^"` version specifiers are in use, root `engines.node`, and the local
  Node major. Supported Node is exactly two adjacent even majors — currently 22 and 24.
- A branch. Never upgrade on `main`.

## Procedure

1. **Record the starting point.** `cat backstage.json`; `yarn backstage-cli info` for
   installed Backstage package, Node and CLI versions. List every non-`@backstage`
   ecosystem dependency (`@backstage-community/*`, `@roadiehq/*`, `@janus-idp/*`,
   `@spotify/*`) — the bump does not touch them by default.
2. **Choose the target.** Default to the latest `main` release line (monthly, released
   the Tuesday before the third Wednesday). Use `--release next` (weekly preview) only
   when explicitly asked; it pins `1.x.0-next.N` into `backstage.json`. Backstage
   versions are **not** semver — a minor bump may contain breaking changes.
3. **Read every intermediate release note, not just the target's.** For each version
   between current+1 and target, read `https://backstage.io/docs/releases/v1.<N>.0`
   (sections: Highlights, Security Fixes, Upgrade path, Links and References) and the
   full per-release changelog at
   `https://github.com/backstage/backstage/blob/master/docs/releases/v1.<N>.0-changelog.md`,
   where every breaking entry is prefixed `**BREAKING**:` and scoped to one package.
   A removal that happened two lines back is invisible in the target's notes.
4. **Turn the notes into a repo-specific checklist.** For each breaking entry, grep this
   repo for the symbol, import path or config key it names; keep the hits as the work
   list. Stable exports get at least one mainline release of deprecation before removal,
   so a deprecation warning ignored now is a startup crash two lines later.
5. **Split large gaps.** More than two minors behind: upgrade **one release line at a
   time**, verifying and committing each increment (`chore: bump backstage to 1.<N>.0`).
   Steps 6–12 are one iteration of that loop.
6. **Bump.** `yarn backstage-cli versions:bump --release 1.<N>.0` (omit `--release` only
   when the target is latest main). Flags: `--pattern <glob>` overrides the match glob
   and must still include `@backstage` if you widen it, e.g.
   `--pattern '@{backstage,roadiehq}/*'`. Non-`@backstage` packages matched this way go
   to their npm **latest**, not to your release line — do that as a separate commit.
   With the yarn plugin installed, bump rewrites specifiers to `"backstage:^"` and drives
   everything from `backstage.json`; keep that file in CI and Docker build contexts.
7. **Migrate moved community packages.** Plugins that left `backstage/backstage` live in
   `backstage/community-plugins` as `@backstage-community/plugin-*` and carry a
   `backstage.moved` field. Run `yarn backstage-cli versions:migrate` to rewrite
   dependency names and import paths (`--skip-code-changes` to touch only `package.json`).
   Community packages version **independently** of the release line — numbers restarted or
   diverged on the move, so `0.7.4` or `0.1.0` against Backstage 1.53 is normal. Never pin
   one to a Backstage version, never leave one on `"backstage:^"` (the yarn plugin cannot
   resolve it), and check its changelog for the minimum Backstage version it requires.
8. **Apply app-code changes the CLI cannot make**, via
   `https://backstage.github.io/upgrade-helper/?from=<current>&to=<target>`. It diffs the
   `create-app` template between the two versions. Work through it file by file:
   `packages/app/src/App.tsx` and `apis.ts`, `packages/app/package.json`,
   `packages/backend/src/index.ts`, `packages/backend/Dockerfile`, root `package.json`
   (`engines`, scripts, `resolutions`), `tsconfig.json`, `app-config*.yaml`,
   `.github/workflows/*`. Decide per hunk against this repo's generation — never paste
   NFS template code into a legacy app or vice versa. Cross-check ambiguous hunks against
   the `@backstage/create-app` CHANGELOG, which carries the prose upgrade steps.
9. **Reconcile config.** `yarn backstage-cli config:check --strict --lax` (strict fails
   on unknown keys; lax skips env-var substitution), then per environment with
   `--config app-config.yaml --config app-config.production.yaml`. Map removed keys to
   their replacement rather than deleting them — e.g. the top-level `bitbucket`
   integration key was removed in v1.49.0 in favour of `bitbucketCloud` /
   `bitbucketServer`. `BACKSTAGE_ENV` takes comma-separated values if you stack configs.
10. **Handle a Node major drop** when the target changes supported majors: root
    `package.json` `engines` (template is `"22 || 24"`), `.nvmrc`/`.node-version`,
    `packages/backend/Dockerfile` base image (template is `node:24-trixie-slim`),
    `@types/node`, and every `actions/setup-node` version in CI. Switch your local Node
    before rebuilding, or the failures you debug will be phantoms.
11. **Audit `resolutions` instead of adding to them.** Every entry in root
    `package.json` `resolutions` pins something the release line now wants to move. After
    the bump, try removing each and reinstalling. Run `yarn dedupe` to collapse
    duplicates. Only add a resolution as a last resort, with an inline comment naming the
    upstream issue and the version that will remove it.
12. **Verify and commit this increment** (below), then loop to the next line. Commit
    `package.json` files, `yarn.lock` and `backstage.json` together — a lockfile split
    across commits is unbisectable.
13. **Stop before anything external.** Pushing the branch, opening the PR, deploying, or
    running migrations against a shared database each need explicit authorization. Hand
    the verified diff to `pull-request-ready`.

## Verification

Run per increment, not once at the end:

- `yarn install --immutable` — must not modify the lockfile.
- `yarn tsc:full`, `yarn backstage-cli repo lint`, `yarn backstage-cli repo test`,
  `yarn build:all`, and `yarn backstage-cli config:check --strict` for each environment's
  config set. Route deeper quality checks through `backstage-quality-gate`.
- `yarn start`, then confirm: backend boots with no schema error, `/catalog` renders,
  `curl localhost:7007/api/catalog/entities?limit=1` returns JSON, and each auth provider
  in use completes a sign-in round trip.
- `cat backstage.json` equals the intended version, and rerunning
  `yarn backstage-cli versions:bump --release 1.<N>.0` reports nothing to change.
- `yarn workspace backend build-image` if the repo ships a container.
- Compare the running app to the pre-upgrade app for missing sidebar items and entity
  tabs — silently dropped extensions fail none of the above.

## Failure modes

- **Backend exits at startup on a config key that worked yesterday.** The schema no
  longer declares it. Find the release that removed it in the intermediate changelogs and
  apply the documented replacement.
- **Schema loading itself fails, naming a plugin, before any config is validated.** Since
  v1.53.0 TypeScript config schemas resolve imported types in `config.d.ts`; a bad import
  in any local or third-party plugin aborts the load. Fix the import, not the config.
- **OAuth suddenly rejects a redirect URI with unchanged config.** Redirect-URI and CIMD
  allowlist patterns are matched per URL component, not against the whole string:
  wildcards no longer cross the host/path boundary, patterns need an explicit protocol,
  and embedded credentials are always rejected. `http://localhost:*` now matches only the
  root path — `http://localhost:*/*` restores port-and-path matching. Built-in loopback
  defaults were updated, so only explicitly configured patterns break.
- **TS errors on props that no longer exist.** Entity cards migrated from Material UI to
  `@backstage/ui`; `variant` and `gridSizes` are gone, BUI renamed boolean props
  (`selected` → `isSelected`, `indeterminate` → `isIndeterminate`) and CSS classes. Fix
  placement in the layout instead of reinstating the prop.
- **BUI `Link`/`ButtonLink`/`Tabs`/`Menu`/`Table` trigger full page reloads or throw.**
  They require a `BUIProvider` inside the router — an app-shell change the Upgrade Helper
  diff carries and you skipped.
- **Cryptic build, jest or native-module errors after a green bump.** Node major mismatch
  between your shell, `engines`, CI and the Dockerfile. Check all four.
- **`Invalid hook call`, duplicate React context, or blank routes.** A stale `resolutions`
  entry or hand-pinned dependency holds an old `react`, `react-router` or
  `@backstage/core-*` alongside the new one. Remove the pin; do not add another.
- **Yarn cannot resolve `"@backstage-community/plugin-<name>": "backstage:^"`.** The move
  renamed the package but left the yarn-plugin specifier. Replace it with a real version
  range from npm.
- **A community plugin bumped to npm latest demands a newer Backstage** than the line you
  are on. Pin it back to the last version compatible with your line and bump it after the
  core upgrade lands.
- **Everything passes, one plugin's page 404s or its tab vanishes.** That plugin moved
  namespace or changed its extension registration; check its own changelog.
- **`yarn.lock` conflicts on rebase.** Regenerate from the merged `package.json` files;
  never hand-merge lockfile hunks.
- **Rollback is not symmetric.** Backend DB migrations run on boot; once the new backend
  has touched a shared database, reverting the code requires a manual Knex rollback.
  Downgrading several lines also produces package mismatches — forward-fix by default.

## Do not

- Do not read only the target release's notes when skipping lines.
- Do not bump more than one release line in a single commit, or mix a bump with a feature.
- Do not run `versions:bump` on a dirty tree or a red baseline.
- Do not add a `resolutions` entry to silence a peer-dependency conflict.
- Do not hand-edit `yarn.lock`, `node_modules`, or `backstage.json`'s version.
- Do not apply the Upgrade Helper diff wholesale; it is a template, not a patch.
- Do not delete an unknown config key without finding its replacement.
- Do not force `@backstage-community/*` versions to match the Backstage release line.
- Do not use `--release next` for a production repo unless explicitly instructed.
- Do not push, open a PR, deploy, or run migrations against a shared database without
  explicit authorization.
- If the baseline is red, no target line can be determined, or a breaking change needs a
  product decision, stop and return a BLOCKED report naming the release and changelog
  entry.
