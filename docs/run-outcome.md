# Run outcomes

`millctl outcome` projects one durable local run into a compact, read-only
outcome record:

```sh
millctl --json outcome --run <run-id>
```

The record binds task, base, candidate, lifecycle status, repair and attempt
counts to recorded validation, review, delivery and usage evidence. When a run
used a bounded integration-adaptation authority, it also summarizes the provider
transition, configuration revisions and check-or-exclusion matrix.

It emits statuses and counts only. Worktree paths, context, raw prompts, command
output, event payloads, reviewer prose and finding text, provider response
bodies, delivery receipts and credentials remain local. A malformed, stale or
cross-candidate stored record blocks the projection with a stable reason code
instead of returning a successful outcome.

`integrity: consistent` means the retained records agree with each other. It
does not mean that a change was accepted, merged, deployed, correct in a live
provider, or valuable to a customer. `ownerAcceptance` is always `not_recorded`
in this source increment. A human decision needs a separate, candidate-bound
attestation design and cannot be inferred from tests, review or delivery state.

The second synthetic webhook replay in
[`test/integration-adaptation-replay.test.ts`](../test/integration-adaptation-replay.test.ts)
uses a separate frozen provider transition and workflow/configuration matrix.
Its deterministic worker and OCI adapters exercise Mill's lifecycle mechanics;
they do not contact a provider or establish customer compatibility.
