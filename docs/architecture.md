# Architecture

## Why an agent plus skills, not one large prompt

The obvious design is one very good system prompt. It was tried — `1.0.0` was
close to that shape, with §16 listing twelve skills as a roadmap rather than as
shipped code. Three things make the split worth its cost.

**Attention is the scarce resource, not context length.** The agent definition is
~2,000 lines. Twelve skills at ~120 lines each is another ~1,500. Loaded
together that is a document nobody — human or model — applies uniformly; the
sections that get followed are the ones near the top and near the task. Loading
one skill at a time means the procedure the agent is executing is the procedure
in front of it.

**Different things go stale at different rates.** The agent's principles —
inspect before changing, validate before claiming, stop before mutating a shared
system — have not needed a correction since they were written. The skills'
content is version-sensitive by construction: package names move, config keys are
removed, a blueprint relocates between packages. Splitting them means a monthly
Backstage release touches twelve small files with focused diffs, not one file
where a reviewer cannot see what changed in substance.

**A skill can be measured; a paragraph cannot.** `backstage-catalog` has a
trigger precision and recall (Tier 3) and a set of assertions checked against a
real monorepo (Tier 4). "The paragraph about catalog providers" has neither. The
split is what makes the content testable at all, and testability is the whole
difference between this and a well-written document.

The cost is real: twelve descriptions competing for the same requests, which is
why Tier 3 exists and why `backstage-incident-debug` had to be given an explicit
boundary clause after it was measured absorbing four other skills' work.

## The layering

```text
user request
     |
     v
+---------------------------------------------------+
|  skill listing: 12 x (name + description +        |   <- Tier 3 measures this
|  when_to_use), ~1.5 KB, always in context         |      selection decision
+---------------------------------------------------+
     | selects at most one
     v
+---------------------------------------------------+
|  SKILL.md body: Preconditions, Procedure,         |   <- Tier 0 enforces the
|  Verification, Failure modes, Do not              |      shape, Tier 1 the
|  90-175 lines, loaded on demand                   |      content invariants
+---------------------------------------------------+
     | executed by
     v
+---------------------------------------------------+
|  backstage-fullstack-developer                    |   <- Tier 3 behaviour
|  identity, execution protocol, safety properties, |      scenarios measure
|  reporting contract, Section 0 version baseline   |      this
+---------------------------------------------------+
     | acts on
     v
+---------------------------------------------------+
|  a real Backstage monorepo                        |   <- Tier 4 asserts with
+---------------------------------------------------+      the repo's own tools
```

Each layer has a tier that measures it. That correspondence is not decorative:
when something regresses, the tier that goes red tells you which layer to look
at. A trigger-accuracy failure is a `when_to_use` problem; a Tier 4 failure is
either upstream moving or a skill body asserting something false; a Tier 3
behaviour failure is the agent definition.

## How a skill earns its place

A skill is justified when all four hold. Three out of four is a section in an
existing skill, not a new one.

1. **It has a procedure, not a topic.** "Catalog" is a topic. "Ingest entities
   from an external system without a partial upstream response deleting
   everything" is a procedure — ordered steps, a verification, known failure
   modes.
2. **The model gets it wrong without help.** If a competent model already does
   the right thing, the skill costs attention and buys nothing. The honest test
   is a baseline run without the skill.
3. **It can be triggered distinctly.** If no user phrasing selects it over its
   neighbours, it will never fire. Tier 3 makes this falsifiable before the
   skill ships rather than after nobody uses it.
4. **It is verifiable.** Either a Tier 4 scenario asserts its output with the
   repository's own toolchain, or `docs/test-coverage.md` says plainly that it
   is unverified. Unverified content that reads like verified content is the
   failure mode this whole repository is built against.

## Why the agent is not itself a skill

Skills are procedures; the agent is a *stance* — how to decide, when to stop,
what counts as done, what never to do without a human. That does not decompose
into steps and it must apply to every task, including tasks no skill covers. It
also carries the frontmatter, and four of those fields are load-bearing safety
properties (ADR-0003 through ADR-0006) that a skill has no way to express.

## Why the plugin ships no code

`plugins/backstage-idp/` contains markdown and JSON, and Tier 0 fails the build
if anything else appears in it. This is a deliberate boundary: the plugin
*instructs* an agent that already has a shell and write access, and adding
executable content to the bundle would mean adopters are also installing code
they have not reviewed. All the tooling in this repository stays outside the
bundle. See `SECURITY.md` for what that does and does not protect against.

## Why `baseline.json` exists separately from Section 0

Section 0 of the agent definition is what the agent reads. `baseline.json` is
what the currency job checks. They must agree — Tier 0 parses the Section 0
table and compares it field by field — but they cannot be the same artifact,
because one is prose optimised for a model reading it mid-task and the other is
structured data with a source URL and a `verifiedOn` date per fact.

Keeping both, and testing that they agree, is what stops the common failure:
a currency job that passes against a machine-readable file nobody's agent ever
reads, while the prose it was supposed to guard drifts.
