# Defaulted post-merge policy migration

Status: documentation of frozen maintainer-prepared behavior. Live migration,
acceptance closure, and release qualification are not claimed.

## Scope and frozen inputs

The approved task is
[`mill-post-merge-default-policy-migration`](../../product/tasks/post-merge-default-policy-migration.yaml),
with its frozen
[impact manifest](../../product/impacts/POST_MERGE_DEFAULT_POLICY_MIGRATION.yaml).
Its named historical delivery is `01801a1b-58f9-480f-8cee-54ea2bbeabb2`. The
documentation builder started from clean commit
`466f7a56edd856e9e3b5095ea4940e0ccebedc40` and verified all 24 supplied context
file digests. This is the documentation task's base, not an assertion of the
historical delivery's reviewed candidate identity.

The prepared [mill.yaml](../../mill.yaml), digest
`sha256:7847d2e8086a5a510f45f8fe71ffd048387b35818cc123179f22387019917530`, keeps
`[validate, dependency-review, codeql]` for exact PR-head evidence and
configures `[validate, codeql]` for resulting-main readback. The frozen CI
workflow limits `dependency-review` to pull requests; `validate` and `codeql`
also run on pushes to `main`. The [earlier canary](post-merge-check-contract.md)
preserves the previous full-list policy and closure blocker. Its historical
configuration statements do not describe this prepared configuration.

## Eligibility and persistence

The prepared [delivery implementation](../../src/runtime/delivery.ts) extends
the earlier path for records missing the post-merge list. For a historical
record that already contains the full list, all these conditions must hold:

1. `postMergePolicySource` and `legacyPostMergePolicyConfigDigest` are absent.
2. The recorded `postMergeRequiredChecks` exactly equals the original
   `requiredChecks`, including order.
3. The current configuration explicitly selects a nonempty subset of the
   original PR requirements; the original PR list remains unchanged.
4. `mill.yaml` read from the exact recorded `candidateCommit` is valid YAML,
   passes the configuration schema, and omits `propose.postMergeRequiredChecks`.
   Current checkout bytes cannot substitute for this proof. An explicitly
   configured full list is ineligible.
5. Task, run, candidate commit/tree, repository/node ID, remote/clone URL, base,
   actor, original PR checks, review policy, allowed mergers and merge methods
   retain their delivery bindings.
6. Before persistence, authoritative readback proves the recorded PR identity,
   exact merge commit and default-branch containment, allowed human merger and
   merge method, and equality of merged tree and reviewed candidate tree.

Unavailable candidate configuration fails with
`LEGACY_POST_MERGE_POLICY_SOURCE_UNAVAILABLE`; invalid YAML or configuration
fails with `LEGACY_POST_MERGE_POLICY_SOURCE_INVALID`. Other continuity drift
fails with `DELIVERY_AUTHORITY_DRIFT`. An unmerged PR cannot acquire the
binding; a changed merge tree requires fresh exact-tree validation.

Finalization persists `postMergeRequiredChecks`,
`postMergePolicySource: legacy_migrated`, and
`legacyPostMergePolicyConfigDigest`, recording
`delivery.legacy_post_merge_policy_bound`. Subsequent finalization must retain
the bound configuration identity; the compatibility path cannot repeatedly
select a different policy. This local binding does not rewrite the original
proposal approval or authorize another push or PR.

Every new delivery persists both effective lists and identifies its source as
`configured` or `implicit_default`. Even a newly defaulted full list is
ineligible for this provenance-free historical extension. Omitting the optional
configuration still defaults both phases to the full PR requirements.

The binding alone does not close a delivery. Missing or pending required main
checks leave completion pending; skipped or failed required checks produce
`POST_MERGE_CHECKS_FAILED`. Only authoritative passing resulting-main evidence
permits `post_merge_verified` and closure. Main's skipped `dependency-review` is
outside the configured main subset, while all three checks remain required at
the exact PR head.

## Evidence and recovery boundary

Frozen [delivery tests](../../test/runtime-delivery.test.ts) contain a
fake-adapter fixture that seeds a historical full-list record by removing its
provenance, then exercises migration after merge. Another fixture rejects a
changed explicitly configured full policy. The earlier missing-list fixture
checks that no binding is persisted before human merge. These are source-level
assertions, not provider receipts or proof that this builder ran them; the
fixture named “exactly once” does not itself establish a second-finalization
readback result.

The task supplies the historical delivery identifier but no PR number, reviewed
commit/tree, merge SHA, resulting-main check receipts, or persisted migration
event receipt. None is inferred here. Attended recovery must retain the original
run and PR, reconcile uncertain effects before any retry, and collect the exact
candidate configuration proof, all identity and merge readbacks, the persisted
binding/event, and required main check results. A later readback must
demonstrate continued use of the same binding. Missing evidence blocks a
recovery claim; do not edit stored provenance or replay push/open to manufacture
eligibility.

`ACC-REVIEWED-DRAFT` and `ACC-TRUTHFUL-RECOVERY` remain lifecycle acceptance
items. The lifecycle must commit this candidate, run the declared native gates,
obtain independent exact-candidate review, and follow the separately approved
draft-delivery plan and human readiness/merge boundary. Documentation and fake
fixtures cannot certify those outcomes.

## Package preparation

The frozen package, lockfile, and source version identify `0.1.6`. This task
records preparation only. The qualified `0.1.5` release remains the trust root;
the [release runbook](../release.md) still requires exact candidate/main/tag
identity, independent clean builds, one preserved artifact, qualification, and
provider readback. No tag, publication, GitHub Release, merge, support
expansion, or automated downgrade is authorized or claimed here. Downstream
repositories continue to build and test natively without Mill.
