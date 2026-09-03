# Maintainer verifier bootstrap

Status: implementation under the approved one-time MB-001 exception. Full
exact-candidate OCI qualification, independent review and audit remain required
before this bootstrap can be called complete. This is not a downstream recipe
support claim, a runtime task approval, a release qualification, or permission
to publish.

## Identity and authority

Owner: David Ahmann. Source base: `ceaf76a0e4b8237d2dcb0d016ed84e3c9ba5cfb8`.
See the exact exception in `AGENTS.md` and
`product/tasks/MAINTAINER_VERIFIER_BOOTSTRAP.yaml`. The approval receipt and
execution deadline are fixed there and must not be refreshed on resume.

The already-provisioned, local-only Linux arm64 image is:

```text
local/mill-maintainer-bootstrap@sha256:cb36daaac8d15771dafbbe32dacbc9e630c7f5a72cb7f690dc9e08254af9cb51
```

It contains Node.js 24.20.0, npm 11.19.0 and Git 2.39.5. Its base is the
official Node image pinned in `scripts/maintainer-verifier/Dockerfile`. That
Dockerfile records the actual provisioning recipe; it is not invoked during
verification. Only the following two files from the source base were in its
build context:

| Input             | SHA-256                                                          |
| ----------------- | ---------------------------------------------------------------- |
| package.json      | 00c9e17baabab8915958f1b3fc41337a95c0b433296739579f67a01cf0a03eb0 |
| package-lock.json | c279f604d1528fba77753ed92e47bdee3cebd1bb48568ecf5b8bc68a0f590936 |

Provisioning was a separately attended network action. Rebuilding from current
files does not establish this image identity. A replacement digest requires new
approval and qualification; verification always uses `--pull never`.

## Execution and recovery

`mill.yaml` has build trust only, no forge configuration. Its command entries
delegate to the same native npm scripts used on the host and in CI. The small
environment-preparation script is not an alternative acceptance oracle.

Use the existing attended `millctl dependencies prepare --attended` command
before verification. It installs only the frozen manifest/lock inputs with
lifecycle scripts disabled and records an image/lock/tree-bound snapshot. It
does not expose candidate source or credentials to npm. This preparation path is
network-capable and must remain separately attended even when the image's
offline cache satisfies the installation. Candidate verification itself has no
network and mounts that exact snapshot read-only.

Native verification uses a fresh clean exact-commit checkout, with no existing
`node_modules`, `dist`, `coverage` or `.mill-scratch` entries. Mill's normal
verifier provides a read-only root, read-only source mounts, non-root UID/GID,
no capabilities, no-new-privileges, no network, 256 PIDs, two CPUs and 1 GiB
RAM. Each declared output (`dist`, `coverage`, `.mill-scratch`) is a separate
bounded 256 MiB tmpfs. `/tmp` remains noexec. Temporary executable fake-provider
fixtures live in the explicitly declared `.mill-scratch` tmpfs, not in source or
the dependency mount. This does not change runtime sandbox policy.

The npm seed at `/opt/npm-cache` stays read-only. Before a native command, the
runner copies it into a unique scratch child, sets an offline writable cache and
`TMPDIR`, and removes only that child when the command returns. npm needs
writable cache indexes even for some offline reads. A cache miss fails closed;
there is no online fallback. The real verifier removes its container on failure,
cancellation, timeout or output exhaustion. Do not retry an uncertain process
until its exact container has been inspected and removed through that lifecycle.

The native Vitest loader avoids writing a bundled config into read-only
`node_modules`. Its cache and reports live under `coverage`. Native cleanup
validates both output roots first, rejects root symlinks/non-directories,
removes only generated children and retains the mount roots. It does not follow
nested generated symlinks. These are attended trusted-host protections, not
containment against a concurrent hostile host writer.

## Evidence and limits

The unchanged source-base OCI gate failed before testing when Vite tried to
create `node_modules/.vite-temp` on a read-only mount. Independent cleanup and
execution probes also exposed mount-root removal and noexec temporary-fixture
failures. Those are red evidence, not a qualified baseline.

The new cleanup tests first failed against the original implementation and then
passed after the mount-safe change. Every pre-existing test file remains
byte-for-byte unchanged, as do existing exclusions, assertions, test timeouts
and coverage thresholds. New tests are supplementary evidence only. A separate
read-only reviewer must inspect all command-control changes and the exact final
candidate; passing changed controls cannot independently certify themselves.

The image passed a non-root, read-only-root, network-none smoke test installing
`commander@15.0.0`, `yaml@2.9.0` and `zod@4.5.4` from a writable copy of its
seed. That smoke test is not the full packed-package canary. Record final native
gate, source-preservation, OCI, review and audit results against exact
identities before promotion. The source base's earlier host gate cannot
substitute for the candidate's gate or for real OCI execution.

After qualification and attended closure, freeze this verifier and its command
controls as the next task's base. Normal version-2 task admission and exact
baseline/PR-plan approvals resume unchanged. MB-001 supplies no merge, tag,
GitHub Release or npm-publication authority.
