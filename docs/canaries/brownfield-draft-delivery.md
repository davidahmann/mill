# Brownfield draft-delivery authority

Status: frozen-policy record for `mill-brownfield-draft-delivery`; authoritative
candidate validation, independent review, and live draft delivery remain
pending. This document records the canary boundary and supplies no delivery
approval or claim of successful execution.

## Recorded policy

The builder inspected clean starting commit
`20a9f712cd5c63f883fcaf0d369fc05f84888a9d`. All seven context-file digests
supplied at admission matched. The policy was already present before this
documentation change in [mill.yaml](../../mill.yaml), whose file digest is
`sha256:3aa9562aacce6d8b08f744a91105136944dfb447ebff4fd1fa5fc1734db74ffe`.

The exact configured bounds are:

- Trust ceiling: `propose`; forge and host: GitHub, `github.com`.
- Repository: `davidahmann/mill`, node ID `R_kgDOUJyEZw`; local repository ID:
  `889e67bd-0768-4f73-9e18-286f2fb8b5f3`.
- Remote: `origin`; base branch: `main`; delivery branch prefix: `mill/`.
- Allowed actor and allowed merger: `davidahmann`.
- Required checks: `validate`, `dependency-review`, and `codeql`.
- Review policy: `local_only`, with no required GitHub reviewer logins.
  Independent local review of the exact candidate is still required.
- Allowed merge method classification: `linear_tree_preserving`.
- Delivery approval TTL: 900 seconds; polling timeout: 600 seconds.

These are configured identities and requirements, not live GitHub readback. The
attended shipper must verify the actual actor, repository, remote, branch,
candidate, and current policy when planning and applying delivery. The trust
ceiling permits an exact scoped proposal; it does not itself approve a push.

## Bounded Codex turn-diff ref handling

The documentation task
[`mill-brownfield-git-control-repair`](../../product/tasks/brownfield-git-control-repair.yaml)
records behavior already present in the frozen
[source](../../src/runtime/repository.ts) and
[regression oracle](../../test/runtime-boundaries.test.ts). Its starting commit
is `645cc8dc62f152843fc076cf67902411106d8195`; all eight supplied context-file
digests matched at builder inspection. This record does not alter that source,
oracle, or the delivery policy above.

`captureGitControlState` excludes refs beneath the exact
`refs/codex/turn-diffs/` prefix from its `otherRefs` digest. These Codex Desktop
turn-diff checkpoints are non-delivery diagnostic refs. The exclusion is not a
blanket exemption for `refs/codex/` or arbitrary Git metadata. The existing
exclusion of the current branch's ref entry remains separate: the snapshot
still records its symbolic branch identity, and exact candidate commit/tree
checks remain required.

Other branch refs, tags, remote-tracking refs, and refs outside that prefix
remain in the unrelated-ref digest. Common Git configuration, worktree
configuration, and `info/attributes` remain separately digested; changes to
those controls or the recorded branch identity still produce
`GIT_CONTROL_DRIFT`. Repository safety checks, remote and destination checks,
frozen authority, and exact candidate validation and review are unchanged.
Checkpoint tolerance grants no builder permission to mutate Git controls and
does not authorize accepting a changed candidate or bypassing reconciliation.

The pre-existing regression named “ignores Codex turn-diff checkpoints but
detects ordinary ref drift” creates
`refs/codex/turn-diffs/checkpoints/example` and expects the snapshot assertion
to succeed, then creates `refs/heads/unrelated-control-drift` and expects
`GIT_CONTROL_DRIFT`. The adjacent control-plane regression expects local Git
configuration mutation to fail. These are descriptions of frozen assertions,
not a claim that this documentation task has executed them or proved live
recovery. Authoritative validation and independent exact-candidate review
remain lifecycle responsibilities; both acceptance items below remain pending.

## Acceptance and human authority

The frozen [task](../../product/tasks/brownfield-draft-delivery.yaml) binds
[impact](../../product/impacts/BROWNFIELD_DRAFT_DELIVERY.yaml)
`mill-brownfield-draft-delivery` to `OUT-REVIEWED-DRAFT` and
`SCN-DRAFT-DELIVERY` in the [scenario set](../../quality/scenarios.yaml). The
impact records approval by `davidahmann` at `2026-09-04T19:28:47Z`, with
proposal digest
`sha256:71d8c0667ecfa6169ab473ce0afd830ea2daaa6167e9a541731ab7b446b6a0ae`.

Both acceptance items retain `test:coverage` command evidence and coverage of
new behavior and preservation:

- `ACC-REVIEWED-DRAFT`: the unchanged exact candidate reaches one independently
  reviewed draft pull request.
- `ACC-TRUTHFUL-RECOVERY`: cancellation, ambiguity, and resume never duplicate
  work or invent success.

The scenario binds `INV-HUMAN-AUTHORITY`, `INV-EXACT-EVIDENCE`, and
`INV-WORKER-LEAST-AUTHORITY`. It requires unchanged-candidate delivery to the
configured repository and base, exactly one draft PR, provider reconciliation on
recovery, and no merge authority for builder, reviewer, or coordinator. Changed
or unverified candidates, ready-for-review creation, merge, and blind retry of
an unknown remote effect are forbidden.

The task separately records human attestation
`ATT-BROWNFIELD-DRAFT-HUMAN-AUTHORITY-20260904`, approved by `davidahmann` at
`2026-09-04T19:28:47Z` and expiring at `2026-09-05T19:28:47Z`. Its sole claim
binds `INV-HUMAN-AUTHORITY` to
`sha256:5f275bad059e1ade8ff0f09df259a76b61ebcfedea97baf1a6fb4b02f369a1d0`. The
lifecycle must check its validity. Neither this attestation nor the impact
approval replaces the separate, unexpired exact delivery-plan approval. Their
timestamps do not extend the 900-second delivery approval window.

## Attended canary and recovery

After the lifecycle commits, verifies, and independently reviews the exact
candidate, the attended operator uses `pr plan` for this task and run. The
returned plan binds the candidate commit/tree, destination, branch, actor,
policy, expiry, and intended effects. Only approval of that exact plan permits
`pr open --approve sha256:<delivery-plan> --attended`. The shipper may push only
the unchanged verified candidate and create its draft PR. Any candidate or
authority drift invalidates earlier evidence and approval.

Observe the same PR and required checks against its exact head with
`pr observe`. Record the run identity, candidate commit/tree, validation and
review evidence, exact plan digest and approval receipt, PR number/node
identity, draft state, branch/base/head, and provider check results in lifecycle
evidence. Do not insert credentials, raw worker output, or command logs into the
candidate. A deterministic test result cannot stand in for live delivery
readback.

On interruption, inspect `status --run <run-id>` before advancing the existing
run. `cancel` records intent; only the foreground controller may signal its own
child. Cancellation during a remote mutation does not prove that nothing
happened. A possibly started push or PR operation remains `effect_unknown` until
`pr reconcile` classifies it through authoritative readback. Do not start
another run or recreate the PR to bypass that uncertainty.

`resume --attended` must respect existing ownership, the original budget, and
the bounded repair policy. Reconciliation itself performs no mutation. Proven
absence may permit the bounded retry only under valid authority; unresolved
state blocks, and expired authority permits readback but no new effect. Preserve
the same delivery identity and PR across recovery. A repaired candidate needs
fresh validation, review, and exact delivery approval.

Human readiness and merge remain separate decisions. The configured merger and
merge-method policy do not authorize Mill to merge. Finalization requires
provider-authoritative merge and resulting-main evidence, including the exact
tree and required checks; a draft PR or a passing local gate is not closure.

## Builder evidence and limits

This builder changes only this canary. Policy, product contract, task, impact,
scenario, source, tests, and command definitions remain frozen. No commit,
credential access, push, PR operation, merge, deployment, or release was
performed by the builder.

Red-first testing is not meaningful for this documentation-only record against
pre-existing oracles. Both acceptance items remain pending authoritative
lifecycle execution of `test:coverage`, required native validation, and the
separate exact-candidate review and delivery gates. This record does not supply
a baseline digest, passing audit, live recovery result, or task closure. Missing
or failed required evidence blocks promotion.

The canary adds no runtime dependency, supported stack, or adoption claim.
Downstream repositories retain their native build and test commands and remain
operable without Mill.
