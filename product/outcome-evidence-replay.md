# Outcome evidence and replay qualification

Status: approved implementation scope, 2026-09-11. Owner: David Ahmann.

## Authority

David Ahmann authorized this native-maintainer increment in the attended Codex
conversation on 2026-09-11: “ok plan it all implememt test validate ship till
green no release yet.” It may change Mill's source, contracts, tests and
documentation through one reviewed draft pull request. It authorizes no tag, npm
publication, GitHub Release, deployment, provider or customer-system action,
telemetry export, centralized service, MCP server or automatic update.

## Outcome

`millctl --json outcome` projects one durable local run into a compact,
schema-checked evidence record. It ties the task and candidate to recorded
lifecycle, validation, review, adaptation-matrix and measured-usage facts. The
projection is read-only and redacted: it never emits worktree paths, raw
prompts, command output, reviewer prose, event payloads, credentials, delivery
receipts or provider response bodies.

The output must distinguish local evidence from acceptance. In this increment,
`ownerAcceptance` is always `not_recorded`; passing checks, a clean review, a
merged pull request and a completed run cannot silently become an owner or
customer decision. A future separately authorized attestation design may bind an
actual decision to a specific candidate, but it is outside this task.

## Implementation plan

1. Define one public outcome schema and a read-only projection that reports
   task/base/candidate identity, lifecycle disposition, attempt and repair
   counts, validation command summary, review finding counts, adaptation
   provider/configuration/matrix results, and measured-usage summary.
2. Derive the projection from the same durable state snapshot used by the run
   timeline. Parse validation, review and delivery records against their
   contracts; do not expose their raw JSON or free-text fields.
3. Verify that every recorded candidate identity agrees with the durable run and
   that the lifecycle timeline is consistent. Missing evidence is explicit;
   malformed, impossible or mismatched evidence blocks the output with stable
   reason codes.
4. Add a second synthetic provider-change fixture with different workflow,
   configuration and failure behavior. It must use independently frozen
   authority and checks, then exercise the ordinary baseline, build, verify and
   review lifecycle in deterministic tests.
5. Document the output boundary and add public schema, package and CLI
   regression coverage. Run the native gate, audit and independent exact-diff
   review, then open one draft pull request and observe required checks. No
   release is made.

## Acceptance

- OE-01 The public projection is schema-valid, read-only and binds its task,
  base, candidate, lifecycle, attempts, repairs and usage to one durable run.
- OE-02 Recorded validation, review and adaptation evidence appears as compact
  statuses and counts with exact candidate bindings; raw state and free text do
  not appear.
- OE-03 Owner or customer acceptance is never inferred. The output visibly
  reports `not_recorded` until a separate attestation design is approved.
- OE-04 A missing, malformed, stale, impossible or cross-candidate evidence
  record blocks the projection with stable reason codes and no leaked payload.
- OE-05 The second synthetic fixture exercises a different provider transition,
  workflow/configuration matrix and failure behavior through Mill's lifecycle.
- OE-06 Both fixtures preserve their isolated source authority and do not claim
  live provider execution, customer acceptance, customer demand or reuse.
- OE-07 Native checks, packed-package checks, generated schemas, clean audit,
  independent exact-diff review and pull-request checks pass without a release.

## Deferred sequence

After this increment, test whether a digest-pinned external playbook provenance
import improves the second replay without changing acceptance. Only after repeat
evidence should Mill add a governed, reviewed proposal path for playbook
improvements. Customer pilot execution, customer-specific checks, provider
monitoring, recurring maintenance and a shared service require their own product
authority and evidence.
