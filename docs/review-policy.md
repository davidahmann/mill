# Review policy and preparation

Approve review policy before admitting the task. To make standalone P2/P3
findings advisory, add this top-level setting to `mill.yaml`:

```yaml
review:
  blocking: p0_p1
```

The setting applies at build and propose trust ceilings. Mill binds it to the
run's configuration digest. After the read-only reviewer returns its report, the
controller records which finding IDs block. It preserves the complete report and
checks that classification at review completion, repair, review refresh,
delivery, merge and outcome projection. An advisory-only report has outcome
status `advisories`; it is not described as an empty or clean report.

Without the setting, local review still blocks every finding. Existing reviews
without a classification receipt keep that rule, even after upgrading Mill.
Required GitHub feedback keeps its legacy P0/P1/P2 blocking rule unless the new
policy was frozen for that delivery. Unclassified feedback blocks. An explicit
required GitHub approval remains required; advisory findings do not turn a
rejection or missing approval into approval.

## GitHub review modes

`propose.reviewPolicy` has three modes:

- `local_only` uses Mill's required exact-candidate local review and does not
  wait for a GitHub reviewer.
- `github_required` additionally requires an `APPROVED` review from every named
  login on the exact PR head.
- `github_codex_required` additionally requires the GitHub Codex summary comment
  from every named login to report `Completed` for the exact PR head. GitHub
  Codex posts findings as review comments rather than an approving review, so
  this mode treats its exact-head summary as completion evidence and evaluates
  its current-head feedback separately.

GitHub reports the Codex App login with its bot suffix:

```yaml
reviewPolicy:
  mode: github_codex_required
  requiredReviewerLogins: ["chatgpt-codex-connector[bot]"]
```

Confirm the login from the target repository's API before freezing policy. Mill
compares it exactly.

For `github_codex_required`, a running, missing, malformed, or stale summary is
not completion. P0/P1 and unclassified feedback block when the frozen review
policy is `p0_p1`; standalone P2/P3 remains recorded and advisory. Mill binds
the complete required-actor review and feedback snapshot into the merge plan.
Any change before merge invalidates that approval.

GitHub Codex begins its hosted review after a draft is marked ready. With
attended merge enabled, Mill therefore uses two approvals: the first may only
mark an exact, green draft ready; after `pr observe` records completed review,
the second may authorize merge. The first approval cannot merge the PR.

Changing policy does not repair an existing blocked run. Preserve its evidence
and use a separately approved admission when its configuration, deadline or
budget no longer permits continuation. Do not edit a stored receipt, reset a
budget, or relabel a concrete P1 failure as advisory to ship it.

## Qualify test infrastructure before model work

Use the existing version-2 `baselineCommandIds` lane for preparation probes.
Declare the commands and their control paths in `mill.yaml`, then select them
for baseline qualification. Keep preservation checks in that selection. New
behavior checks remain in the task's candidate `commandIds`; an unimplemented
feature need not pass before the builder starts.

Preparation probes should exercise the actual verifier image and the same
client/transport used by the acceptance tests. For an HTTP fixture, prove that
hostile headers reach the listener, redirects follow the declared rules, and SDK
URL handling matches the test's assumptions. For file snapshots, prove that
fault injection fires and cleanup runs after failure. A failed baseline returns
no approval digest and cannot authorize a builder run.

Before freezing an oracle, map each acceptance requirement to its assertion and
include representative wrong implementations or injected faults that it must
reject. Mill checks declared evidence references; it cannot infer whether an
assertion captures the intended behavior. Test authors and independent reviewers
own that judgment.

## Keep one repair batch

The private review-completion event retains the full report and classification.
Repair receives blocking findings; advisory findings remain evidence. The
existing repair budget still applies. If P0/P1 findings recur in the same
subsystem, return to design and acceptance coverage before spending another
repair. That subsystem judgment belongs to the operator; Mill enforces the
repair budget but does not infer semantic recurrence.

For changes outside an admitted run, use the
[maintainer review script](maintainer-review.md). Keep earlier receipts so the
reviewer can distinguish a repeated defect from a new one. Ordinary Git pushes
are not intercepted by Mill.
