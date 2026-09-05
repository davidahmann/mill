# Architecture follow-through

Status: approved by David Ahmann in the attended conversation on 2026-09-04.

Approval: implement all recommendations from the architecture review, test,
validate, ship to green CI, then release and publish to npm. Source base:
`75a9d65e22414ab274d0a476c456673c1e1c5b9d`. The owner is David Ahmann. The
delivery surface is the local CLI and the owner's authenticated chat session.

## Accepted outcomes

1. Public author identity uses GitHub noreply addresses; PR titles and routine
   output exclude private author details and commit trailers.
2. Review evidence binds the full base-to-candidate diff and changed paths,
   including maintainer preparation commits, before delivery.
3. Committed validation failures have one bounded repair generation preserving
   the original scope, failed evidence, deadline, and independent review.
4. Routine releases use a separately pinned trusted verifier policy. Candidate
   tests remain additional evidence. Artifact preservation and OIDC remain.
5. Audit results distinguish structural policy checks from executed evidence.
6. Required CI results bind their producer and event scope, with separate PR and
   resulting-main requirements.
7. Approved PRDs, follow-up plans, bugs and findings share a change-plan/task
   compiler. Dependencies, cycle detection, scope, impact, current base,
   approval, supersession, and evidence-based closure are explicit.
8. A human can approve a displayed merge plan in chat. The approval binds the
   repository, PR, head, base, policy, method, identity, expiry and intended
   actions. The trusted operator boundary journals intent and reconciles
   uncertain effects. Builder/reviewer capabilities remain unchanged.
9. Brownfield discovery feeds bounded task/review context. Native adoption
   qualification uses explicit repository commands and preserves existing source
   and oracles. A real OSS change demonstrates the bounded path.
10. Compact status, context budgets, usage and intervention reporting make
    workflow cost visible. Shared policy modules reduce coordinator duplication.

## Delivery and authority

This approved maintainer increment follows WORKFLOW.md's native development path
in one isolated worktree. The task and impact are frozen before source
implementation. It may update runtime, schemas, tests, command controls,
documentation and release policy together. This explicitly authorizes the
control changes needed to implement the requested behavior; the historical
bootstrap exception is not reused. Original baseline results are retained; new
or changed tests do not independently certify themselves. A fresh read-only
review covers the complete PR diff, including authority and test changes.

The user's approval authorizes the attended maintainer to prepare and commit
this authority packet, implement its bounded changes, push/open the reviewed
candidate, merge once required CI is green, and perform separately tracked
release/tag/npm actions after release qualification. Human approval may arrive
through chat; GitHub web UI is not a mandatory authorization interface.
Readiness, merge, tag and publication remain distinct journaled effects.

No daemon, parallel writers, graph service, deployment, arbitrary-stack support,
branch-protection bypass, secret sharing, or released-history rewriting is
authorized. Repository-specific integrations remain experimental until their
native tests and target evidence qualify them. Never fabricate a chat receipt or
describe an unsigned local declaration as authenticated external approval.

## Verification and operating ownership

### Publication preflight repair

The existing approved AF-04/release scope includes the publication preflight
repair discovered after PR #22 merged as
`dbed247f19e115866dc828f55b9198a2c4789e21`. The publish job starts on a fresh
runner but did not explicitly prepare the pinned image required by its registry
canary, which forbids implicit pulls. Publication of `0.2.0` is held; its pushed
annotated tag is retained, never moved. This is a bounded maintainer repair
under the existing attended owner approval, not a new approval receipt.

The repair may add explicit digest-pinned image preparation before publication,
require preparation in every release job that executes the full canary, add
red-first workflow-policy regressions, and prepare the unused `0.2.1` version
with truthful documentation. Runtime behavior, recipe/oracle bytes, coverage
thresholds, protection settings and publication permissions remain unchanged.
The exact repaired source needs native host/OCI checks, audit and fresh complete
read-only review, PR/main readback and a fresh matched release canary before
tagging. Two independent builds, the v0.1.5 trust root, one preserved tarball,
protected OIDC publication and registry/GitHub readback still gate release.

For this maintainer increment, the owner's subsequent "ignore standalone p2s"
instruction makes isolated P2 review findings non-blocking: record the finding
and residual risk without another repair cycle. It does not waive P0/P1 stops,
required checks, exact review identity, external-effect boundaries or release
provenance. This is a maintainer disposition, not a change to downstream Mill
review policy or a claim of Factory-profile certification. Already completed
corrections remain in this candidate.

The owner's subsequent explicit "fix systemically" request authorizes the
journal-driven atomic reconciliation and attended failed-plan abandonment
amendment in `architecture/effect-recovery.md` after review of `83d34b1`.
Repeated-P1 stops and all independent promotion gates remain in force.

The attended follow-up approval on 2026-09-05 authorizes the focused recovery
redesign in `architecture/effect-recovery.md` after the second review's
recurring P1 stop. Its state boundary and four regression groups are part of
this same approved increment; prior failed evidence and all promotion gates
remain.

Run the unchanged baseline and full native `npm run check`, targeted positive
and negative boundary tests, packed CLI tests, complete committed-diff local
Codex review, offline OCI verification, CI, and exact merge readback. Qualify
the preserved tarball using the independent release policy before OIDC publish
and npm/GitHub readback. Record actual results and remaining limits in
`docs/canaries/architecture-follow-through.md` before claiming completion.

The baseline is the pre-change suite and previous workflow evidence. Success
means each numbered outcome is exercised through its public interface with
denial/recovery cases; no numeric productivity improvement is claimed without
measurement. The primary owner operates the CLI, approval and release paths; the
public docs must permit another authorized maintainer to reproduce them. Retain
failed evidence and stop on ambiguous effects, recurring major review findings,
unqualified environments or missing target verification. Rollback uses a new
corrective commit/version and preserved artifacts, never moved tags.
