# Wave 5 public-alpha qualification

Status: live canary complete; v0.1.1 release qualification pending

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

The remaining release-chain results are:

1. the `v0.1.1` annotated tag points to the reviewed resulting-main tree;
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
