# Bounded integration adaptation

Status: approved implementation scope, 2026-09-09. Owner: David Ahmann.

The owner authorized planning, implementation, OSS cloning where useful, native
validation, review, and shipping through green CI in the attended conversation:
“ok lets plan and do what we can now feel free to clone oss repos if needed then
ship till green no release yet”. This is a native-maintainer increment under
WORKFLOW.md; it may change Mill's contracts and tests through one reviewed PR.
It authorizes no tag, npm publication, GitHub Release, customer-system action,
upstream OSS mutation, or public support expansion.

## Outcome

Bind one operator-supplied provider change to an approved workflow/configuration
matrix, execute a bounded patch through Mill, and return portable evidence for
the selected cases. Completion of customer work still requires owner acceptance.
Provider-specific code and checks remain repository-owned and runnable without
Mill. No buyer, pricing, recurring demand or cross-customer reuse is
established.

## Implementation plan

1. Add an optional version-2 task baseline command selection. It must be a
   nonempty, unique subset of the full required candidate commands. Omission
   retains current behavior. Baseline establishes existing behavior; candidate
   verification always runs the full approved command set.
2. Add an optional digest-bound adaptation authority. Record the provider
   notice, old and target contract, applicability evidence,
   workflow/configuration scope, approved owner, independently prepared fixture
   references and complete matrix. Every pair must select its own required
   command/scenario or an explicit exclusion. Bind all referenced local bytes as
   frozen context before building.
3. Add offline adaptation results to ordinary candidate validation evidence.
   Results bind exact candidate/image, authority digest, configuration and
   fixture revisions, commands and exclusions. They cannot claim live-provider
   execution, independent secrecy, owner acceptance, delivery or deployment.
4. Qualify baseline/build/verify/review through a small native TypeScript/Node
   fixture and extend the public historical OSS replay where feasible. Exercise
   wrong behavior, omitted coverage, changed acceptance and stale inputs.
5. Update documentation and package/schema checks, review the exact candidate,
   ship one PR, and observe PR and resulting-main CI. No release.

## Architecture and threat decisions

The task's authority reference owns the matrix and approval-bound baseline
selection. Existing task/config digests, immutable context, protected paths,
candidate commit/tree and OCI command results establish identity. The builder
cannot mutate its evaluation closure or approve delivery. No new background
process, network authority, private context store or forge capability is added.
Normal cancellation, repair and uncertain-effect reconciliation remain in the
existing lifecycle. Fixture evidence is visibly offline; provider sandbox checks
remain a separately authorized customer-CI job. The trusted-host builder does
not offer hidden evaluator isolation. Versioned evidence is reproducibility, not
authentication of a customer's declaration or proof of commercial value.

## Acceptance

- IA-01 existing tasks retain their baseline behavior; explicit baseline
  selections cannot silently reduce candidate commands, omit preservation
  scenarios or affected invariant commands, or weaken required gates.
- IA-02 missing, duplicate, stale, changed, unbound or inconsistent matrix
  inputs block; all workflow/configuration pairs have checks or disclosed
  exclusions.
- IA-03 candidate evidence contains real command outcomes and exact bindings,
  reports failures and exclusions, and never labels offline fixtures live proof.
- IA-04 a reproducible native migration exercises Mill's actual lifecycle and
  wrong candidates fail frozen checks; real versus simulated adapters are named.
- IA-05 native gate, packed surface, schemas, clean-candidate audit, independent
  complete-diff review and PR/main checks pass without a release.

Preserve previous replay records and limitations. Add only runtime changes
needed for this slice; defer monitoring, shared knowledge services, enterprise
hosting, general monorepo support and recurring coverage infrastructure.
