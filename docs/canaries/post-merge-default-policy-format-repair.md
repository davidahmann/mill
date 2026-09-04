# Defaulted post-merge policy formatting repair

Candidate `d59697b2ac6382ac9f8730e763f2292debc085c7` was rejected for
documentation formatting, as recorded by the attended task. Its exact commit
remains in Git history as retained failure evidence; the rejection must not be
relabeled as passing validation. This record does not assert an independently
inspected failed-run log or invent a run identifier or validation receipt.

The maintainer prepared formatted base
`06186f9fe615c91492f82d9fcf75691af4204384` without changing the substantive
migration, policy, or release claims. The
[migration canary](post-merge-default-policy-migration.md) retains its evidence
and unresolved live-readback boundaries. This builder verified all 21 supplied
context digests and adds only this record under the
[format-repair task](../../product/tasks/post-merge-default-policy-format-repair.yaml)
and its
[approved impact](../../product/impacts/POST_MERGE_DEFAULT_POLICY_FORMAT_REPAIR.yaml).

This is a fresh run from the prepared base. Earlier approval, validation, or
review cannot certify the changed candidate, and the failed run must remain
preserved. The lifecycle must bind a new exact candidate commit/tree, run the
declared native gates, and obtain independent exact-candidate review before
separately approved draft delivery. Formatting this file with repository
Prettier and checking it are only focused builder checks; `ACC-REVIEWED-DRAFT`
and `ACC-TRUTHFUL-RECOVERY` remain lifecycle acceptance items. Uncertain effects
require reconciliation before retry, without replaying push or PR creation to
manufacture success.

No tag, publication, GitHub Release, merge, or support claim is authorized by
this task. The prepared `0.1.6` identity does not establish release
qualification; `0.1.5` remains the qualified trust root. Existing runtime,
schemas, tests, command definitions, authority, release evidence, and
external-effect policy remain unchanged. Downstream repositories continue to
build and test natively without Mill.
