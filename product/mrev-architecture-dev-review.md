# Architecture and development review follow-through

Status: approved for one attended maintainer increment on 2026-09-16.

David Ahmann requested execution of the accepted local plan at
`.mill-scratch/plans/TEMP_MILL_ARCH_DEV_REVIEW_2026-09-15.md`, including its
cross-check, normal GitHub delivery, and one new latest npm and GitHub release.
This record turns that request into repository authority. Its source base is
`5b5803e353c67bad8a547fe4bd7d81d3db634734`.

## Objective

Make Mill easier to start and safer to operate without weakening its attended
authority model. Preserve v0.6.1 qualification records before their Actions
artifacts expire. Repair the review, cancellation, state recovery, and worker
output defects identified in the review. Demonstrate the supported pnpm path,
bounded verifier artifacts, measured maintenance replays, and current operator
documentation. Publish the resulting reviewed source as v0.7.0 only after the
candidate, protected publication, and provider readback all pass.

## Scope

The increment covers MREV-01 through MREV-13 in the accepted plan. It may add
generic local fixtures, historical replay material, a small eligible-change
ledger, and repository-owned playbooks. It must not alter Telryn, Setrya,
dbrain, customer material, or upstream OSS repositories. Historical replays must
keep their reference solution out of builder context and state their
contamination limits.

The attended maintainer may create two private, disposable repositories under
the configured owner only for the two MREV-11 lifecycle replays. They may
contain synthetic copies of public historical fixtures, must receive only draft
pull requests, and must be deleted or archived after their immutable evidence is
preserved. This is a qualification action by the maintainer, not a Mill runtime
capability.

## Boundaries

No daemon, automatic merge, deployment, protection bypass, wildcard npm
environment rule, bypass-2FA token, republish, retag, credential persistence,
customer-data handling, arbitrary-stack support, generic native-package build
system, or unsupported pnpm support claim is authorized. A failed or uncertain
effect remains retained and reconciled. New tests supplement existing
independent checks; they do not authorize themselves.

## Delivery

The task uses the approved native-maintainer path. The attended maintainer may
implement, validate, commit, push, open and merge the normal reviewed PR. A
separate v0.7.0 release record must bind the exact source candidate before tag,
npm publication, and GitHub Release creation. The normal protected OIDC path
must publish directly to npm `latest`; final release evidence and provider
readback remain the release closure.

## Completion

Completion requires each MREV item to have its declared evidence or an explicit
owner-approved deferral. The requested scope contains no approved deferral.
Required evidence includes focused regression tests, the full native check,
actual required OCI lanes, clean exact-candidate audit, an independent review,
green PR and resulting-main checks, permanent release assets, and npm/GitHub
readback. The final reconciliation must distinguish verified facts from
remaining qualification limits.
