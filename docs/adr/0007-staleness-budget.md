# ADR-0007: A three-line staleness budget, and what happens at each step

**Status:** accepted · **Date:** 2026-08-07
**Enforced by:** `baseline-within-staleness-budget`

## Context

Backstage ships a mainline release every month. The largest risk to this
artifact is not a bug — it is silent staleness. A skill that confidently states
a removed API is worse than no skill, because the agent acts on it, and nothing
else in the repository can detect it: the content stays internally consistent,
every structural rule passes, and all the cross-references resolve.

Some budget has to say when "slightly behind" becomes "wrong".

## Decision

Measured in **release lines** (one mainline minor: 1.53 to 1.54), between
`baseline.release.currentLine` and the live line from
`versions.backstage.io/v1/tags/main/manifest.json`.

| Lines behind | Effect |
| :--- | :--- |
| 0 | nothing; any open currency issue closes automatically |
| 1 | warning printed, and a finding in the generated issue |
| 2 | issue opened, listing the assertions to re-verify |
| 3 or more | the weekly job fails |

## Consequences

**Why one line is a warning, not a failure.** The baseline is re-verified weekly
and Backstage ships monthly, so being one line behind is the normal steady state
for part of every month. Failing there means a permanently red job, and a
permanently red job is a muted job.

**Why three is the failure point.** Two lines is a missed cycle — worth an
issue, not worth blocking. Three means roughly a quarter in which nobody has
looked at a plugin that asserts version-sensitive facts. That is the point where
a removed API stops being documentation lag and becomes an instruction the agent
follows confidently.

**Never a required check on a pull request.** A Backstage release must not be
able to block unrelated work. Exceeding the budget fails a scheduled job and
opens an issue; it never blocks a merge.

**The output matters more than the threshold.** `scripts/currency-issue.mjs`
produces a per-assertion list: what the baseline says, what upstream says, the
source URL, when it was last verified, and the specific edit to make. It opens
by telling the reader **not** to close the issue by bumping `verifiedOn`. A
scheduled job whose output is a red X gets muted within two months, and then
there is no staleness detection at all — the threshold would be decoration.

**Related open decision.** `baseline.supportMatrix.oldestSupportedLine` is
`1.44`, which is the oldest line the skills' guidance was *written* against, not
a line anything has been tested on. See `OPEN-DECISIONS.md` #4.
