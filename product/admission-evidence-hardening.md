# Admission and evidence hardening

David authorized this follow-through on 2026-09-19: review Mill end to end for
gaps exposed by downstream preparation, repair confirmed defects, validate and
ship through green CI, publish the next latest GitHub/npm release, then update
and qualify the named downstream repository's exact pin. Source base:
`59dfb9061c61777743ef812ab402fe6f6d100459`.

The independent review covers planning and onboarding, expert/coordinator
admission, semantic evidence, runtime recovery, delivery, release reconstruction
and documentation. The defect class is a mismatch between a declared requirement
and the condition the code actually checks. Schema validity, a generic command
pass or a matching summary cannot substitute for the required scoped evidence.

This is a new attended native-maintainer task. It may change Mill's code,
schemas, tests, command controls, documentation and release tooling together.
Retain the unchanged baseline and independently review the complete candidate;
new tests do not authenticate their own adequacy. Previous maintainer tasks and
release receipts supply history, not fresh approval.

Acceptance:

- AH-01: expert and coordinated execution apply the same declared outcome scope
  and scenario oracle ownership; preservation-only tasks remain usable.
- AH-02: approved outcomes awaiting packets can receive their first packet;
  ready selection and closure reject missing or conflicting task bindings.
- AH-03: confirmed recovery/resource defects have bounded denial, cleanup and
  negative evidence; documentation states any remaining containment limits.
- AH-04: permanent release evidence reconstructs the artifact, qualification,
  tagged source and verified registry provenance without accepting contradictory
  records. Historical observations remain valid at their recorded time.
- AH-05: publication retries only bounded reads after the immutable npm effect
  and retains fresh exact npm Latest and GitHub Latest observations.
- AH-06: native checks, installed-package cases, applicable OCI canaries, exact
  audit, independent review, required PR checks and resulting-main checks pass.
- AH-07: fresh v0.7.1 uses the protected two-phase release flow, annotated
  source identity, independent builders, trusted verifier and one preserved
  tarball. Verify both Latest pointers and permanent evidence before updating
  the downstream repository.
- AH-08: the downstream repository's reviewed exact-version/schema update passes
  its native and offline checks while preserving old task/receipt bytes and
  customer-evidence gates.

The user authorizes the exact new `v0.7.1` tag's addition to the protected npm
environment's allowed tag list, retaining its reviewer and all existing
protections. No wildcard or bypass is authorized. Tag, publication, Latest
promotion and downstream upgrade are distinct effects with readback, under this
request. Unknown effects require reconciliation before retry; published tags and
versions remain immutable.

No new support tuple, customer operation, downstream product implementation,
daemon, parallel runtime writer, deployment, credential sharing or review bypass
is authorized. Product readiness remains conditional on external evidence and
owner decisions; software tests cannot close those gates.

## Observed publication recovery

On 2026-09-19, candidate run `35466952501` passed all four release gates for tag
`v0.7.1`, commit `50873b47574e9a46ca009c514186532332f385eb`. Publish run
`35467443471` completed the immutable npm publication, then exhausted its twelve
metadata reads before npm exposed the version. Subsequent registry readback
confirmed the exact artifact integrity, provenance and `latest` pointer. No
GitHub Release was created by that run.

The owner's end-to-end repair and release instruction includes completing this
known publication and fixing the observed recovery gap. Extend the bounded read
window and add a protected, finalization-only workflow. It must prove the
original successful publish step and qualified artifact, verify the existing
registry version, and preserve the original publish run in release evidence.
Record the recovery workflow's separate source identity. The first recovery
route requires the GitHub tag's release to be absent; an existing or ambiguous
release blocks it. Never repeat publication, replace artifacts, move the tag,
invent a successful original run, or bypass the protected environment reviewer.
