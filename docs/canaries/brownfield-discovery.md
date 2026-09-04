# Brownfield discovery evaluation

Status: local deterministic fixture evaluation; not a new supported runtime
tuple or release qualification.

## Fixture

- Repository: `https://github.com/typicode/json-server`
- Commit: `89a34a44b7a6a5311dc84f3b8a1b8b45c0905aea`
- Tree: `d305d02f13ab51efaa9af089c65881f276a5e97f`
- License observed: MIT
- Preconditions: clean source tree; no dependency installation, application
  execution, test execution, source write, or fixture modification.

## Invocation and result

The candidate `millctl` ran `discover . --changed src/app.ts` against that
checked-out root. The JSON envelope had SHA-256
`f059936ef8c0ccd36a6bdf65d72872f51fdbde80054e7837edd20e9888849804`.

The report bound the exact commit/tree above and made the following static-only
observations:

- it found six TypeScript test files, including
  `src/adapters/normalized-adapter.test.ts`;
- the literal `src/*.test.ts` selector matched five root tests, not the nested
  adapter test;
- the nested test's `./adapters/normalized-adapter.ts` and `./service.ts`
  imports remained unresolved from its own directory rather than being repaired
  or guessed;
- `src/app.ts` yielded direct importer leads for `src/app.test.ts` and
  `src/bin.ts`;
- executed coverage remained `unknown`.

This evidence confirms extraction behavior under a real clean TypeScript
repository. It does not claim that JSON Server is compatible with Mill's
adoption recipe, that its tests pass, or that a static graph proves runtime
behavior or delivery safety.

## Frozen regression requalification

Task: `mill-brownfield-discovery-acceptance`. This documentation-only builder
pass records the frozen regression boundary; authoritative execution results
remain pending lifecycle validation. The JSON Server observation above is
retained historical evidence, not a rerun against the repaired extractor.

The inspected clean starting commit was
`36bcb9f63fb71f28b7e819cfce3dd028ab803b96`, tree
`4f3fa17c1351a6f4d70e09b5a0ae7d40067448fd`. The extractor
`src/repository/intelligence.ts` is byte-for-byte unchanged from repair commit
`d03247d63b5588e6145a6da8de1a6b3f5d4744da`. Regression commit
`cf4f11e626fd2da979f4f88d31fb31dc389e286e` added the independent assertions
before this task's starting commit. Observed SHA-256 file digests are:

- `src/repository/intelligence.ts`:
  `5754a389ad346378300bd7352b746cc37dcc48d23d8b870659dc7a7d3625a3ec`
- `test/repository-intelligence.test.ts`:
  `5ab6d8448522b8f423b52dce02ab1c4b221ce61a674c9126ce30ad30147b3f07`
- `scripts/test-package.mjs`:
  `f3a6d3ffd72eca43b2e5927c235fc2be2fed887539c2fba34dd472c70828728a`

These identities establish preservation, not passing test results. The builder
changed no source, test oracle, task, impact, or command definition.

### Regression expectations

The frozen repository-intelligence tests require discovery to reject modified
physical source bytes hidden by Git's `assume-unchanged` flag with
`DISCOVERY_COMMITTED_SOURCE_MISMATCH`. A clean-looking status alone cannot
attribute those bytes to the captured commit/tree.

They also require nonliteral `import(imported)` and `require(required)` loads
to remain `unresolved`, with `nonliteral_specifier`, rather than guessing their
targets. The option-bearing command
`vitest run --exclude src/service.test.ts src/*.test.ts` must yield
`static_selection_unknown`, an empty matched inventory, and status `unknown`.
That empty selection does not prove that no tests run.

The acceptance-to-command mapping remains:

- ACC-BFD-001 and ACC-BFD-002: `test:coverage` checks repeatable source-linked
  evidence and stale source/extractor identities.
- ACC-BFD-003 and ACC-BFD-004: `test:coverage` checks unsafe-source rejection,
  explicit unresolved relationships, and derived read-only reporting.
- ACC-BFD-005 and ACC-BFD-006: `test:coverage` checks direct/transitive importer
  leads, unknown unobserved paths, and the separation of test inventory,
  declared selection, and unknown executed coverage.
- ACC-BFD-007: `test:package` exercises the installed CLI's discovery envelope,
  changed-path reporting, read-only authority, and unknown executed coverage,
  alongside package export checks.

All seven acceptance results remain pending authoritative command evidence for
the lifecycle-owned candidate. Reading assertions does not close acceptance.

### Builder checks and limits

Read-only checks confirmed the six approved context-file digests, a clean
starting worktree, and no extractor diff from the preserved repair. Node.js
24.20.0 was located through `asdf which node`, but this builder worktree has
neither `node_modules/.bin/vitest` nor `dist/cli.js`. No test suite, package
build, dependency installation, or external fixture discovery was attempted.
Red-first execution is deferred because this task changes only this record and
the regression oracles were already frozen before builder admission.

The lifecycle must run the declared `test:coverage` and `test:package` commands
and required native validation against its exact committed candidate. This
record supplies no baseline approval digest, passing qualification, review,
audit, or delivery approval. Missing or failed required evidence still blocks
promotion.

Discovery remains static orientation evidence. Neither these regressions nor
the retained JSON Server observation authorize target dependency installation,
target execution, repository mutation, a task, PR, merge, or release. They add
no supported runtime tuple or adoption compatibility claim, and introduce no
Mill dependency into the downstream repository.

## Human-authority binding for requalification

Task: `mill-brownfield-discovery-human-attestation`. The attended task records
David Ahmann's explicit approval as attestation
`ATT-BFD-HUMAN-AUTHORITY-20260904`, approved by `davidahmann` at
`2026-09-04T18:45:00.000Z`, expiring at `2026-09-05T18:45:00.000Z`. Its sole
claim binds `INV-HUMAN-AUTHORITY` to
`sha256:7de5bf4a333908ce8584b13c479a35cbb2bc364ec535a01519831b1d3e2c1380`.
The invariant reserves consequential ambiguity and merge approval to the
configured human authority. Recording this claim does not approve a merge.

ACC-BFD-004 and SCN-BFD-004 retain their command-evidence requirement for
read-only discovery under `test:coverage`. The invariant's human verification
mode requires the separate exact human attestation; passing tests or a derived
discovery report cannot supply that approval. The lifecycle must validate the
attestation's identity, claim digest, and validity for requalification. Missing,
expired, or mismatched authority blocks new effects.

This builder inspected clean starting commit
`5c1a6fe2ac9d7ae857a4a8e23acf7bda73a70945`, tree
`db5aa59f6be88ce42f78af8617d797bc3c99d81f`. All six approved context-file
digests matched, and the extractor, regression test, and packed-package script
retained the file digests recorded above. Only this canary record changed;
the human attestation was already present in the task before this edit.

Requalification results for ACC-BFD-001 through ACC-BFD-007 remain pending
authoritative lifecycle validation of the exact committed candidate through
`test:coverage`, `test:package`, and the required native gates. No test suite
was attempted in this builder pass: the worktree lacks installed Vitest and
Prettier binaries and `dist/cli.js`. Red-first execution is deferred for this
documentation-only change against already frozen regression oracles. The
historical JSON Server observation is not a fresh extractor evaluation.

The approval binds only this bounded local requalification. It grants no
delivery, push, PR, merge, deployment, or release authority and does not replace
exact PR-plan approval, human readiness and merge decisions, or separately
authorized release effects. Discovery remains read-only, adds no support or
adoption compatibility claim, and leaves downstream operation independent of
Mill. This record is not passing qualification, review, audit, or task closure.
