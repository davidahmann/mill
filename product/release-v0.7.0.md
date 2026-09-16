# v0.7.0 attended release authority

## Authorization

David Ahmann authorized this release in the attended Codex conversation on
2026-09-16: “execute the plan end to end ... ship till green incl new latest
GitHub and npm releases.” The authorization covers one fresh `v0.7.0`
public-alpha release from the reviewed source candidate: an annotated tag,
candidate and protected publish workflows, one preserved npm artifact, a normal
GitHub Release, npm `latest`, and provider readback.

It does not authorize a wildcard, bypass-2FA token, weaker trusted publishing,
an npm dist-tag edit for an older version, a republish, retag, automatic merge,
or a broader support claim.

## Scope and stop conditions

The source candidate implements the accepted MREV architecture and development
review follow-through. It retains the public-alpha support boundary. The exact
annotated tag must bind the reviewed resulting-main tree.

Stop before publication if the tag, source tree, preserved artifact, candidate
run, qualification, npm provenance, registry readback, GitHub asset, `latest`
pointer, or release state differs. A failed candidate or uncertain external
effect requires a new reviewed version. This authority never permits retagging
or republishing.

## Required closure

The protected workflow must retain `release-evidence-draft.json` while the
GitHub Release is a draft, then attach `release-evidence-final.json` only after
publication and provider readback. Both bind the tag commit and tree, candidate
and publish runs, tarball digest and integrity, qualification digest, npm
provenance and channels, GitHub Release identity, asset digests, and exact
support tuple. Close this authority only from that provider evidence.
