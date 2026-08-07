# ADR-0005: No `isolation: worktree`

**Status:** accepted · **Date:** 2026-08-07
**Enforced by:** `agent-no-worktree-isolation`

## Context

`isolation: worktree` gives an agent its own git worktree. It looks like an
unambiguous safety improvement for an agent with write access, which is exactly
why it needs an ADR rather than a comment.

A worktree branches from the repository's **default branch**, not from the
parent session's `HEAD`.

## Decision

Absent, with a comment stating when it would be correct.

## Consequences

An agent invoked while the user is on a feature branch would work against an
isolated copy that **does not contain the user's work**, then report success
against code the user cannot see and cannot find. This directly contradicts
Phase 0's `git status --short` step and §5.8's "never overwrite unrelated user
changes" — both of which assume the agent and the user are looking at the same
tree.

The failure is quiet and expensive: everything the agent reports is true of the
worktree, and none of it is true of the branch the user is on. There is no error
at any point.

**When it IS correct:** a throwaway exploratory or migration spike, where
branching from the default branch is the intent. In that case it belongs in the
task prompt for that specific invocation, not in the definition that every
invocation inherits.

The general principle worth carrying forward: an isolation default chosen for
safety is not safe when it silently changes *which code* is under the agent's
hands. Isolation that the caller cannot see is indistinguishable from working on
the wrong thing.
