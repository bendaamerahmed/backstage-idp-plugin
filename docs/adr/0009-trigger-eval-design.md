# ADR-0009: Trigger evals measure selection, with majority voting and committed floors

**Status:** accepted · **Date:** 2026-08-07
**Enforced by:** `trigger-results-fresh`, `trigger-corpus-shape`, `trigger-accuracy-floors`, `thresholds-not-quietly-raised-to-fit`

## Context

Fifteen skills compete for the same requests. A skill that never fires is dead
weight; one that fires on everything is noise that displaces the answer the user
wanted. From inside the repository those two failures are indistinguishable —
both look like a well-written skill.

## Decision

Measure the **selection** decision: given the listing a model actually sees
(name + description + `when_to_use` for all fifteen) and a user prompt, which
skill does it pick? Score 209 labelled cases, three votes each, against
committed per-skill floors.

## Consequences

### Selection, not end-to-end triggering

This measures the layer that `description` and `when_to_use` exist to drive. It
does **not** measure whether a full agent turn ends up invoking the skill, which
also depends on task complexity and on what else is in context — Claude skips
consulting a skill for work it can do directly. An end-to-end trigger eval needs
a full agent run per case; at 209 cases that is hours, not minutes.

Stated as a gap in `docs/test-coverage.md`. The mitigation is that the
behavioural scenarios (`test/tier3/scenarios.json`) *do* use full agent runs, so
the end-to-end path is exercised, just not at corpus scale.

### Three votes, not one

Not fastidiousness. Three single-pass runs over an effectively unchanged corpus
scored 90.4%, 89.2% and 87.4% — a three-point spread. A hard floor against that
fires on noise and sends someone rewriting a description that was never the
problem. Majority voting over three took the same measurement to 94.6% and made
it stable enough to hold a floor.

### Floors committed ~10 points below observed

`thresholds-not-quietly-raised-to-fit` requires at least three points of
headroom between each floor and the observed value recorded beside it. The
failure mode of a committed threshold is someone raising it to whatever the last
run produced; after that, a green run is luck rather than evidence.

`negativeRejectionRate` gets the least headroom on purpose. Firing on a
Kubernetes question is worse than missing your own topic: it displaces the
answer the user wanted and spends their context on a procedure that does not
apply.

### Results are committed and hashed

`test/tier3/results/latest.json` carries a hash of the corpus plus every skill's
`description` and `when_to_use`. Editing a description without re-running the
evals fails `trigger-results-fresh` rather than passing on last week's numbers.
That is what makes the floors bind.

### The corpus is adversarial by construction

- 10 positives per skill. `trigger-corpus-shape` requires at least 8; below
  that, one miss moves recall by more than a floor's worth.
- 35 negatives, all **adjacent** — "write a Kubernetes operator", "add RBAC to
  our express API with casbin", "our auth0 flow drops the session cookie on
  safari". A negative like "write a fibonacci function" tests nothing.
- 12 near-misses pitting two of *our* skills against each other. That is where
  descriptions actually get tested, and it is the set that caught
  `backstage-incident-debug` absorbing four other skills' work.

Prompts are written the way people type: lowercase, typos, partial information,
company context. A corpus of clean keyword-matched phrases measures the corpus,
not the plugin.

### Why not the skill-creator loop

`skill-creator` has description-optimisation tooling and it is the right tool
for a single skill. It optimises one description against a should-trigger /
should-not-trigger set. The problem here is fifteen descriptions competing, where
improving one can degrade another — measuring that needs all fifteen in the
listing at once and per-skill precision *and* recall. The corpus format is kept
compatible so the skill-creator loop can be pointed at any individual skill.
