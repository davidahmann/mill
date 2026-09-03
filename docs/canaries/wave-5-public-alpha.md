# Wave 5 public-alpha qualification

Status: implementation gate passed locally; live genesis release pending

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

## Live Gate D evidence still required

Before `v0.1.0` is tagged and published, run the attended longitudinal sequence
with the actual supported Codex profile and exact host tuple. Then execute the
candidate and publish phases in `docs/release.md`. Required results are:

1. reviewed candidate tree equals resulting `main` tree;
2. annotated tag points to that exact `main` commit;
3. two clean tag builders produce equal canonical package contents;
4. the preserved tarball passes clean install, greenfield, compatible-adoption,
   downstream-without-Mill, recovery, and security canaries;
5. all nine exact-tag audits pass;
6. npm OIDC publication and provenance read back correctly;
7. the registry-downloaded tarball repeats the clean canaries;
8. the GitHub Release contains the same artifact, checksum, SBOM, and final
   evidence.

Any pending, skipped, stale, mismatched, or failed item blocks release and the
support claim. The repository does not currently claim that this live gate has
run.

## Evidence locations

- runtime schema: `schemas/public-alpha-qualification.schema.json`
- support schema: `schemas/support-tuple.schema.json`
- release chain: `schemas/release-evidence.schema.json`
- deterministic longitudinal harness: `scripts/test-package.mjs`
- packed clean-room canary: `scripts/qualify-release-artifact.mjs`
- exact-artifact comparison: `scripts/compare-release-artifacts.mjs`
- release workflow: `.github/workflows/release.yml`
- operator runbook: `docs/release.md`
