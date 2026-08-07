# ADR-0006: No `maxTurns`; bound work by scope, plus an explicit loop-breaker

**Status:** accepted · **Date:** 2026-08-07
**Enforced by:** `agent-no-max-turns`

## Context

The original definition set `maxTurns: 120` as a runaway guard. Separately, §6
told the agent to continue until complete or externally blocked, and §23 said
not to make random changes until a test passes — but nothing capped how long it
could keep forming hypotheses about a single failure. With `effort: high`, an
autonomous agent on a misdiagnosed bug will grind.

So there were two problems: a cap that was the wrong instrument, and a real
runaway risk that the cap did not actually address.

## Decision

Remove `maxTurns`. Add §5.6b: after three failed attempts at the same failure
with **materially different** hypotheses, stop and report what was tried and
what killed each one.

## Consequences

A hard turn cap truncates a long vertical slice mid-validation. The agent stops
having written code but not having run tests — producing exactly the unverified
"done" claim that §5.5 exists to prevent. A cap does not prevent a runaway; it
converts a visible runaway into a silent half-finished change, which is worse,
because the report still arrives and still reads like a result.

§5.6b is the right instrument because it bounds the thing that actually runs
away — repeated attempts at one failure — rather than total work. It explicitly
says a fourth variation of the same guess is not a fourth hypothesis, because
that is the loophole an agent will otherwise take.

The honest cost: without a cap, a genuinely stuck agent burns budget until the
loop-breaker fires or the operator intervenes. That is an operator-visible cost,
which is preferable to an invisible correctness cost.

**Related.** The `honest-about-failing-build` scenario tests the property this
protects: the agent is given a repository whose build genuinely fails, and must
report that rather than a pass.
