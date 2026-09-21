# Review and delivery follow-through

Status: approved by David Ahmann on 2026-09-21 in the maintainer work session.
Route: native maintainer implementation and independent exact-candidate review.

Deliver a consistent, optional P0/P1 review gate, earlier qualification of test
infrastructure through the existing baseline lane, preserved review findings, a
packaged maintainer review script, and corrected dependency policy starters.
Ship a qualified release, repin Telryn, and prepare its next admitted task. This
increment does not implement Telryn product behavior.

Acceptance:

- Legacy configuration and receiptless reviews retain their original rules.
- Approved advisory findings remain visible without blocking delivery. P0/P1,
  malformed receipts, config drift and missing required approval still block.
- Provider output cannot supply controller-owned classification authority.
- Review, repair, delivery, merge, refresh and outcome apply the same policy.
- Preparation failures grant no baseline approval; probes run in the existing
  verifier lane before model work.
- The maintainer route binds validation and fresh review to exact
  base/head/tree, rejects drift and records complete findings. It claims no
  trusted CI identity or admitted-task authority.
- Dependency grouping uses valid syntax and keeps routine majors separate.
- Native checks, packed behavior, independent review and source audit pass
  before merge. Release uses the existing immutable tag/artifact/OIDC/readback
  flow.
- Telryn preserves historical runs and acceptance controls, pins the exact
  released version, and gets explicit admission/budget treatment for
  continuation.

Stop for recurring P0/P1 in the same subsystem, uncertain external effects,
missing release evidence or incompatible operational state. Preserve failed
records and immutable publication identities.
