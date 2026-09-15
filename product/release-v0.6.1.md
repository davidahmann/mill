# v0.6.1 attended release authority

## Authorization

David Ahmann authorized this release in the attended Codex conversation on
2026-09-15: “Ok do what is needed until all is green.” This follows the earlier
explicit authorization for release, npm publication, GitHub Release creation,
and documentation updates.

The authorization covers one fresh `v0.6.1` public-alpha release from the
reviewed source candidate: an exact GitHub `npm` environment tag rule, an
annotated tag, candidate and protected publish workflows, one preserved npm
artifact, a normal GitHub Release, and provider readback. The source change
prepares version-stable installation and closure documentation.

It does not authorize a wildcard, bypass-2FA token, weaker trusted publishing, a
change to an existing npm dist-tag, a republish, a change to an older tag or
release, or a broader support claim.

## Scope and stop conditions

The source candidate starts from reviewed `main` commit
`3ba27571af6447abf3100b2b35e673031e82fcb7`. Its package and CLI version are
`0.6.1`. The exact annotated tag must bind the reviewed resulting-main tree.

Stop before publication if the candidate tag, source tree, preserved artifact,
candidate run, qualification, npm provenance, registry readback, `latest`
channel, or GitHub asset identity differs. A failed candidate or uncertain
external effect requires a new reviewed version. It never permits retagging,
republishing, or updating the published `0.6.0` package.

## Required closure

The protected workflow must attach `release-evidence-final.json` to the normal
GitHub Release only after provider readback. It records the tag commit and tree,
candidate and publish runs, tarball digest and integrity, qualification digest,
npm provenance and channels, GitHub Release identity and asset digests, and the
exact support tuple. That release asset is the canonical closure; no later
source commit may rewrite the tagged candidate or duplicate provider facts.
