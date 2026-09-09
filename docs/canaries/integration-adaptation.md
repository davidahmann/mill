# Synthetic integration-adaptation lifecycle qualification

## Authority

David Ahmann authorized this attended maintainer qualification in the Codex
conversation on 2026-09-09: “ok lets plan and do what we can now feel free to
clone oss repos if needed then ship till green no release yet”. The authority is
implemented by [the bounded adaptation scope][scope]. It does not authorize a
tag, npm publication, GitHub Release, upstream OSS mutation, customer-system
action, deployment, or a public support expansion.

## Question

Can Mill execute one bounded TypeScript/Node provider migration through its real
lifecycle while preserving an approved workflow, exercising selected
configuration differences, and reporting only the evidence it actually has?

The prior [semantic-release/github replay][oss-replay] established experimental
native adoption and a separate blind candidate. It explicitly did not execute a
migration through Mill's lifecycle. This canary closes that narrower lifecycle
gap with a synthetic fixture; it does not establish customer or live-provider
readiness.

## Fixture and frozen authority

The maintainer script
[`scripts/integration-adaptation/prepare.mjs`](../../scripts/integration-adaptation/prepare.mjs)
created a disposable, local Node 24 repository at fixture base
`0f5e0bbee3f1da061226c1c2d783729182ed9a71`. It contains a synthetic retirement
of `GET /v1/owners` in favor of a workspace-scoped V2 response. The provider
notice, static applicability note, and three synthetic configuration profiles
are digested authority inputs:

| Profile    | Required behavior                                           |
| ---------- | ----------------------------------------------------------- |
| `standard` | Select the configured sales owner.                          |
| `custom`   | Select the configured finance owner from multiple mappings. |
| `fallback` | Use the approved default when no mapping exists.            |

The preservation command also asserts idempotency keys and that a permission
failure occurs before a workspace or task write. The fixture uses no customer
data, credentials, network API call, or source copied from a provider.

## Attended result

This qualification used Mill source commit
`af31052e2e01089e0df7fe7655cbf9e05f607d54`, the digest-pinned Node verifier
image, and native npm controls.

1. `adopt-native` produced experimental plan approval
   `sha256:857b66617304a96e5a8bdba1daf5384c7d9b0078c1d4c235373a8912725cac00`.
   Attended apply added only `mill.yaml` and `mill.lock`; committed-plan
   readback identified `e6509156d69fb6e681ee02b1e2a5a2f0141cf8ce`.
2. Attended dependency preparation used the exact image with npm lifecycle
   scripts disabled. The candidate verifier then had no network.
3. The preservation-only baseline passed with approval
   `sha256:06ae8ba84378e80d82ba12d0498dd377483872d8369a84013368d99ed661f3df`.
   This demonstrates that a new compatibility command need not pass on the old
   provider contract, while preservation still must.
4. Mill ran the bounded Codex builder, created candidate
   `c46f51a3fbb52b922d415abd2a5a398713bcac8c` with tree
   `e05d146e9664a3826de0c9d5933c004468490180`, and executed the complete
   candidate command set in its offline OCI verifier.
5. Preservation plus all three configuration cases passed. The validation record
   binds the candidate, verifier image, adaptation-manifest digest, synthetic
   fixture revisions, individual output digests, and the explicit matrix. It
   labels the assurance `offline_fixture_execution` and owner acceptance
   `not_recorded`.
6. A fresh read-only Codex review of the exact candidate found no material
   findings. Its measured usage was 82,248 input tokens, 944 output tokens and
   57,472 cache-input tokens; currency cost was unavailable.

The source-level regression suite separately proves missing or duplicate matrix
cells, omitted preservation baseline commands, mutable fixture inputs, optional
matrix commands, expiry, incorrect candidates, and unproven dependency output do
not produce a passing result.

## Limits and next evidence

This establishes a local, attended, synthetic compatibility adaptation. It does
not prove live provider behavior, customer configuration fidelity, private
evaluator isolation, a customer owner's acceptance, delivery into a customer
repository, deployment observation, demand, pricing, recurring value, or shared
knowledge across applications.

The next external qualification needs an actual affected TypeScript/Node
integration and owner-approved cases. Keep the provider sandbox or customer CI
as a separate named evidence lane, retain the provider-specific rules and raw
configuration in that repository, and compare total human effort across a second
adaptation before building shared maintenance infrastructure.

[scope]: ../../product/integration-adaptation.md
[oss-replay]: semantic-release-github-search-api-deprecation-replay.md
