# Release dispatch preflight

## Authority

This attended-maintainer task is authorized by David Ahmann in the Codex
conversation on 2026-09-08: “ok lets do it plan implement test validate fix any
gaps/bugs ship till green no new release though yet but make sure realease flow
is wha we will need last releases had some hiccups and i think we addressed them
but still dont want release pr churns moving forward”.

The task must create a normal reviewed source change only. It must not create or
move a tag, publish an npm package, create a GitHub release, deploy, bypass
protection, or change the completed v0.3.0 release evidence.

## Problem

The release workflow checks package identity after Node setup and dependency
installation. Its candidate builder also constructs the release-record path from
the manually dispatched tag before proving that the input names an annotated tag
that resolves to the checked-out commit. Invalid dispatch input therefore
consumes a runner and can require a recovery PR before the release candidate
reaches its normal evidence gates.

## Required behavior

For each job that checks out the requested release tag (`build`, `qualify`, and
`publish`), the first two steps must be the immutable tag checkout and one
unconditional preflight. The preflight must, before any setup, installation,
build, artifact, or publication action:

1. accept only Mill’s release-tag syntax;
2. prove the named ref is an annotated tag;
3. prove that tag resolves to the checked-out commit; and
4. require the exact tag-bound regular, non-symlink, nonempty release record.

The existing Node identity verifier remains authoritative for package-version,
mainline, and reviewed-tree checks after the repository runtime is available.
The workflow-policy check must reject a missing, conditional, reordered, or
weakened dispatch preflight.

## Evidence and boundaries

This change protects future workflow dispatches. It does not replay, modify, or
reinterpret historical release effects. Passing repository checks and a reviewed
source PR establish source-change evidence only; they do not approve a future
release dispatch.
