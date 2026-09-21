# GitHub Codex review follow-through

Status: approved by David Ahmann on 2026-09-21 in the maintainer work session.
Route: native maintainer implementation, exact-candidate review, qualified
release, and downstream correction through the released version.

The T-021 preparation PR in Telryn received two P1 comments from GitHub Codex
after it was merged. Mill's configured `local_only` policy behaved as declared,
but the operator did not wait for or reconcile the hosted review. The local
review also missed those oracle and cleanup gaps.

Add a distinct GitHub Codex review policy without changing `local_only` or
`github_required` semantics. It must:

- require the Codex review summary to report completion for the exact current PR
  head before merge;
- retain current-head GitHub Codex feedback and block P0/P1 while leaving
  standalone P2/P3 advisory under an approved P0/P1 policy;
- keep a draft PR's readiness effect separate when marking it ready triggers a
  new hosted review;
- bind the completed hosted-review observation into the merge plan and recheck
  it immediately before the merge effect;
- reject running, stale, malformed, unclassified, or late blocking feedback;
- surface post-merge review drift rather than closing over it; and
- preserve existing review policies and historical delivery records.

Tests must cover completed, running and stale Codex summaries, clean and
blocking feedback, advisory feedback, draft readiness, review drift between plan
and merge, and post-merge blocking feedback.

Ship this as the next qualified Mill release, repin Telryn, and repair only the
two P1 gaps from Telryn PR #18 through a separately recorded correction. Do not
rewrite T-021's historical packet or receipt, implement either standalone P2,
expand the prototype, publish Telryn, or claim customer/provider qualification.

The owner also approved installation and README simplification in the same
release. Lead with one short, exact, lifecycle-script-disabled npm install and
the path to a reviewed draft PR. Keep the trust boundary and material limits in
the README; move detailed procedures behind focused documentation links.
