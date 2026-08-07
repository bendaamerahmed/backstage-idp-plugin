# ADR-0002: Marketplace layout, plugin in a subdirectory

**Status:** accepted · **Date:** 2026-08-07

## Context

The artifact arrived as a loose directory with `backstage-idp/` inside it, plus
two copies of the agent definition, a review report and a zip. It had to become
a repository. The choice was whether `backstage-idp/` becomes the repository
root (single-plugin repo) or stays a subdirectory under a root
`.claude-plugin/marketplace.json` (marketplace repo).

## Decision

Marketplace shape. `plugins/backstage-idp/` under a root
`.claude-plugin/marketplace.json`.

## Consequences

**The root belongs to the harness, not to the plugin.** This is the property
that actually decided it. `package.json`, `test/`, `scripts/`, `fixtures/`,
`baseline.json` and `.github/` are all *about* the plugin and none of them ship
inside it. With the plugin at the root, every one of them would sit alongside
the content, and the boundary between "what an adopter receives" and "what
verifies it" would be a convention rather than a directory. Tier 0's
`plugin-bundle-contents` rule — nothing but `.md` and `.json` inside the plugin
— is only enforceable because that boundary is physical.

**Installable by name.** A marketplace entry means `backstage-idp` is installed
by name rather than by copying files, which is what makes versioning and the
update path meaningful.

**Room for the second plugin.** The skills already suggest a split (a Backstage
*operations* plugin is a plausible sibling). Converting a single-plugin repo to
a marketplace later is a breaking change to every adopter's install path;
starting here costs one directory level.

**Cost.** One extra path segment everywhere, and two manifests carrying a
version instead of one. The second is mitigated by `scripts/set-version.mjs` and
by `version-single-source`, which fails the build when they disagree — they
already had disagreed once before that rule existed.

**Deleted rather than kept in sync.** The top-level
`backstage-fullstack-developer.md` was byte-identical to the copy inside the
plugin. Two copies of a 2,000-line file with no test comparing them is a
divergence waiting to happen. The plugin copy is canonical; the pre-review
ancestor stays in `archive/` because it is audit trail, not a second source.
