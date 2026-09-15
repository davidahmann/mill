# v0.6.0 attended release authority

## Authorization

David Ahmann authorized this release in the attended Codex conversation on
2026-09-15: “ok plan it all as temp untracked plan then execute test validate
cross check against the plan address gaps if any ship till green incl new latest
github and npm release and docs update”.

The authorization covers the exact `v0.6.0` public-alpha release from reviewed
current `main`: release documentation; one exact GitHub `npm` environment tag
rule; an annotated tag; candidate and protected publish workflows; one preserved
npm artifact; the normal GitHub Release; npm `alpha` and `latest`; and provider
readback.

It does not authorize a wildcard, bypass, weaker trusted publishing, a change to
older tags, releases, or packages, or a broader support claim.

## Scope and stop conditions

The candidate distributes the v0.6 guided-operations source increment from
reviewed `main` commit `52bb0a4196196207a37392e4c11f1406c518338f`. It retains
the existing public-alpha support limits and the immutable failed v0.5.0
evidence.

Stop before publication if the candidate tag, source tree, preserved artifact,
candidate run, qualification, npm provenance, registry readback, or GitHub asset
identity differs. A failed candidate or uncertain external effect requires a new
reviewed version. It never permits retagging or republishing.

## Required closure

After provider readback, record the tag commit and tree, candidate and publish
runs, tarball digest and integrity, qualification digest, npm provenance and
dist-tags, GitHub Release and asset digests, and the exact support tuple. Close
this authority only from that provider evidence.
