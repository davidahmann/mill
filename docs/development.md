# Development guide

## Toolchain

- Node.js 24.20.0
- npm with the committed lockfile
- TypeScript 6

Install the pinned runtime through asdf, then use `npm ci`.

## Required commands

The implementation establishes these native gates in Wave 1:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run test:coverage`
- `npm run test:package`
- `npm run check`

Do not replace native commands with a Mill- or Factory-only runner. CI invokes
the same definitions.

## Testing matrix

Only applicable tiers are active. A skipped required lane blocks promotion.

| Tier | V1 posture | Examples |
|---|---|---|
| Unit | active | canonicalization, schema and transition rules |
| Integration | active from Wave 2 | SQLite, worktree, process and adapter boundaries |
| End-to-end | active from Wave 2 | packed CLI against disposable repositories |
| Acceptance | active | exact task acceptance IDs |
| Hardening | active by risk | hostile paths/config, cancellation, recovery |
| Chaos | targeted | crash boundaries and external-effect ambiguity |
| Performance | measured where relevant | budgets and bounded output |
| Soak | deferred | only after routine unattended operation exists |
| Contract | active | schemas, CLI JSON and exit codes |
| UAT | active before public alpha | clean-machine founder journey |
| Scenario | active | normal, exception, degradation, recovery, adversarial |
| Cross-system | Wave 3+ | Codex, OCI and GitHub canaries |

## Architecture questions

Before medium/high-risk code, answer:

1. What exact source owns the behavior or state?
2. What identity/digest makes it fresh and unambiguous?
3. Who may mutate it, under what explicit grant?
4. How does cancellation/crash/retry behave?
5. What prevents a model, repo file, or available credential from widening
   authority?
6. Which delivered surface and realistic scenario prove the outcome?
7. How is the downstream repository still operable without Mill?

## Review convergence

Run one architecture/threat pass before medium/high-risk implementation and one
complete exact-candidate review after validation. Batch all actionable findings
into one systemic repair. Recurring same-subsystem P1 findings return to design.

