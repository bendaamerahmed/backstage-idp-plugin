# ADR-0010: Every rule must be shown to fail

**Status:** accepted · **Date:** 2026-08-07

## Context

A validation suite that is green on a healthy tree proves nothing on its own. A
suite of `assert(true)` is also green. This repository's entire value is the
claim that its rules catch things — so that claim needs evidence.

The risk is not hypothetical. Three rules in this repository were written,
passed on the first run, and turned out to be measuring nothing:

- `failure-modes-are-diagnostic` matched a keyword vocabulary of "symptom
  words" and produced 56 false positives against correct content.
- `generation-detected-before-acting` matched only imperative phrasing and
  flagged four skills whose preconditions were *better* than what it asked for.
- The first `no-foreground-watch` check tested `run.timedOut`, which was clean —
  while four orphaned dev-server processes were still running.

## Decision

`scripts/mutation-check.mjs`. For each rule, a mutant that breaks exactly one
thing in a scratch copy of the plugin. The suite must go red **and** the
specific rule that claims to cover that case must be the one that reports it.

Tier 4 has the same requirement through `scripts/fixtures/prove-can-fail.mjs`,
which sabotages a copy of a real fixture.

Both run in CI on every push.

## Consequences

**A mutant caught by a *different* rule is reported as a miss, not a pass.**
Without that, a rule can quietly stop working behind a stricter neighbour and
nobody notices until the neighbour is relaxed.

**Mutants are edits someone would plausibly make**, not arbitrary corruption:
delete `background: false`, unquote a `when_to_use` that begins with a double
quote, trim "obvious" preconditions, bump one manifest and forget the other.
Corrupting a file at random tests the parser; these test the rule.

**Adding a rule means adding a mutant.** Stated in CONTRIBUTING.md and visible
as an unbalanced diff in review.

**One mutant was wrong and the survivor proved it.** The first
`generation-detected-before-acting` mutant rewrote every mention of NFS and
legacy — which also made the skill stop qualifying as generation-sensitive, so
the rule correctly skipped it and the mutant survived. The realistic regression
is someone trimming preconditions while the procedure still branches. Rewritten
that way, and caught. A survivor is as likely to indict the mutant as the rule,
and reading it that way is part of the discipline.

**Cost.** Each mutant is a full fast-tier run against a scratch tree: 22 mutants
in about 40 seconds. Tier 4 sabotage is slower and lives in the nightly job.

**BSIDP_REPO_ROOT exists only for this.** Every rule reads its tree through that
override, so the suite can be pointed at a broken copy without touching the
repository.
