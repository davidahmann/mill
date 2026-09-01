# Development guide

## Toolchain

- Node.js 24.20.0
- npm with the committed lockfile
- TypeScript 6

Install the pinned runtime through asdf, then use `npm ci`.

## Required commands

The repository enforces these native gates:

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

| Tier         | V1 posture                 | Examples                                              |
| ------------ | -------------------------- | ----------------------------------------------------- |
| Unit         | active                     | canonicalization, schema and transition rules         |
| Integration  | active from Wave 2         | SQLite, worktree, process and adapter boundaries      |
| End-to-end   | active from Wave 2         | packed CLI against disposable repositories            |
| Acceptance   | active                     | exact task acceptance IDs                             |
| Hardening    | active by risk             | hostile paths/config, cancellation, recovery          |
| Chaos        | targeted                   | crash boundaries and external-effect ambiguity        |
| Performance  | measured where relevant    | budgets and bounded output                            |
| Soak         | deferred                   | only after routine unattended operation exists        |
| Contract     | active                     | schemas, CLI JSON and exit codes                      |
| UAT          | active before public alpha | clean-machine founder journey                         |
| Scenario     | active                     | normal, exception, degradation, recovery, adversarial |
| Cross-system | Wave 3+                    | Codex, OCI and GitHub canaries                        |

Wave 3 keeps deterministic fake Codex, OCI, GitHub, and Git adapters in CI and
runs the packed CLI through the human-merge gate in a disposable repository. A
real Codex/OCI or GitHub canary remains attended maintainer evidence, never a CI
job with personal credentials. The realistic scenario set covers:

- normal approval, build, lifecycle commit, verification, and clean review;
- negative controls for failed, stale, inspect-only, or interrupted baseline
  qualification, changed command configuration, mutable command-control paths,
  bound-input/output overlap, dirty checkout, ignored-file contamination,
  hostile Git metadata, unauthorized paths, symlinks, replacement/graft history
  substitution, hidden index flags, authority drift, and attempted automatic
  Codex escalation approval;
- degradation from provider failure, missing OCI runtime/image, nonzero command,
  deadline, cancellation, and output exhaustion;
- recovery through crash-released writer leases, PID-reuse-safe orphan
  reconciliation, explicit OCI container cleanup, provisional workspace cleanup,
  exact-candidate repair revalidation, per-candidate review budgets, validated
  state backup/restore, quarantine of worktrees newer than a restored backup,
  external-effect readback, and terminal-only purge;
- provenance through exact base, context, candidate commit/tree, validation, and
  review identity checks;
- remote delivery through wrong-actor/fork/remote denial, stale approvals,
  expected-head pushes, effect-before-receipt recovery, unknown-effect blocking,
  cancellation before and during mutations, paginated exact-head inline and
  top-level review feedback, one aggregated repair, unauthorized merger and
  disallowed merge-shape rejection, merge-tree binding, and non-false-green
  post-merge checks;
- hostile filesystem coverage for Docker bind paths containing commas without
  weakening read-only/no-network verification;
- packaging through installation of the generated tarball and execution of its
  public CLI and schema exports.

The real-provider canaries use the maintainer's personal Codex and GitHub
accounts, a pre-pulled digest-pinned image, and an explicitly named disposable
repository. They may exercise only the wave's approved effects and must preserve
authoritative readback evidence. No test may provision a repository, mark a PR
ready, merge, deploy, or rerun remote checks.

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
