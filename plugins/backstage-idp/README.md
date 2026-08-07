# Backstage IDP Engineering

An autonomous senior engineer for Spotify Backstage developer portals, plus the
twelve workflow skills it calls.

Verified against Backstage **v1.53.x**, August 2026.

## What's in it

**One subagent** — `backstage-fullstack-developer`. A principal-level Backstage
engineer that inspects the repository, plans, implements a complete vertical slice,
tests it, documents it, and reports honestly on what it validated and what it did
not. It owns architecture through to production-readiness: frontend and backend
plugins, Software Catalog, Scaffolder, TechDocs, Search, auth, permissions,
integrations, upgrades, debugging, CI/CD.

**Twelve skills**, each verified against official Backstage documentation rather
than written from model memory:

| Skill | Use it for |
| :--- | :--- |
| `backstage-repo-discovery` | Mapping an unfamiliar monorepo. **Run this first.** |
| `backstage-plugin-create` | Scaffolding a new plugin package and wiring it in |
| `backstage-plugin-migrate` | Legacy → New Frontend/Backend System, MUI → BUI |
| `backstage-catalog` | Entities, providers, processors, ingestion, orphans |
| `backstage-scaffolder` | Templates, custom actions, dry runs, stuck tasks |
| `backstage-permissions` | Permission framework, policies, server-side enforcement |
| `backstage-auth` | Providers, sign-in resolvers, OAuth hardening, CIMD |
| `backstage-techdocs` | mkdocs, techdocs-ref, builders, CI publishing, 404s |
| `backstage-upgrade` | Crossing release lines without breaking the app |
| `backstage-quality-gate` | The validation sweep before calling anything done |
| `backstage-incident-debug` | Production failures, evidence-first |
| `pull-request-ready` | Diff self-review and PR authoring |

## Install

**As a plugin** — point a Claude Code marketplace at this directory, or copy it
into a marketplace repo and install by name.

**Directly into a repository** — copy the pieces into your Backstage monorepo:

```bash
cp agents/backstage-fullstack-developer.md  <repo>/.claude/agents/
cp -r skills/*                              <repo>/.claude/skills/
```

Then invoke with `@backstage-fullstack-developer` or let Claude delegate to it.

## Before you run it

The agent expects a Backstage monorepo. Give it a task with an outcome, not a
file list — "add an Argo CD deployment health card to the service entity page,
with permissions" rather than "edit EntityPage.tsx". It will discover the
repository itself.

It cannot ask you questions mid-run. It resolves ambiguity from the repository and
reports its assumptions, or stops with a `## BLOCKED` report naming the decision it
needs. Read the `## Assumptions` section of its completion report — that is where a
wrong inference shows up first.

It will not push, open a PR, merge, deploy, or mutate anything external. It
prepares the change and hands back the exact command for you to approve.

## Two configuration notes

**`permissionMode` is ignored for plugin agents.** Claude Code drops `hooks`,
`mcpServers` and `permissionMode` from plugin-shipped agents for security reasons.
The field is left in the file because it applies when you install the agent
directly into `.claude/agents/`. If you run it as a plugin and want `auto`, set
permissions at the session level instead.

**`background: false` is load-bearing.** Background subagents lose the task tools,
`BashOutput` and `KillShell` silently. The agent's execution protocol depends on
both. Do not remove it.

## Currency

Backstage ships a mainline release every month. Section 0 of the agent definition
carries a dated baseline table and an explicit rule that the repository's actual
installed versions win over it. The skills follow the same discipline: where an API
signature is version-sensitive they instruct reading the installed package's types
rather than stating a signature that may have moved.

Expect the baseline to need re-verification around October 2026.
