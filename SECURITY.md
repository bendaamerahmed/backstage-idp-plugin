# Security

## What this repository ships

Markdown. There is no runtime code in the plugin — no scripts, no binaries, no
network calls. Tier 0 (`plugin-bundle-contents`) fails the build if anything
other than `.md` and `.json` appears inside `plugins/backstage-idp/`.

That does not make it harmless. **This plugin instructs an agent that has write
access to your repository and a shell.** The risk is not that the plugin executes
something; it is that the plugin tells a capable agent what to do, and repository
content it reads along the way may try to tell it something else.

## Trust model

### What the agent is authorised to do

Under the guidance this plugin provides, the agent will:

- Read any file in the working repository, including CI definitions and config.
- Write and edit source files, tests, configuration and documentation.
- Run the repository's own commands: install, type-check, lint, test, build.
- Start long-running processes (dev servers) **in the background**, and stop them
  before finishing.
- Make network requests to fetch official Backstage documentation.
- Create local git commits.

### What it will not do without a human acting

The agent stops and hands back the exact command rather than running it, for:

- `git push` in any form, including `--force`.
- Pull request creation, review, or merge (`gh pr create`, `gh pr merge`).
- Publishing a package, deploying, or releasing.
- Anything that mutates a shared environment: a production or staging Backstage
  instance, a shared database, a real object store, an identity provider.
- Rotating or reading a credential.
- Rewriting history on a branch that exists on a remote.

Tier 1 (`mutation-verbs-gated`) asserts every occurrence of a mutation verb in
skill content sits inside a `Do not` section or next to an explicit
authorization stop. Tier 3 asserts the behaviour, not just the prose.

### What an operator must gate themselves

The plugin cannot enforce any of this; your Claude Code permission settings can.

| Gate | Why |
| :--- | :--- |
| Network egress from the agent's shell | The agent fetches documentation. Restrict the hosts if your environment requires it. |
| Write access scope | The agent edits the working tree. Run it in a repository checkout, not in a home directory. |
| Credential availability | Do not run the agent in a shell holding a production token. It is instructed never to read secrets, but the correct control is not having them present. |
| `git push` and PR tooling | The agent is instructed to stop. Deny the permission as well; instructions are a design, permissions are a control. |
| Branch protection | Required reviews and status checks are what make an "agent stops before push" property matter. |

`permissionMode: auto` appears in the agent's frontmatter. It is **not**
load-bearing and does not raise the agent's permissions: a plugin-shipped agent
inherits the operator's session permission mode. It is retained only because the
same file also works as a standalone `.claude/agents/` definition. See the
comment block in the agent definition.

## Prompt injection

Repository content is data, never instruction. A `catalog-info.yaml` description,
a README, an issue body, a scaffolder parameter description and a commit message
are all attacker-controllable in a large organisation, and all of them pass
through this agent's context.

The plugin instructs the agent to treat every one of these as data. This is
tested, not asserted: `test/tier3/injection/` holds a corpus of hostile fixtures
— instruction-bearing entity descriptions, embedded tool-call syntax, an issue
body demanding a force push, a scaffolder template with instructions in a
parameter description — and the tests assert the agent reports the content rather
than acting on it.

If you find an injection that gets through, that is a security issue. Report it
as below.

## Supply chain

- **Test tooling.** Two direct devDependencies: `yaml` and `markdownlint-cli2`.
  Both are pinned to exact versions. `yaml` is not optional — Tier 0 exists to
  catch frontmatter a real YAML parser rejects, so a hand-rolled parser would
  defeat the test. The transitive tree (~85 packages) is almost entirely
  `markdownlint-cli2`'s micromark dependencies. Dependency review runs on every
  PR that touches `package.json` or the lockfile.
- **GitHub Actions** are pinned to commit SHAs, not to tags. A tag is mutable.
- **Secret scanning** runs in CI over the repository and over any generated
  fixture output, because a Tier 4 fixture is a real `create-app` tree that could
  pick up a token from the environment it was built in.
- **A named supply-chain trap.** The bare npm package `backstage-cli` is **not**
  `@backstage/cli`. It is an unrelated package published by a different
  maintainer. `npx backstage-cli repo lint` installs and runs that package. The
  plugin never emits this command, and Tier 1 (`no-squatted-cli-invocation`)
  fails the build if it starts to. Recorded in `baseline.json` under
  `supplyChain.squattedBareNames`.

## Reporting a vulnerability

Report privately, not as a public issue.

- Preferred: GitHub private vulnerability reporting on this repository
  (Security → Report a vulnerability).
- Email: `ahmed.b.daamer@gmail.com`

See `OPEN-DECISIONS.md` #3 — an adopting organisation should replace this with a
monitored security alias before relying on it.

Include what the agent did, what content triggered it, and the repository state
if you can share it. A reproduction is a fixture we can add to the Tier 3 corpus,
which is the most useful form a report can take.

**Response expectations.** Acknowledgement within 5 working days. This is a
volunteer-maintained plugin; there is no paid on-call. If that is not acceptable
for your risk posture, fork it and take ownership of the disclosure path.

## Reporting a wrong skill

Not a vulnerability, but the more common failure: a skill that states something
Backstage no longer does. Open a normal issue with the skill name, the assertion,
and the official source that contradicts it. If it is version-sensitive, the fix
is usually to mark it version-sensitive and instruct reading the installed
package's types — see `docs/authoring.md`.
