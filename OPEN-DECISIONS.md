# Open decisions

Decisions this repository cannot make for itself. Each one is *implemented around* —
the code, tests and workflows that depend on it are complete and working — but the
value itself must come from a human, because a wrong guess would end up in a
published artifact.

`npm run check:release-gate` fails while any of these is unresolved, so none of them
can reach a tagged release by accident. They do **not** fail `npm test`, so ordinary
development is unblocked.

| # | Decision | Where the placeholder lives | Why it cannot be guessed |
| :-- | :--- | :--- | :--- |
| 1 | GitHub owner/repo slug | `OWNER-TBD/REPO-TBD` in `.github/workflows/*.yml`, `SECURITY.md`, `CONTRIBUTING.md`, `README.md` | Determines where issues, releases and the marketplace entry are published. No remote is configured on this repository. |
| 2 | Code owners | `@OWNER-TBD` in `CODEOWNERS` | Assigns review authority over agent-safety-critical files. Must be a real GitHub team. |
| 3 | Security disclosure contact | `SECURITY.md` currently names the repository author's public email | Enterprises usually want a monitored security alias, not a personal address. |
| 4 | Support matrix floor | `baseline.json` `supportMatrix.oldestSupportedLine` is set to `1.44` | See ADR-0007. This is the oldest line the skills' guidance was written against, not a tested claim. Someone must decide how far back the team will actually support. |

## What to do

1. Decide each value.
2. `node scripts/apply-open-decisions.mjs --owner <org> --repo <name> --codeowners <@team> --security-contact <email>` rewrites every occurrence and re-runs the gate.
3. Commit, then `npm run check:release-gate` must exit zero.

Decision 4 is a judgement call with no script: edit `baseline.json` and
`docs/test-coverage.md` together, and say in `CHANGELOG.md` that the floor moved.
