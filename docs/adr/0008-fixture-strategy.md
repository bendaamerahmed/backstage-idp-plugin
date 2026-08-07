# ADR-0008: Tier 4 fixtures are generated, cached and never committed

**Status:** accepted · **Date:** 2026-08-07

## Context

Tier 4 asserts against a real Backstage monorepo. Three options existed for
where that monorepo comes from: commit one, vendor a trimmed-down synthetic one,
or generate it from `create-app` on demand.

## Decision

Generate from the published `@backstage/create-app`, cache under `fixtures/`
(gitignored), key the cache on the release line, and refuse to use a fixture
built for a different line.

## Consequences

**Why not commit one.** A committed Backstage app is roughly 800 MB with
`node_modules`, or a lockfile-plus-source tree that has to be installed anyway.
Worse, it freezes: the whole point of Tier 4 is to notice when upstream moves,
and a committed fixture is a snapshot of the world on the day it was committed.
It would go green forever while the thing it was meant to detect happened.

**Why not synthesise one.** A hand-built "Backstage-shaped" tree tests our
understanding of Backstage, which is exactly the thing under test. Circular.

**Why cache-key on the release line.** A fixture built for 1.52 does not
exercise the guidance written for 1.53, and using one silently would produce
green runs that mean nothing. `fixtureIsFresh()` compares the stamp against
`baseline.release.currentLine`, and Tier 4 skips with the rebuild command rather
than proceeding.

**Cost: a nightly job that depends on the npm registry.** Accepted, and the
reason Tier 4 is nightly and non-blocking rather than a required check.

**The hybrid fixture is derived, not built.** There is no `create-app` flag for
an NFS app hosting a legacy plugin, so `hybrid` is a copy of `nfs-current` with
the compatibility layer wired per scenario. This proves less than a genuine
hybrid repository would, and `docs/test-coverage.md` says so rather than
implying parity with the other two.

**Every scenario must be able to fail.** `scripts/fixtures/prove-can-fail.mjs`
sabotages a throwaway copy of the fixture — move `engines.node`, delete a root
script, switch `App.tsx` to the legacy import, drop the BUI import — and
requires the suite to go red for each. It is a required step in the integration
workflow, not a one-off. An integration test that cannot fail reports confidence
it has not earned, and nobody finds out until an adopter does.

**Fixtures are secret-scanned.** A fixture is a real install performed inside
CI. `scripts/scan-fixture-secrets.mjs` runs before anything is cached or
uploaded, because repository secret scanning does not cover a gitignored tree —
which is precisely why it needs its own pass.
