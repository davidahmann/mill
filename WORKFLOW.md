# Mill delivery workflow

Mill is developed in five vertical waves. Each wave should be one coherent pull
request unless an authority boundary makes two materially safer. Do not split
bookkeeping, closure, tests, or docs into micro-PRs.

1. Foundation and static inspection.
2. One manual local slice to an exact reviewed commit.
3. Exact commit to draft PR, reconciliation, and closure.
4. Product continuity, one greenfield web recipe, retrofit, and founder golden
   path. Wave 4A establishes the read-only contracts and durable worker
   boundary; Wave 4B applies them transactionally.
5. Audits, clean-room qualification, genesis distribution, and public alpha.

For each wave:

1. Freeze one task brief with scope, exclusions, commands, acceptance items,
   authority, risks, and stop conditions.
2. Capture red-first evidence or a structured reason it is not meaningful.
3. Implement only the task scope.
4. Run focused checks, then the full native gate.
5. Commit the candidate before validation/review evidence is considered final.
6. Run a complete exact-candidate local review and one systemic repair wave if
   necessary.
7. Push the unchanged candidate, open/update one PR, and observe required CI.
8. A human may mark the draft ready; David, the configured merger, merges it.
   Observe the resulting main commit and checks.

Before a Wave 4 implementation task can execute, freeze the source manifest,
approved product contract, stable outcome and invariants, selected scenarios,
material decisions, and exact impact approval. Each impact must resolve to its
approved outcome. Each required acceptance, invariant, and scenario ID must
resolve to executed command evidence, an unexpired human attestation, or a
blocking unsupported disposition. Expiration removes authority for new effects;
it does not prevent readback or closure of an effect already attempted. A
current candidate may add future oracles, but those changed oracles do not
independently certify that same candidate.

Current Factory skills are optional maintainer-side bootstrap tools. Their
prompts, profiles, artifacts, or state are not Mill runtime or product
dependencies. Native repository commands remain sufficient and authoritative.
