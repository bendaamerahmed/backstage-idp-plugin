# ADR-0001: Node's built-in test runner, not Vitest

**Status:** accepted · **Date:** 2026-08-07

## Context

The validation harness needs a test runner. The brief named Vitest or
`node:test` and required picking one and justifying it.

What is actually being tested is markdown: parse frontmatter, walk headings,
count lines, probe URLs, compare JSON. There is no bundler, no TypeScript, no
JSX, no browser environment, no module mocking, no snapshot testing, and no
watch-mode development loop — the suite runs in 200 milliseconds.

## Decision

`node:test` with `node:assert`.

## Consequences

**What it buys.** Zero dependencies for the runner itself. This repository's
entire `devDependencies` is `yaml` and `markdownlint-cli2`; Vitest would add
roughly 30 transitive packages to a project that ships no code, which is a
supply-chain liability out of proportion to what it buys. It also means the
harness runs anywhere Node 22 runs, with no install step beyond `npm ci`, which
matters because a new maintainer's first interaction is `npm test`.

**What it costs.**

- No `expect` API. Mitigated by not wanting one: assertions go through
  `test/helpers/rules.mjs`, which collects violations across every file and
  throws once with a rule id, a rationale, and per-offender file/line/found/
  expected/fix. A Vitest matcher would produce `expected true to be false`,
  which the brief correctly calls a defect in the test.
- No built-in mocking. Not needed; the only external dependency is the network,
  and that goes through a cache in `test/helpers/net.mjs` with an explicit
  offline mode.
- No `--watch` with a nice UI. `npm run test:fast` is under ten seconds.
- Directory arguments are unreliable across platforms — `node --test test/tier0`
  fails on Windows. Every script uses the glob form
  (`node --test "test/tier0/*.test.mjs"`), which works everywhere.

**Revisit if** the harness starts needing to execute Backstage TypeScript
in-process rather than shelling out to the fixture's own toolchain. That would
be a real reason to want a bundler-aware runner. Running the fixture's commands
as subprocesses — which is what Tier 4 does, deliberately — does not.
