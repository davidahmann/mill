# Recover an unchanged candidate after verifier preflight failure

Status: approved by David Ahmann on 2026-09-21 in the maintainer work session.
Route: native maintainer implementation, independent architecture review and
exact-candidate local review before push.

Telryn's admitted T-019 builder committed its candidate, but verification
stopped before command execution because the approved image was unavailable.
Restoring the image did not make the blocked candidate retryable. A rejected
second verify also replaced the original blocker with `RUN_NOT_COMMITTED`.
Preserved events and CLI evidence retain the original cause.

Implement a bounded recovery for that failure family. A passing image check must
not count as passing a product test. Preserve the run, original deadline,
candidate, task, configuration, context, attempts and prior evidence.

Acceptance:

- A rejected follow-up command preserves the existing failure reason.
- Safe pre-command infrastructure failure can retry only with unchanged
  authority and candidate identity, no active or uncertain worker, and settled
  container ownership. Actual failed commands require their existing
  disposition.
- An attended, exact plan may grant one new candidate-only verification/review
  window. Its expiry is fixed before approval and no later than the smaller of
  the original task duration and 1,200 seconds from planning/application.
- Original deadlines and counters remain intact. Recovery never grants a
  builder, repair, new candidate, weaker tests, automatic image pull, or
  delivery approval. Cancellation, failed tests, drift and unresolved effects
  block it.
- Historical overwritten blocker codes qualify only when the retained event
  history proves the allowed failure and excludes intervening evidence/effects.
- A tool upgrade is explicit. Any exception to the frozen package pin binds the
  recovery controller version to this run and its verification/review only.
  Cross-version or unpinned recovery requires the original deadline to expire,
  preventing the old controller from launching a builder or repair.
- Unit/integration and installed CLI tests cover success and adversarial
  boundaries. Full native checks, audit and independent reviews pass before
  merge. Release follows the existing tag/artifact/OIDC/readback procedure.

After qualification, use the released fix to recover the existing Telryn
candidate under a fresh explicit receipt. Verify and review it before ordinary
approved delivery. Preserve acceptance and historical records; repin Telryn
through a separate reviewed maintainer change after the product run closes.
