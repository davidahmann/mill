# v0.3.0 release-notes preflight

## Authority

David Ahmann approved finishing and shipping the v0.3.0 release in the attended
Codex conversation on 2026-09-05, including: “ok but make 0.3.0 latest version
on gh release and npm”, “try npm auth in chrome again if needed”, and “do it”.
The first v0.3.0 publish run established a narrow release-control gap: an
immutable tag without its release record could publish the package before GitHub
Release creation failed. This approved maintainer task is frozen before its
implementation to prevent that ordering error in future candidates.

It authorizes no new tag, rebuild, npm publish, deployment, protection bypass,
automatic merge, or change to historical v0.3.0 artifacts.

## Exact preflight contract

In each candidate build job, the exact immutable checkout is followed
immediately by one unconditional release-notes step. That step binds
`RELEASE_TAG` directly to the dispatched `inputs.tag` and accepts only a
regular, non-symlink, nonempty `docs/releases/${RELEASE_TAG}.md` file. No
command or action may occur between checkout and that check.

The structural policy accepts only this exact shape. Regression coverage must
reject a missing, directory, symlink, hard-coded, conditional, ignored, moved,
or intervening-step check. This single early boundary is intentionally simpler
than attempting to enumerate every future qualification or artifact command.

## Evidence boundary

- This preflight protects future candidates only. It cannot alter the v0.3.0
  tag, tarball, npm provenance, candidate/publish runs, or release evidence.
- Reconciliation uses the preserved verified artifact and provider readback; it
  is not a license to republish an existing npm version.
