# Post-merge check contract canary

Status: documentation of the frozen maintainer-prepared implementation and the
reported blocked closure. Live recovery and acceptance closure are not claimed.

## Frozen inputs and motivating observation

The bounded documentation task is
[`mill-post-merge-check-contract-repair`](../../product/tasks/post-merge-check-contract-repair.yaml),
with its approved
[impact manifest](../../product/impacts/POST_MERGE_CHECK_CONTRACT_REPAIR.yaml).
The builder inspected clean starting commit
`bab6823e3aac818982d55913f3581d120105bfef`; all 17 context-file digests supplied
at admission matched. Runtime code, schemas, tests, workflow controls and
configuration were already frozen before this documentation output.

The task reports an observed blocked resulting-main closure caused by the
PR-only dependency-review boundary. The supplied task facts do not include the
incident's run ID, PR identity, merge SHA, timestamp, or provider check
receipts. This record therefore preserves the reported blocker and its
source-level explanation without inventing those identifiers or claiming fresh
GitHub readback. Exact incident receipts remain required in lifecycle evidence
before any recovery can be called successful.

The frozen [`mill.yaml`](../../mill.yaml), file digest
`sha256:3aa9562aacce6d8b08f744a91105136944dfb447ebff4fd1fa5fc1734db74ffe`,
requires `validate`, `dependency-review`, and `codeql` and omits
`postMergeRequiredChecks`. The [CI workflow](../../.github/workflows/ci.yml)
runs on pull requests and main pushes, but `dependency-review` has the job-level
condition `github.event_name == 'pull_request'`. The job is skipped on a main
push. `validate` and [CodeQL](../../.github/workflows/codeql.yml) run in both
phases. Requiring the PR-only job on resulting main cannot produce a passing
closure: an absent result remains pending; a completed skipped result produces
`POST_MERGE_CHECKS_FAILED`. This describes frozen behavior, not a new execution
of the incident.

## Prepared implementation

[`src/contracts/schemas.ts`](../../src/contracts/schemas.ts) accepts optional
`propose.postMergeRequiredChecks` only as a nonempty subset of
`propose.requiredChecks`.
[`src/runtime/delivery.ts`](../../src/runtime/delivery.ts) uses the full
`requiredChecks` list for exact PR-head observation. New plans include both
effective lists in the approval digest and persist both in the delivery record.
Omission uses the full PR list for resulting-main checks too. Changing a bound
policy invalidates continuity; this is not a late selector for whichever checks
happened to pass.

For a legacy record lacking both the second list and a previous legacy policy
binding, finalization permits one explicit local subset binding. All other
delivery bindings must match, including task, candidate commit/tree, actor,
repository, remote, base, original PR list, review policy, allowed mergers and
merge methods. The subset may contain only checks already required before merge.
Before persistence, authoritative GitHub readback must prove the exact PR merge
commit is on the default branch, the merger and method are allowed, and the
merged tree equals the reviewed candidate tree.

The binding stores `postMergeRequiredChecks` and
`legacyPostMergePolicyConfigDigest` and records
`delivery.legacy_post_merge_policy_bound`. Later readback must match that digest
and list. An unmerged PR cannot acquire the binding. Candidate/tree mismatch,
changed original PR requirements, or another delivery identity mismatch still
blocks. No prior approval is rewritten and no push, new PR, readiness decision,
merge, deployment, or release effect is authorized by this local binding.

In either phase, missing or pending required checks prevent completion. Skipped
or failed required checks fail that phase. A PR-only check outside an approved
resulting-main subset is not required in that phase; it still must pass at the
exact PR head. Finalization closes only after authoritative merge and passing
resulting-main evidence, preserving human merge authority and truthful recovery.

## Regression evidence and remaining canary

The frozen tests in
[`test/runtime-delivery.test.ts`](../../test/runtime-delivery.test.ts) include:

- “binds distinct resulting-main checks into a new delivery proposal”: persists
  all three PR names and the two-name main subset, observes all three PR checks
  passing, then closes on the two main checks using a fake GitHub adapter;
- “binds a subset-safe post-merge policy for a legacy merged delivery”: rejects
  finalization with `HUMAN_MERGE_PENDING` without persisting the new list, then
  closes after a fake human merge with passing `validate` and `codeql` and
  skipped main `dependency-review`.

These fixtures describe existing assertions. They are neither live provider
receipts nor a claim that the documentation builder ran the native gate. The
lifecycle must commit the documentation candidate, run authoritative native
validation and independent exact-candidate review, and separately obtain exact
draft-delivery plan approval.

The current frozen configuration remains unchanged. A separately approved policy
task may later opt into `[validate, codeql]` for resulting-main readback while
retaining all three PR requirements and branch-protection checks. This task does
not apply that policy or recover the blocked delivery. An attended recovery must
preserve the original run and PR, inspect uncertain effects before any retry,
and retain authoritative PR, merger, merge commit/tree, default-branch
containment, policy-binding event, and exact resulting-main check receipts. Only
those results can establish closure; a passing fixture or this document cannot
substitute for them.

`ACC-REVIEWED-DRAFT` and `ACC-TRUTHFUL-RECOVERY` remain lifecycle acceptance
items, not builder-certified successes. Native builds, tests, dependency audit,
and GitHub workflow operation remain independent of Mill. This record changes no
version, release evidence, or support claim.
