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

The maintainer-only `mill.yaml` delegates to those same scripts in the exact
offline OCI image. Read `docs/canaries/maintainer-verifier.md` for its bootstrap
status, separate dependency preparation, source/dependency immutability and
scratch limits. It is not a new supported downstream stack. Cleanup retains
generated output roots so they can be mounted scratch directories; Vitest's
native config loader and cache/report locations avoid writing into dependencies.

The optional command field `executableFixtureScratch: true` is permitted only
for OCI `test` and `package` commands. It provides fixed `/mill-fixtures`
scratch (256 MiB, exec/nosuid/nodev); set temporary fixture paths there
explicitly. Omitting the field preserves default noexec containment. It is an
authority change that requires requalification, not a workaround that a builder
may add to its own command controls. All source/dependency mounts remain
read-only and verification remains offline. The maintainer runner keeps its
writable npm cache separate and places temporary repositories outside
`/workspace`. The explicit fixture grant also enables Docker's init process to
reap orphaned test children without changing the default command process setup.

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
  external-effect readback, one readback-authorized retry, retry exhaustion,
  coordinator-level attendance enforcement, changing blocker identity, and purge
  only after a locally reviewed or terminal state;
- provenance through exact base, context, candidate commit/tree, validation, and
  review identity checks;
- remote delivery through wrong-actor/fork/remote denial, stale approvals,
  expected-head pushes, effect-before-receipt recovery, unknown-effect blocking,
  cancellation before and during mutations, paginated exact-head inline and
  top-level review feedback, one aggregated repair, stable PR identity and
  open-draft preflight before retry whether an ambiguous push is absent or
  landed, unauthorized merger and disallowed merge-shape rejection, merge-tree
  binding, and non-false-green post-merge checks;
- hostile filesystem coverage for Docker bind paths containing commas without
  weakening read-only/no-network verification;
- restore recovery through an immutable pre-commit quarantine manifest and a
  database swap as the final fallible commit point;
- packaging through installation of the generated tarball and execution of its
  public CLI and schema exports.

Wave 4A adds contract and negative-control coverage for source authority,
canonical proposal approval, semantic regeneration diffs, impact exceptions,
duplicate source and stable product IDs, outcome-to-impact binding, item-scoped
attestation claims, command-bound scenarios, instruction precedence and path-set
drift, immutable worker admission, launch-before-spawn, atomic process-exit and
result settlement, expired-authority readback, and malformed or conflicting
provider events. The repository dogfoods its approved product, scenario, impact,
and selected web-recipe contracts. Those tests prove contract behavior; they do
not replace exact-candidate review or CI because a candidate cannot certify
itself by changing its own oracle.

Wave 4B adds deterministic greenfield and adoption plan/apply fixtures, exact
recipe-asset digesting, ownership/detach checks, failed-staging cleanup,
lock/image-bound dependency preparation, installed-tree drift rejection,
cancellation cleanup, and founder coordinator recovery. Adversarial cases cover
target-lock contention, preserved preexisting state, symbolic-link target
ancestors, direct API attendance and trust bypasses, untrusted or incomplete npm
lock sources, frozen-lock drift, missing installer output, exact
PRD/source/outcome/acceptance authority, canonical-target aliasing, target
creation between approval and reservation, future approval times,
credential-like adoption files including `.npmrc`, PRDs inside builder-writable
source scope, cross-outcome scenarios, unprovable invariant modes, unsafe
generated-file ancestors, risk evidence understatement, older nonterminal runs
hidden by newer terminal records, and adoption with missing or modified oracle
bytes. Dependency cases validate the root lock consumed by npm even when another
lock is listed first and reject credential/query-bearing registry URLs.
Recipe-generated task evidence requires a named recipe-specific oracle; a
generic command reference blocks. The recipe itself is also exercised in the
exact pinned Playwright image with network disabled, a read-only root and source
tree, read-only dependencies, declared top-level tmpfs scratch, bounded Chromium
shared memory, and native
format/lint/type/unit/integration/browser/build/package commands. This is one
qualified recipe tuple, not evidence for arbitrary stacks.

Wave 5 adds three promotion layers. First, `millctl audit` performs a read-only
assessment of the clean exact repository candidate across product, code, UX,
Accessibility, security, dependency, architecture, operations, and release
categories. Second, the packed-package test runs five dependent reviewed
candidates from the prior accepted output and a separate seeded-fault branch;
the public-alpha assessor rejects gaps, discontinuity, stale support, invented
usage, skipped canaries, or concealed preservation failure. Third, the release
workflow compares two clean exact-tag builds, preserves one tarball, qualifies
that file, and publishes the same bytes through trusted npm OIDC only in a
separately authorized run.

The exact web recipe's required native commands include `test:browser`. That
lane is both delivered-surface verification and the recipe's current
Accessibility hook. It must remain part of `npm run check` for the supported
shape; adding a more specialized accessibility oracle requires a product and
scenario change, not an undocumented CI-only check.

The Wave 5 package canary uses deterministic fake provider/forge adapters to
prove lifecycle composition without credentials. Live Codex, GitHub, clean
builder, npm, and registry-readback evidence is collected only through the
attended genesis procedure in `docs/release.md`. Do not record the deterministic
fixture as a qualified real support tuple.

The npm dependency target is exactly `node_modules`; writable scratch paths must
be comma-free top-level repository directories. They cannot already exist in the
exact candidate because a mount would hide candidate content. The verifier also
rejects more than 256 top-level entries, top-level symbolic links, unsupported
filesystem entries, and top-level names containing commas. The workspace path
itself may contain commas because Mill creates and verifies an exact temporary
alias. These restrictions are current product limits, not silent portability
claims.

Task-packet version `1` is accepted only to resume or inspect work that began
before the continuity contract. Baseline qualification and every new run require
version `2`, including an approved impact manifest and explicit acceptance,
invariant, scenario, coverage, and evidence bindings. Do not rewrite an
in-flight version `1` task: its canonical bytes and digest remain unchanged.

The real-provider canaries use the maintainer's personal Codex and GitHub
accounts, a pre-pulled digest-pinned image, and an explicitly named disposable
repository. They may exercise only the wave's approved effects and must preserve
authoritative readback evidence. No test may provision a repository, mark a PR
ready, merge, deploy, or rerun remote checks.

The completed Wave 3 canary is recorded in
[`docs/canaries/wave-3-real-github.md`](canaries/wave-3-real-github.md). It also
shows why provider-authoritative usage must be budgeted: even a tiny task can
consume substantial context tokens while currency cost remains unavailable. The
Wave 4B recipe qualification is recorded in
[`docs/canaries/wave-4b-recipe.md`](canaries/wave-4b-recipe.md). The package
test must load the installed tarball's recipe and assert that packable aliases
render required dotfiles and untrusted product strings remain valid source
literals. Integration tests must also prove the same approved plan digest
appears in the plan result and generated `mill.lock`. The Wave 5 implementation
and remaining live evidence are recorded in
[`docs/canaries/wave-5-public-alpha.md`](canaries/wave-5-public-alpha.md).

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
