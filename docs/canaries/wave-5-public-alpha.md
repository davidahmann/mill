# Wave 5 public-alpha qualification

Status: live canary complete; v0.1.5 OIDC release pending

Owner: David Ahmann

Candidate implementation date: 2026-09-03

## What is already proven by the repository gate

The installed-tarball package test drives five dependency-ordered local
lifecycles. Every step begins at the preceding accepted candidate, uses a fresh
state namespace, passes baseline qualification and native verification, reaches
an exact committed review result, and contributes explicit new-behavior and
preservation evidence. After step two, a separate branch sets the protected
value to a known-bad state; the native oracle fails, the branch does not enter
accepted history, and execution resumes from the unchanged accepted commit. The
fifth candidate proceeds through the draft-PR human gate using deterministic
fake Codex, Docker, Git, and GitHub adapters.

Unit and integration coverage additionally prove:

- stale support tuples, future evidence, discontinuous history, duplicate
  candidates, unresolved items, skipped canaries, incomplete audits, and
  invented usage fail closed;
- the audit is read-only, exact-candidate-bound, and reports all nine required
  categories;
- two package artifacts must have safe equal canonical contents before one is
  preserved;
- annotated tag identity and reviewed-tree binding are mandatory;
- the installed release candidate exposes the public CLI and schema surface.

This evidence is deterministic implementation qualification. It is not a live
Codex, GitHub, npm, clean-builder, or public support claim.

## Live Gate D execution

On 2026-09-03 the attended longitudinal sequence ran against the private
disposable repository `davidahmann/mill-wave5-live-canary-20260903` with the
actual supported Codex profile and exact host tuple. Five dependent candidates
were built, independently verified, and reviewed. A separate seeded-fault
candidate failed its independent browser oracle and never entered accepted
history. The fifth candidate was opened as draft PR 1 by Mill, passed its
required check, was marked ready and human squash-merged, and was truthfully
finalized. Its reviewed tree `8b0b4163922f583e9a0d93939d6f79dab47f14e6` equals
resulting `main` tree at `6946e52a0e34229ab690bcf3a716a2a96b3daf4b`.

The first live sequence attempt also proved that the current Codex CLI can emit
multiple schema-shaped agent messages before settlement. Mill therefore keeps
strict single-terminal settlement while consuming only the CLI's explicit,
private, bounded final-message file as review authority.

The remote `v0.1.0` tag reached both clean builders, but exact-tag audit blocked
before artifact comparison because `actions/checkout` adds the inert local Git
setting `gc.auto=0`. No package or GitHub Release was published. The tag remains
immutable failure evidence and the corrected release restarts as `v0.1.1`.

The `v0.1.1` candidate then passed both clean builders, exact-tag audit, and
independent artifact comparison. Its real Linux packed-artifact canary exposed
that the verifier container ran as root and left bind-mounted browser output the
non-root runner could not remove. A local real-artifact rerun proved the
correction by running greenfield, adoption, downstream independence, recovery,
and security canaries as the invoking host user. No package or GitHub Release
was published from `v0.1.1`; its tag also remains immutable failure evidence.

The `v0.1.2` candidate proved the ownership correction on GitHub's Linux runner:
the complete packed-artifact canary and cleanup passed. Qualification then
blocked because the workflow asked Mill to read its generated evidence from
outside the repository safety root. No package or GitHub Release was published;
the corrected workflow stages the exact bytes at a collision-checked transient
in-root path and removes them on every exit.

The `v0.1.3` candidate stopped at release identity before either builder ran its
gate because its annotated tag omitted the required `Reviewed-Candidate-Tree`
trailer. The tag remains immutable failure evidence. No artifact, npm package,
or GitHub Release was produced; the corrected source is carried forward as
`v0.1.4`, whose tag must pass local identity verification before its first push.

The `v0.1.4` tag passed that local identity check, both independent builders,
exact-tag audit, artifact comparison, the full Linux packed-artifact canary, and
public-alpha qualification. npm requires a package to exist before its trusted
publisher can be configured, so the exact qualified artifact was published once
under the `bootstrap` tag using the maintainer's 2FA session. Registry bytes,
signature, install, version, and help read back correctly. Because that
bootstrap publication did not carry CI provenance and has no GitHub Release, it
is not the supported public alpha. The package-specific OIDC publisher and
protected GitHub environment are now configured for the complete `v0.1.5`
release.

The remaining release-chain results are:

1. the `v0.1.5` annotated tag points to the reviewed resulting-main tree and
   contains exactly one matching reviewed-tree trailer;
2. two clean tag builders produce equal canonical package contents;
3. the preserved tarball passes clean install, greenfield, compatible-adoption,
   downstream-without-Mill, recovery, and security canaries;
4. all nine exact-tag audits pass;
5. npm OIDC publication and provenance read back correctly;
6. the registry-downloaded tarball repeats the clean canaries;
7. the GitHub Release contains the same artifact, checksum, SBOM, and final
   evidence.

Any pending, skipped, stale, mismatched, or failed item blocks release and the
support claim. The repository claims the completed attended canary only, not a
qualified public release, until every remaining result passes.

## Evidence locations

- runtime schema: `schemas/public-alpha-qualification.schema.json`
- support schema: `schemas/support-tuple.schema.json`
- release chain: `schemas/release-evidence.schema.json`
- deterministic longitudinal harness: `scripts/test-package.mjs`
- packed clean-room canary: `scripts/qualify-release-artifact.mjs`
- exact-artifact comparison: `scripts/compare-release-artifacts.mjs`
- release workflow: `.github/workflows/release.yml`
- operator runbook: `docs/release.md`
