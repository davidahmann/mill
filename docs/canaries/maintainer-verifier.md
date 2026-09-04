# Maintainer verifier bootstrap

Status: MB-001-A1 repair in qualification after the owner expanded the scope on
2026-09-03T23:54:25.000Z. The prior real verifier ran the full native command
against candidate `5d3e0f210a270c10d042322182860c4071929426` and returned
failure. This bootstrap is not complete. This is not a downstream recipe support
claim, a runtime task approval, a release qualification, or permission to
publish.

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
bounded 256 MiB tmpfs. Direct mount inspection proved that `/tmp`, `/dev/shm`
and the declared top-level tmpfs mounts are all **noexec**, including mounts
whose Docker options do not spell out that default. That prior policy had no
qualified writable location for executable fake-provider fixtures. The MB-001-A1
repair adds only the explicit `executableFixtureScratch: true` grant for OCI
test/package commands. It provides fixed `/mill-fixtures` exec/nosuid/nodev
tmpfs at 256 MiB with no source/dependency writes, host binds, network or
privileges. Other scratch remains noexec; default commands are unchanged. The
runner now places temporary fixtures there, outside the repository.

The npm seed at `/opt/npm-cache` stays read-only. Before a native command, the
runner copies it into a unique scratch child, sets an offline writable cache and
`TMPDIR` in a separate unique `/mill-fixtures` child, and removes only its own
children when the command returns. npm needs writable cache indexes even for
some offline reads. A cache miss fails closed; there is no online fallback. The
real verifier removes its container on failure, cancellation, timeout or output
exhaustion. Do not retry an uncertain process until its exact container has been
inspected and removed through that lifecycle.

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

### Blocking real-verifier result

The original host check passed all 186 then-present tests, coverage thresholds
and the packed-package lifecycle canary. One supplementary argument-boundary
test was added afterward; that earlier host result is not final-candidate
qualification.

The real unchanged `verifyDeclaredCommands` implementation at the source base
then executed `check` on exact candidate
`5d3e0f210a270c10d042322182860c4071929426`, tree
`f88ff90dba4dd9670584025ad224c362f5fc195a`. It passed formatting, lint, types,
workflow policy and schema drift, but failed coverage execution: 122 tests
passed, 65 failed, with one unhandled error. The packed-package stage did not
run. Its command result was `NONZERO_EXIT`, exit 1, duration 38033 ms, output
digest
`sha256:e3d55c9e15dfcdf90af6645bf0307010c1c2232c9826ddaca5e48825c30741b1`. This
direct MB-001 native invocation is not a version-2 task run or a baseline
approval.

Two setup problems are evidenced, without changing the tests:

- All writable locations are noexec. Executable fixture tools consequently fail
  `X_OK` admission and cannot be launched. The normal verifier's default Docker
  tmpfs flags cannot be overridden by the current `mill.yaml` schema.
- Temporary repositories under `/workspace/.mill-scratch` can inherit the outer
  repository marker and package context, unlike ordinary temporary directories
  outside the source checkout. Moving them outside the repository would solve
  that isolation problem but not the noexec blocker.

The narrow next design would provide an explicitly approved, bounded executable
fixture scratch outside `/workspace`, while keeping source/dependencies
read-only, all other scratch noexec, and networking disabled. That requires a
runtime verifier-policy change, now authorized narrowly by MB-001-A1. No
remount, privilege escalation, interpreter bypass, assertion change, timeout
increase, test exclusion or host-only substitution was used to manufacture a
passing gate. Do not promote this candidate or begin brownfield execution from
it.

After qualification and attended closure, freeze this verifier and its command
controls as the next task's base. Normal version-2 task admission and exact
baseline/PR-plan approvals resume unchanged. MB-001 supplies no merge, tag,
GitHub Release or npm-publication authority.
