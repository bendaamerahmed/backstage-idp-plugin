# Open decisions

Decisions this repository cannot make for itself. Each is *implemented around* —
the code, tests and workflows that depend on it are complete and working — but
the value itself must come from a human, because a wrong guess would end up in a
published artifact.

`npm run check:release-gate` fails while any **blocking** decision is
unresolved, so none can reach a tagged release by accident. It does not fail
`npm test`, so ordinary development is never blocked on one.

## Resolved

| # | Decision | Value | Resolved |
| :-- | :--- | :--- | :--- |
| 1 | GitHub owner/repo slug | `bendaamerahmed/backstage-idp-plugin` | 2026-08-07 |
| 2 | Code owners | `@bendaamerahmed` | 2026-08-07 |
| 3 | Security disclosure contact | `ahmed.b.daamer@gmail.com` | 2026-08-07 |

**On #2 and #3.** Both are correct for a repository owned by an individual and
both should change the moment it is not. `CODEOWNERS` pointing at one person
means review authority over the agent's safety-critical files has no second
pair of eyes; a personal address as the security contact means disclosure
depends on one inbox. If this moves to an organisation, re-run:

```bash
node scripts/apply-open-decisions.mjs --codeowners <@org/team> --security-contact <alias@org>
```

`SECURITY.md` already states the response expectation honestly — acknowledgement
within five working days, no paid on-call — so an adopter can judge whether that
is acceptable for their risk posture.

## Still open

| # | Decision | Where it lives | Why it cannot be guessed |
| :-- | :--- | :--- | :--- |
| 4 | Support matrix floor | `baseline.json` → `supportMatrix.oldestSupportedLine`, currently `1.44` | See ADR-0007. `1.44` is the oldest release line the skills' guidance was *written* against. It is not a tested claim — only the current line has a fixture. Someone has to decide how far back this will actually be supported, which is a maintenance commitment rather than a fact. |

Decision 4 does **not** block a release. It is a claim in the README's support
matrix that is currently weaker than it reads, and `docs/test-coverage.md` says
so. Narrowing it to the tested line is the conservative option; keeping `1.44`
means committing to build a fixture for an older line.

There is no script for it — edit `baseline.json` and `docs/test-coverage.md`
together, and note the change in `CHANGELOG.md`.

## Not a decision, but needs a human

- **The repository is private.** A marketplace entry can only be installed by
  name from a repository the installer can reach. It has to be public before
  anyone else can adopt it.
- **Branch protection** — the expectations are documented in `CONTRIBUTING.md`
  and cannot be applied by this repository. On a private repository, required
  status checks and required reviews need GitHub Pro or an organisation.
- **Actions minutes.** The nightly integration job builds real `create-app`
  trees. On a private repository that consumes billed minutes; the schedules in
  `.github/workflows/integration.yml` and `currency.yml` are worth reviewing
  before enabling them.
