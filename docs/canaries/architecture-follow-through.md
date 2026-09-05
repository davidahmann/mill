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
