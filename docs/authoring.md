# The skill authoring contract

Everything here is enforced by Tier 0 or Tier 1 unless marked **judgement**.
Where a rule is mechanical, the rule id is given — that is the string you will
see in a failure, and searching for it in `test/` shows exactly what is checked.

## Frontmatter

```yaml
---
name: backstage-catalog
description: Model, ingest, and debug Backstage Software Catalog entities — …
when_to_use: catalog-info.yaml, entity kinds, annotations, …
---
```

| Field | Rule | Enforced by |
| :--- | :--- | :--- |
| `name` | identical to the containing directory, kebab-case, unique, no `:` | `skill-name-matches-directory`, `skill-name-unique-and-colon-free` |
| `description` | non-empty, under 200 characters, says what the skill **does** | `skill-description-bounds` |
| `when_to_use` | non-empty, the phrases a user would actually type | `skill-when-to-use-present` |
| both together | under 1,536 characters | `skill-listing-budget` |
| anything else | rejected | `skill-frontmatter-known-keys` |

An unrecognised key is not an error at load time — it is silently ignored. A
typo like `when-to-use` produces a skill that looks configured and contributes
nothing to triggering, which is why the allow-list is strict.

### The YAML quoting trap

This one has shipped broken three times. It gets its own rule
(`skill-frontmatter-quote-trap`) with its own message.

```yaml
# BROKEN — not valid YAML. The skill silently fails to load.
when_to_use: "create a new plugin", "add a plugin to our Backstage"

# CORRECT — single-quote the whole scalar.
when_to_use: '"create a new plugin", "add a plugin to our Backstage"'
```

YAML reads a leading `"` as the start of a quoted scalar, so a value that merely
*contains* quoted phrases is a parse error. There is no warning: the skill is
dropped from the listing and simply never fires. If you want quoted user
phrasings — and they are useful, because they read as literal utterances —
wrap the entire value in single quotes and double any internal apostrophe
(`we''re on 1.44`).

## Required sections

Exactly once, in this order (`skill-required-sections`):

1. `## Preconditions` — what must already be true. Not a summary; a gate. If a
   precondition is unmet the skill should say what to do about it (usually:
   run `backstage-repo-discovery`, or return BLOCKED).
2. `## Procedure` — a numbered list, ascending from 1 with no gaps
   (`skill-procedure-is-numbered`). The numbers are how a BLOCKED report says
   where it stopped.
3. `## Verification` — how to know it worked, in commands and observable
   outcomes. "Check it looks right" is not verification.
4. `## Failure modes` — `- **<what you observe>.** <why, then what to do>`
   (`failure-modes-symptom-first`). The observable comes first because at the
   moment this list is needed, the symptom is the only thing known.
5. `## Do not` — the things that are wrong even though they work.

The order is load-bearing. The agent reads positionally, and moving `Do not`
above `Procedure` measurably changes behaviour.

## Length

90–175 lines (`skill-length-bounds`).

Below 90 the skill is not carrying enough procedure to beat the model's own
priors — it is a topic heading with opinions. Above 175 it stops being read in
full, and the sections that stop being applied are the last two, which are the
ones that prevent damage.

If a skill is growing past the ceiling, the fix is almost always that it has
absorbed a second workflow. Split it, and expect to spend time on the two
`when_to_use` values so they do not fight.

## The version-sensitivity rule

This is the rule that matters most, because breaking it produces the failure
this repository exists to prevent: content that is confidently wrong.

**Never state a version-sensitive fact as settled.** If you cannot verify it
against official Backstage documentation or an installed package *today*, mark
it and instruct reading the installed types.

```markdown
<!-- Wrong: a signature stated flatly. It will be wrong within a year, and the
     agent will write it, get a type error, and "fix" it with a cast. -->
`createTemplateAction` takes `id`, `description`, `schema` and `handler`.

<!-- Right: the shape, plus where the truth lives. -->
`createTemplateAction` from `@backstage/plugin-scaffolder-node` takes `id`,
`description`, `examples`, `supportsDryRun`, `schema.input` / `schema.output`
and `handler`. The accepted schema shape has changed across releases, so read
`createTemplateAction`'s type from the **installed** package before writing it.
```

Four kinds of fact are never recalled, always read:

- **import paths** — symbols move between packages and in and out of `/alpha`
  without renaming
- **function signatures** — read the installed `.d.ts`
- **config keys** — confirm against the owning package's `config.d.ts`
- **package names** — community plugins moved scope one at a time

`api-signatures-marked-version-sensitive` enforces a **heuristic** version of
this: a known Backstage API name followed by an argument list, in prose, must
have a version-sensitivity marker in the same paragraph. It detects the *shape*
of an over-confident claim, not its truth. Whether a claim is actually still
correct is a review question — see `docs/test-coverage.md`, which is honest
about this being a heuristic.

## Other content invariants

| Rule | What it stops |
| :--- | :--- |
| `mutation-commands-gated` | An ungated `git push` in a procedure. The agent runs commands it finds; it has no channel to check first. |
| `skill-has-authorization-stop` | A skill that can reach a shared system with no instruction to stop. |
| `no-mid-run-questions` | "Ask the user…" — `AskUserQuestion` is stripped from every subagent, so an instruction to ask is a latent hang. Return a BLOCKED report. |
| `generation-detected-before-acting` | Guidance that branches on NFS vs legacy without telling the reader how to tell which they are in. |
| `no-generation-from-version` | Inferring composition from the release line. `backstage.json` predicts nothing; only imports do. |
| `no-squatted-cli-invocation` | `npx backstage-cli` — the bare npm name is an unrelated third-party package. |
| `skill-cross-reference-resolves` | A backticked sibling-skill name that does not ship. |
| `named-packages-exist` | An `@backstage/*` name that 404s on the registry. |
| `cited-urls-resolve` | A documentation link that is gone. |

## Formatting

No emoji, no tabs, LF endings, no trailing whitespace, one trailing newline, no
`TODO`/`TBD`/`FIXME`/`XXX`/`<placeholder>`/`Lorem`. Fenced blocks declare a
language and sit inside blank lines. `markdownlint-cli2` with the committed
config must pass.

Emoji are excluded for a specific reason rather than taste: they tokenise
badly, render inconsistently across the terminals adopters use, and the agent
mirrors them back into commit messages and PR bodies.

## Changing `description` or `when_to_use`

These decide whether the skill fires at all, so they are the only fields with a
measurement attached.

1. Make the change.
2. `npm run evals` — 209 cases, 3 votes each, roughly 16 minutes.
3. Check per-skill precision and recall against `test/tier3/thresholds.json`.
4. Commit the regenerated `test/tier3/results/latest.json` **with** the content
   change. The results carry a hash of the corpus plus every description and
   `when_to_use`; committing one without the other fails
   `trigger-results-fresh`.

**Judgement:** when a skill loses accuracy, the fix is nearly always these two
fields, not the body. Two patterns recur:

- *Over-triggering* (low precision) — the `when_to_use` claims ground another
  skill owns. Add an explicit boundary. `backstage-incident-debug` says: "Once
  the layer IS known, or the problem is on a laptop or an unmerged branch, use
  that domain's skill instead." That single clause took its precision from 59%
  to 91%.
- *Under-triggering* (low recall) — the phrasings users actually type are
  missing. Take them verbatim from the `misses` array in the results file.

The `skill-creator` skill has tooling for this loop (`scripts/run_loop.py`,
description optimisation). Use it rather than building another one; this
repository's runner exists because it has to score twelve competing skills at
once, which that tool is not shaped for.

## Adding a skill

1. Write it against this contract.
2. Add at least 8 positive cases to `test/tier3/corpus/triggers.json` —
   `trigger-corpus-shape` requires it. With fewer, one miss moves recall by more
   than a floor's worth.
3. Add near-misses against whichever existing skill it is closest to. That is
   where the description actually gets tested.
4. Add it to agent §16 — `agent-skill-list-matches-shipped` fails in both
   directions, so an unlisted skill is as much a defect as a listed-but-missing
   one.
5. Add it to the plugin README.
6. Add a Tier 4 scenario, or list it as unverified in `docs/test-coverage.md`.
7. `npm run evals`, then `npm test`.
