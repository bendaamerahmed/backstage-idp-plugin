# ADR-0003: No `AskUserQuestion`; a structured BLOCKED report instead

**Status:** accepted · **Date:** 2026-08-07 · **Supersedes:** the 1.0.0 frontmatter
**Enforced by:** `agent-no-ask-user-question`, `no-mid-run-questions`, `blocked-report-defined`

## Context

The original definition granted `AskUserQuestion` in `tools` and built
escalation behaviour on it in three sections (§5.6, §14, §32).

Claude Code strips `AskUserQuestion` from **every** subagent, regardless of what
the `tools` list says. There is no error and no warning. The agent believes it
has an interactive channel and does not.

## Decision

`AskUserQuestion` is absent from `tools`, and the definition says so explicitly
in a comment. When the agent hits a decision it cannot infer, it stops and
returns a structured `## BLOCKED` report. Every completion report carries an
`## Assumptions` section.

## Consequences

The observed failure without this is not a hang — it is worse than a hang. An
agent that believes it can ask either invents a default silently and continues,
or prints a question and returns as though it had been answered. Both produce a
completed-looking report built on an inference nobody saw.

`## Assumptions` is the compensating control. With no interactive channel, it is
the only place a wrong inference becomes visible before it compounds into the
rest of the change. That is why it is asserted separately.

The rule cuts both ways in the content: `no-mid-run-questions` fails on any
skill that says "ask the user", but explicitly permits sentences that *document*
the absence of the channel — the negation is the correct form, and the agent
definition is full of it.

**Verified behaviourally**, not only structurally: the `blocked-on-undecidable`
scenario in `test/tier3/scenarios.json` gives the agent a repository with two
contested owners and no way to decide, and requires a `## BLOCKED` report and no
written file.

**Do not re-add it** on the grounds that the tools list looks incomplete. If
Claude Code ever stops stripping it, that is a platform change requiring
evidence, an update to this ADR, and a separate commit for the Tier 0 rule —
see `CONTRIBUTING.md`.
