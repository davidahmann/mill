# v0.3.1 attended release authority

## Authorization

David Ahmann authorized this release in the attended Codex conversation on
2026-09-08: “address these and ship till green incl tag, npm publish, latest
GitHub Release”. The authorization covers resolving Dependabot pull requests 27,
28, and 29 on a current-main release candidate; merging the reviewed candidate;
creating and pushing the annotated `v0.3.1` tag; dispatching the candidate and
publish release workflow stages; publishing the preserved npm artifact; creating
the normal, public-alpha-labelled GitHub Release; promoting the exact npm
`alpha` and `latest` pointers; and recording provider readback.

It also authorizes one exact GitHub `npm` environment tag rule for `v0.3.1`.
That rule must retain the existing required reviewer and custom selected-tag
policy. It must not use a wildcard, approve a bypass, weaken trusted publishing,
or alter prior tag rules.

## Scope and stop conditions

The release candidate may update the three Dependabot dependencies, the package
version, release workflow and policy tests, release notes, and the release
documentation required to preserve the public-alpha contract. Historical tags,
published package versions, release records, and provider evidence remain
immutable.

Stop before publication if the candidate tag, source tree, preserved artifact,
candidate-run identity, qualification, npm provenance, registry readback, or
GitHub asset identity differs. A failed candidate or ambiguous external effect
requires a new reviewed version; it never permits retagging or republishing.
