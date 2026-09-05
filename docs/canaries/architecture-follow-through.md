# Architecture follow-through evidence

Owner: David Ahmann. Approved scope: `product/architecture-follow-through.md`.
Mill source base: `75a9d65e22414ab274d0a476c456673c1e1c5b9d`; candidate version
0.2.0. This record distinguishes local implementation evidence from final PR,
release and npm qualification. The latter require exact final candidate
receipts.

## Acceptance coverage

| Outcome | Implemented boundary                                                                          | Evidence surface                                                                                    |
| ------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| AF-01   | Sanitized public subjects, noreply author configuration, compact status                       | Public metadata and CLI tests; prior PR titles corrected without history rewriting                  |
| AF-02   | Complete merge-base diff identity including preparation commits                               | Lifecycle, Codex, delivery and packed-package tests                                                 |
| AF-03   | One native nonzero-exit repair retaining failed evidence and deadline                         | Lifecycle repair trajectory and corrupt/stale/infrastructure denial cases                           |
| AF-04   | Independently pinned v0.1.5 verifier and exact-run publication checks                         | Release helper adversarial fixtures; live release workflow remains a separate gate                  |
| AF-05   | Structural audit labels                                                                       | Schema and repository audit tests; no implied executed accessibility/security claim                 |
| AF-06   | App/workflow/event/head provenance and PR/main check split                                    | Fake GitHub job/run forgery cases and read-only live PR #21 checks                                  |
| AF-07   | Deterministic task compiler, dependencies, explicit supersession, finalized closure proposals | Five request-kind fixtures, isolated apply/backup/readback, actual compiled OSS task                |
| AF-08   | Exact attended readiness/merge approval and separate uncertain-effect recovery                | Success, stale approval/base, foreign event, lost readiness/merge receipts and default-denial cases |
| AF-09   | Bounded derived context and native-preserving experimental adoption                           | Static extractor/native-adoption fixtures and JSON Server experiment below                          |
| AF-10   | Context byte ceiling, measured/partial/unavailable usage and shared policy                    | Budget/usage fixtures and real-provider observations; no invented currency cost                     |

The unchanged baseline passed 205 tests and the complete native/package gate.
The expanded local suite subsequently passed 239 tests; the coverage gate
initially rejected 79.79% branches, then passed above 80% after actual adapter
denial cases were added. Version expectations, source-digest freshness and the
packed fake-reviewer's scope handling each exposed failures and were repaired.
Those intermediate results are not final-commit qualification. Keep the coverage
threshold and full host/OCI/package/review/CI gates unchanged.

## Real JSON Server experiment

Upstream: `https://github.com/typicode/json-server`, MIT, commit
`89a34a44b7a6a5311dc84f3b8a1b8b45c0905aea`, tree
`d305d02f13ab51efaa9af089c65881f276a5e97f`.

The original package and pnpm lock remain unchanged. An explicit local npm lock
overlay and build-only adoption configuration were added for this experiment.
Native adoption added only Mill controls in a disposable worktree. It did not
grant forge authority or submit anything upstream. Dependency preparation used
the exact npm lock through attended HTTPS with lifecycle scripts disabled.

The canary froze product/scenario/impact authority and three independent
expected-value cases before builder execution. Task compilation applied exactly
two new authority files in a separate worktree; committed-file reconciliation
confirmed `cfb7a2b1e31cee82ebdab8eff0fdfc7bd418e391` as its committed authority
base. Baseline approval:
`sha256:1194779288a124298952fc64551b5ae6ebfdabdaded6a82ddbe98e863ab088cb`.

Run: `7e247d3d-d5cf-4362-a48d-cd3a90d0f25f`. The builder changed only
`src/paginate.ts` and added `src/paginate.boundary.test.ts`. Candidate:
`07d7dee9c03b18d4f736effccd873ed0d049837f`, tree
`1522bdefdd1ee99fc99a716f709bbf363d064ff5`. The implementation clamps the
floored positive page size to at least one. Existing tests, scripts, locks and
authority remained unchanged.

Both original and candidate passed native `test`, `lint` and `typecheck` with
network disabled in image
`node@sha256:78b162211207872503ea9245188122b815150b9b4380e47a7c4a447332c01660`.
The frozen three-case assertion failed on the unchanged base and passed on the
candidate in separate read-only offline containers. The new test adds sub-unit
fractions, minimum positive numbers, empty inputs, clamping and preserved
nonfinite/integer behavior. Upstream's root test selector excludes its nested
adapter test; do not claim that omitted test was executed.

Builder usage was provider-measured: 178,727 input and 1,682 output tokens. The
successful structured review reported 166,402 input and 1,301 output tokens.
Currency cost is unavailable. The first review attempt failed with
`invalid_json_schema`: optional legacy scope was incompatible with strict
provider output. The provider schema now requires scope independently of
backward-readable persisted records, with a regression for this distinction. The
second attempt returned no findings but reported target test execution. That
result is retained and is not counted as static-only review. The reviewer
instruction was made explicit. A separate static-only local review inspected the
same exact base/candidate/tree, both changed paths and frozen expectations,
returned no material findings and reported no target-code execution or edits.
Its command trace contains static reads and Git identity/diff queries only.

## Promotion and operating limits

The first complete static review examined candidate
`2d9d3a9d10a3ebe94f9a4eedf053a4283995badd`, including its authority preparation
commit. That candidate passed the host gate, offline OCI gate and nine clean
structural audits but was **not promoted**: the review found three P1 and two P2
issues. The repair addresses all five together: authoritative provider-base
comparison, enforced producer-bound protection, effect-time authority expiry,
inspect-only apply denial, and journaled interrupted-purge recovery. The
targeted regressions retain those failure paths. Earlier passing gates do not
certify these subsequent repaired bytes.

The repair's native suite passed 243 tests, 80.60% branch coverage and the
installed-tarball draft-PR lifecycle. This is local check evidence, not the
independent review or external release receipt. The boundary/recovery matrix is
in `architecture/ARCHITECTURE.md`; required checks and review remain unchanged.

The second static review of `abd1e0e` found one recurring P1 in merge recovery
and three P2 issues (missing superseded task, partially deleted authority
worktree, resumed usage). Promotion stopped. The owner's follow-up approval
authorized the focused redesign in `architecture/effect-recovery.md`, not a
waiver. Red-first regressions reproduced all four failure groups. The first
targeted repair exposed two integration defects (canonical worktree marker
comparison and generic failure settlement after confirmed merge); both were
corrected. The subsequent targeted gate passed 53 tests across delivery, state,
task compilation and public metadata. Full exact-candidate checks and the next
independent review remain required; this paragraph does not pre-certify them.

The redesigned working candidate then passed the complete native gate: 247
tests, 80.90% branch coverage and installed-tarball delivery qualification. The
exact committed tree still requires fresh host/OCI checks, audit and static
review.

Candidate `83d34b1` subsequently passed exact host/OCI checks and the structural
audit, but its independent full-diff review still blocked promotion: a P1 made
`call_started` push/PR recovery unreachable, and a P2 approved same-ID task
collisions before apply failed. The owner's "fix systemically" approval
authorized the next design correction, not release. Red-first tests reproduced
both findings. The first repaired targeted run passed 46 tests, including hard
interruptions before/after provider calls, atomic settlement rollback,
cancellation, collision rejection and preserved failed-plan abandonment. Later
CLI and malformed-journal cases still require the complete final-candidate gate.
These receipts are local fixtures, not live GitHub recovery evidence.

The systemic repair then passed the full native gate: 258 tests in 32 files,
81.26% branch coverage, and installed-tarball draft-PR lifecycle qualification.
The exact committed host/OCI checks, audit and independent review still gate
promotion; this working-tree result is not their substitute.

The `0ceb3f0` exact host gate, offline OCI gate and structural audit passed. Its
independent complete 73-file review returned two P2 findings and no P0/P1:
pre-effect review-scope refresh was unreachable, and authority apply admitted
terminal runs with nested pending effects. A separate non-destructive
ignored-file probe also showed normal authority purge accepting unrelated
content. None of these findings was treated as a release exception.

The next coherent correction centralizes authority admission, adds attended
pre-effect scope refresh with unchanged candidate/budgets and retained receipts,
and checks every authority-worktree entry before normal as well as resumed
purge. Four red fixture failures reproduced the three failure groups. The
completed native gate passed 259 tests, 81.32% branch coverage and
packed-package qualification. The unchanged external ignored-file probe now
rejects cleanup with `AUTHORITY_PLAN_IDENTITY_MISMATCH` and preserves its
witness. Exact-commit verification and the next independent complete review
still gate promotion.

Candidate `c41ebd3` passed exact host/OCI checks and the structural audit. Its
independent full-diff review found one P2: producer binding equated an Actions
job ID with a check-run ID instead of following the job's `check_run_url`. Live
readback of main's three checks showed equal IDs, so this is not claimed as an
observed production outage. The adapter now verifies the requested job ID and
the explicit check-run relationship independently, preserving run, repository,
head, app, workflow and event checks. A distinct-ID positive fixture and
wrong-job negative fixture cover this contract. GitHub documents the
relationship in its
[workflow jobs API](https://docs.github.com/en/rest/actions/workflow-jobs).

A non-executing check of published shell examples separately found two invalid
`resume --attended` examples. They now match the existing foreground CLI, and a
native test checks long-option spelling across current README/AGENTS/WORKFLOW
and top-level docs examples. It is a syntax-consistency check, not execution or
behavioral certification of every example. Both new regressions failed before
the correction; final gates and review remain mandatory.

Native tests and fixed cases are deterministic evidence; a single live model run
is not an estimate of productivity, reliability or customer acceptance. This
canary does not qualify a new public support tuple. Read-only Codex sandboxing
is not hostile-host containment or a technical prohibition on all code
execution; reviewer policy and observed command behavior matter.

Final promotion still requires the exact committed Mill candidate's complete
native host/OCI/package gates, static-only full-diff local review, structural
audit, PR and resulting-main checks. Release separately requires two independent
clean builds, the pinned trusted verifier, one preserved artifact, protected
OIDC and npm/GitHub readback. No pending or unavailable gate counts as success.
Recover uncertain effects before retry; rollback uses a new corrective version,
not rewritten history or moved tags.

## Publication preflight follow-through

PR #22 merged as `dbed247f19e115866dc828f55b9198a2c4789e21`. Its tree
`2e25bc8453949b023f999b8434b0552281d26c6a` equals reviewed candidate `8ef6791`.
The candidate and fresh resulting-main native gates passed 260 tests with 81.31%
branch coverage and the packed-package lifecycle. Exact host/OCI, structural
audit, full-diff static review, PR and resulting-main checks passed. The sole
final local P2 was explicitly deferred by the owner: run purge from a surviving
original checkout, not a worktree scheduled for deletion. This did not change
downstream runtime review policy.

A new local-only v0.2.0 canary accepted five dependent commits, ending at
`fb0f61271a51c8ec0265f3bac0c75b6f0550394e`. Every step executed the required
offline native gate, separate frozen browser checks for its new and all prior
facts, and fresh static review. Step 3 initially failed exact owner-text
acceptance; an independent P1 finding admitted one bounded repair without scope,
oracle, deadline or task changes. The repaired candidate passed every gate. The
separate seeded health fault `6717753` failed its frozen oracle, remained
outside accepted history, and the unchanged accepted base passed recovery.
Provider measurements total 2,421,992 input and 12,479 output tokens, including
repair; currency cost is unavailable. External state backups and candidate
branches are retained. This is qualification evidence, not a productivity
estimate.

The annotated `v0.2.0` tag remains immutable. Candidate run
[33943691393](https://github.com/davidahmann/mill/actions/runs/33943691393)
passed both clean builds, preserved-artifact qualification and the pinned v0.1.5
verifier. Publication was nevertheless held before any npm or GitHub Release
effect: source inspection found no explicit image preparation in the fresh
publish job, while its registry canary requires `--pull never`. Candidate jobs
cannot supply another runner's image cache.

The bounded `0.2.1` repair adds explicit pinned-image preparation before
publication and a native guard for every full-canary job, including future added
jobs. Missing, duplicate, late, conditional, failure-ignored or noncanonical
preparation rejects the workflow. New negative guard cases failed before the
repair; the targeted guard and independent-artifact tests then passed. Earlier
lint and version-alignment failures are retained and corrected without changing
their acceptance tests. Exact candidate checks/review, a fresh matched canary,
PR/main readback and the complete immutable release chain still gate promotion.
