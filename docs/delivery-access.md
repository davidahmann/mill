# Delivery credentials

Mill does not collect, store, create or distribute credentials. The attended
shipper invokes the operator's existing `gh` session only after a delivery or
merge plan is approved. The builder and reviewer are instructed not to use forge
credentials, but the built-in worker runs on a trusted host. Treat a host
session as unsuitable for hostile repositories or sensitive source.

## Scope the GitHub identity

Use a separate GitHub identity for delivery when the repository's risk warrants
it. A fine-grained token or GitHub App installation should be limited to the one
repository and the smallest permissions required by the delivery policy:

- repository contents write for the approved branch push;
- pull requests write for draft creation and attended readiness; and
- checks and commit-status read for exact-head observation.

Add issue, administration, organization, workflow, package or environment
permissions only when a separately reviewed repository policy requires them.
Mill's current `gh` integration cannot inspect or attest the effective token or
App scope. Configure and review that identity in GitHub, keep the credential in
the operator's credential store, and record any exception in the repository's
delivery authority. Never put a token, client secret, or browser session in
`mill.yaml`, a task packet, a prompt, or a support bundle.

The existing operator `gh` session remains supported. Using a narrower identity
is an operational hardening step, not a new Mill trust claim or an automated
credential rotation system.
