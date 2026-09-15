# Glossary

Use these terms consistently when operating or reviewing Mill.

- **Acceptance item:** an approved statement that a task must prove. A test or
  review note is evidence for an item, never a replacement for it.
- **Authority:** approved repository material that may constrain a run, such as
  the product contract, scenarios, impact manifest and task packet.
- **Baseline qualification:** a declared-command result for the unchanged task
  base. Its digest may authorize one matching run; it does not authorize a
  patch, push or merge.
- **Candidate:** the exact local commit produced for a run. Verification and
  review bind to this commit.
- **Draft PR:** a pull request that Mill may open only from an approved delivery
  plan. A draft does not grant readiness, merge, deployment, or release
  authority.
- **Impact manifest:** the approved statement of affected outcomes, invariants,
  scenarios and exceptions for one change.
- **Outcome:** one planned, dependency-aware unit of delivery. `start` selects
  one approved ready outcome or resumes its existing lifecycle.
- **Playbook:** small repository-owned operational context. It can guide work,
  but it cannot alter acceptance criteria or approve an action.
- **Proposal:** structured product input that Mill can inspect and compare with
  sources. It becomes authority only after the repository's approval process.
- **Repair:** one new candidate built from recorded verification or review
  findings. It must repeat validation and review; it cannot certify itself.
- **Report:** a redacted, read-only aggregate of local run outcomes and recorded
  usage. It cannot establish customer value or authorize a change.
- **Self-hosting:** Mill's own repository using its delivery process. It is an
  operating measure, not proof that every downstream repository is supported.
- **Task packet:** the versioned, bounded execution authority for one outcome.
- **Timeline:** a redacted projection of durable lifecycle events. It exposes
  event order and state transitions, never event payloads.
- **Verification:** execution of declared repository commands against the
  committed candidate. It is separate from review and owner acceptance.

See [planning](planning.md), [run timelines](run-timeline.md), and
[run outcomes](run-outcome.md) for their exact contracts.
