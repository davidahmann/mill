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

## Provider closure

Candidate run `35025015199` and protected publish run `35025845121` completed
successfully. The annotated `v0.6.0` tag, resulting-main commit and reviewed
tree are `22e4524638ccb6bc6479d2c37f2002c7d813c691` and
`42b9f3fa9c176af1b67e90e3e10104c530e60274`. The independent builders selected
`davidahmann-mill-0.6.0.tgz` with SHA-256
`00661cb3545b5b9f07384c9d7bf18159d27ffd2818a6547ed0b2dc71fdae45a4` and npm
integrity
`sha512-1fYKg7zLMEtVFAyTd/v6xccCw3BfU3aDrSL11fQLPQZ/Z1/W2jE/eapTDKX6v63AZFWYDH+jNOAP0FMiSsKRAw==`.

The final release evidence records qualification digest
`sha256:1b18fdf94112d47b421377e2739aa5dd2a4863e4751cb13db54fe35d4f3f24b1`, SBOM
digest
`sha256:2bc65f0032d03779803b2c28d70a06dd3676f803074b44bf0bd0d129645466ee`,
verified npm provenance, and the public
[GitHub Release](https://github.com/davidahmann/mill/releases/tag/v0.6.0). The
release assets contain the tarball, checksum, SBOM, and final evidence.

npm readback confirms `alpha` resolves to `0.6.0`; `latest` remains `0.4.0`.
After a successful npm web login with the maintainer's security key, npm
rejected the requested existing-tag update with `EOTP`. No npm bypass-2FA token
was created, no package version was republished, and no prior tag changed. The
support tuple remains the qualified `darwin-arm64-node24-codex` tuple tested on
2026-09-05 and expiring on 2026-10-05.
