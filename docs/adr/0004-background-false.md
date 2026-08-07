# ADR-0004: `background: false` is load-bearing

**Status:** accepted · **Date:** 2026-08-07
**Enforced by:** `agent-background-false`

## Context

Since Claude Code v2.1.198, subagents run in the background by default. A
background subagent keeps only a reduced built-in tool set. Removed, silently:
`TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`, `BashOutput`, `KillShell`.

This agent's execution protocol depends on task tracking throughout (Phase 3,
§14) and on tailing long-running processes it has backgrounded.

## Decision

`background: false`, with the reasoning recorded in the frontmatter comment
block and a dedicated Tier 0 rule that fails if it is removed.

## Consequences

Deleting this line produces no error. It produces an agent whose protocol
references tools it no longer has: it cannot track its own work, cannot read the
output of a process it started, and cannot stop one. The failure surfaces as
degraded behaviour with no message pointing at the cause, which is the worst
shape a regression can take.

§14 also gained a `TodoWrite` fallback, so a stripped task tool degrades
gracefully rather than aborting the protocol — defence in depth, not a
replacement for this setting.

**Cost.** The agent occupies the foreground, so the operator waits. That is the
correct trade for an agent that runs full vertical slices and must be observable
while it does.

**Related.** `BashOutput`, `KillShell` and `Monitor` are separately asserted
present (`agent-has-process-control-tools`). Without them, §14's "never run a
watch process in the foreground" is an instruction the agent cannot follow — it
would have no way to read or stop what it backgrounded. The setting and the
tools are one decision in two places.

**Revisit if** Claude Code stops stripping tools in the background, or if the
protocol stops depending on them. Either needs evidence and an update here
first.
