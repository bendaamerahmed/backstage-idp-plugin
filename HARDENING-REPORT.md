# Hardening report — `backstage-fullstack-developer`

**Reviewed:** 6 August 2026
**Input:** `backstage-fullstack-developer.md`, 1,765 lines
**Output:** revised definition (~1,990 lines) + this report

The original spec is well built. Its principles, execution protocol, security
guardrails and definition-of-done needed almost no correction — they are written at
a level of abstraction that ages well. Everything below is either a **runtime
defect** (the agent would not behave as written under Claude Code's actual subagent
rules) or a **currency gap** (Backstage moved). No principle was removed.

---

## A. Runtime defects — highest severity

These are the ones worth reading. Each would have degraded the agent silently, with
no error message pointing at the cause.

### A1. `AskUserQuestion` does not exist for subagents

The frontmatter granted it and three sections (§5.6, §14, §32) built escalation
behavior on top of it. Claude Code strips `AskUserQuestion` from **every** subagent
regardless of the `tools` list. The agent had no way to ask, and no instruction for
what to do instead — the likely failure is that it invents a default silently, or
prints a question and returns as if answered.

**Fixed:** removed from `tools`. §5.6 rewritten as *decide, or stop and return a
structured `## BLOCKED` report*. §32 now states that "request authorization" means
return control with the command staged, not pause and wait. A `## Assumptions`
heading was added to the completion report template in §26 — with no interactive
channel, that heading is the only place a wrong inference surfaces before it
compounds.

### A2. Background execution silently strips the task tools

Since Claude Code v2.1.198 subagents run in the background **by default**. A
background subagent keeps only a reduced built-in tool set;
`TaskCreate`/`TaskGet`/`TaskList`/`TaskUpdate`, `BashOutput` and `KillShell` are
removed without an error. Phase 3 and §14 depend on task tracking throughout.

**Fixed:** `background: false` added to frontmatter, with a comment explaining why
it must stay. §14 gained a `TodoWrite` fallback so a stripped tool degrades
gracefully instead of aborting the protocol.

### A3. `isolation: worktree` branches from the wrong commit

A worktree branches from the repository's **default branch**, not the parent
session's `HEAD`. An agent invoked while the user is on a feature branch would work
against an isolated copy that does not contain the user's work — then report success
against code the user cannot see. This directly contradicts Phase 0's
`git status --short` step and §5.8's "never overwrite unrelated user changes".

**Fixed:** removed, with a comment explaining when to re-enable it (throwaway
migration or exploration spikes, stated explicitly in the task).

### A4. `maxTurns: 120` manufactures the failure §5.5 forbids

A hard turn cap truncates a long vertical slice mid-validation. The agent stops
having written code but not having run tests — producing exactly the unverified
"done" claim that §5.5 exists to prevent. Bound work by scope, not by a counter.

**Fixed:** removed, with the reasoning recorded in the frontmatter comment.

### A5. No loop-breaker

§6 said "continue until the task is complete or a genuine external blocker prevents
completion", and §23 said "do not make random changes until a test passes" — but
nothing capped how long the agent could keep forming hypotheses about one failure.
On a misdiagnosed bug, an autonomous agent with `effort: high` will grind.

**Fixed:** new §5.6b — after three failed attempts at the same failure with
materially different hypotheses, stop and report what was tried and what killed each
one. Explicitly notes that a fourth variation of a guess is not a fourth hypothesis.

### A6. `yarn start` would hang the session

§14's Bash guidance listed builds and tests but never addressed never-exiting
processes, and the toolset had no way to read one. A foreground `yarn start` is an
easy and total hang.

**Fixed:** added `BashOutput`, `KillShell` and `Monitor` to `tools`; §14 now
forbids foreground watch processes and requires cleanup of anything started.

---

## B. Currency corrections — Backstage moved

Verified against `backstage.io` on 6 August 2026.

| # | Original said | Actually true now |
| :-- | :--- | :--- |
| B1 | No version baseline at all | Stable line **v1.53.x**; monthly mainline releases; Node **22 and 24** only |
| B2 | New frontend system framed as an emerging option | **Default for new apps since v1.49.0**; `create-app --next` replaced by `--legacy` |
| B3 | §7.2 listed NFS indicators loosely, mixing `createApp` (ambiguous — exists in both systems) with NFS markers | Rewritten with import-source disambiguation, named blueprints (`PageBlueprint`, `ApiBlueprint`, `NavItemBlueprint`, `EntityContentBlueprint`), and explicit legacy markers |
| B4 | §8.4 said "reuse Backstage components" with no mention of the UI migration | **`@backstage/ui` (BUI, formerly Canon)** is replacing Material UI; entity cards already migrated, `variant`/`gridSizes` props removed; navigating BUI components require `BUIProvider` |
| B5 | §22 upgrade steps were generic ("align versions using supported tooling") | Now names `yarn backstage-cli versions:bump`, the Upgrade Helper for app-code changes the CLI cannot make, and one-minor-line-at-a-time for large gaps |
| B6 | §15 listed "Bitbucket" flatly | The deprecated top-level `bitbucket` config key was **removed in v1.49.0** → `bitbucketCloud` / `bitbucketServer`; `BitbucketUrlReader` dropped from backend defaults |
| B7 | Nothing on Backstage's own MCP surface | New §15.1 on `@backstage/plugin-mcp-actions-backend`: **SSE transport removed in v1.53.0** (Streamable HTTP only), and exposed actions treated as a privilege-escalation surface needing an allowlist |
| B8 | §12.1 auth guidance was generic | OAuth redirect-URI matching **hardened** (no cross-boundary wildcards, explicit protocols, embedded credentials rejected); **CIMD stable, DCR deprecated** |
| B9 | §7.5 config guidance | Config schemas now **resolve imported types**, so a previously-passing import can fail schema loading outright; `BACKSTAGE_ENV` accepts comma-separated stacking |
| B10 | Nothing on proxies | `bootstrapEnvProxyAgents` removed from `@backstage/cli-common` → `NODE_USE_ENV_PROXY=1` — a common corporate-network install failure |
| B11 | §33 reference list | Added release notes, versioning policy, roadmap, `ui.backstage.io`, Upgrade Helper, community-plugins repo; plus a rule naming the six surfaces where memory must not be trusted |
| B12 | §5.1 discovery | Now reads `backstage.json` (authoritative release-line marker) and `engines.node` / `.nvmrc` before install |

The three most consequential are **B2**, **B4** and **B7**: an agent unaware that
NFS is the default will scaffold legacy plugins into new apps; one unaware of BUI
will write Material UI into components that have already migrated; one unaware of
the MCP surface will miss both a capability and a security boundary.

---

## C. Deliberately left alone

Not everything flagged during review deserved a change.

- **§16's twelve recommended skills do not exist.** The spec already handles this
  correctly — "if they do not exist, follow the equivalent workflow directly." It
  reads as a roadmap, which is fine. Building them is a separate piece of work.
- **The nine-item section on observability, §19 on performance, §24's review
  checklist.** Version-independent and accurate. Untouched.
- **`permissionMode: auto`, `model: opus`, `effort: high`, `memory: project`,
  `color: cyan`.** All valid fields with appropriate values for this agent.
- **`Skill` in the `tools` list.** Valid. A note was added that preloading a
  skill's full text needs the separate `skills:` field instead.
- **Section numbering.** The new baseline is §0 so every existing cross-reference
  in the document stays correct.

---

## D. What was not verified

Stated plainly rather than left implied:

- **No Backstage repository was available in this session**, so nothing here was
  tested against a real monorepo. The corrections come from official documentation
  and the Claude Code subagent reference, not from a run.
- The frontmatter defect analysis (§A1–A4, A6) is derived from the current Claude
  Code subagent documentation. It reflects documented behavior at specific versions
  (v2.1.198 for background default, v2.1.208 for zero-tool launch failures) and
  should be re-checked if you pin an older Claude Code.
- Backstage ships monthly. **§0 will be stale by roughly October 2026.** The table
  is designed to be re-verified rather than trusted — that is why it carries a date
  and an explicit "the repository wins" rule.

---

## Sources

- [Backstage v1.53.0 release notes](https://backstage.io/docs/releases/v1.53.0/)
- [Backstage v1.49.0 release notes](https://backstage.io/docs/releases/v1.49.0/)
- [Release & versioning policy](https://backstage.io/docs/overview/versioning-policy/)
- [Backstage roadmap](https://backstage.io/docs/overview/roadmap/)
- [The frontend system](https://backstage.io/docs/frontend-system/)
- [Building frontend plugins](https://backstage.io/docs/frontend-system/building-plugins/index)
- [New backend system](https://backstage.io/docs/plugins/new-backend-system/)
- [Backstage UI](https://ui.backstage.io/)
- [`@backstage/plugin-mcp-actions-backend`](https://github.com/backstage/backstage/tree/master/plugins/mcp-actions-backend)
- [Backstage Weekly #126 — New Frontend System becomes default](https://roadie.io/backstage-weekly/126-new-frontend-system-default-ai-context-idp-architecture/)
- [Claude Code — custom subagents](https://code.claude.com/docs/en/sub-agents)
