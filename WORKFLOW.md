# Mill delivery workflow

Mill is developed in five vertical waves. Each wave should be one coherent pull
request unless an authority boundary makes two materially safer. Do not split
bookkeeping, closure, tests, or docs into micro-PRs.

1. Foundation and static inspection.
2. One manual local slice to an exact reviewed commit.
3. Exact commit to draft PR, reconciliation, and closure.
4. Product continuity, one greenfield web recipe, retrofit, and founder golden
   path. Wave 4A establishes the read-only contracts and durable worker
   boundary; Wave 4B applies them transactionally through exact product and
   integration approvals.
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
8. A human may mark the draft ready and merge in GitHub, or approve the exact
   optional attended merge plan through their trusted work surface. Recheck
   producer-bound checks, strict protection and actor/head/base before that
   separately journaled effect. Observe the resulting main commit and checks.

Before a Wave 4 implementation task can execute, freeze the source manifest,
approved product contract, stable outcome and invariants, selected scenarios,
material decisions, and exact impact approval. Each impact must resolve to its
approved outcome. Each required acceptance, invariant, and scenario ID must
resolve to executed command evidence, an unexpired human attestation, or a
blocking unsupported disposition. Expiration removes authority for new effects;
it does not prevent readback or closure of an effect already attempted. A
current candidate may add future oracles, but those changed oracles do not
independently certify that same candidate.

Factory skills may be used externally as optional maintainer-side delivery
tools, but Mill does not track a Factory profile, verifier, pack, or runtime
dependency. Mill's native repository commands, Git workflow, and GitHub checks
remain sufficient and authoritative for development and shipping.

Wave 5 preserves the one-wave/one-PR rule for its implementation. Audit,
qualification, release scripts, schemas, tests, operator/agent documentation,
and task closure land together. The resulting implementation PR does not itself
authorize the release tag, npm publication, GitHub Release, deployment, or a
public support claim.

The public-alpha release has two manual workflow phases. `candidate` consumes an
existing annotated tag plus exact support-tuple and longitudinal evidence,
compares two clean builds, preserves one tarball, runs packed greenfield and
adoption canaries, audits the tag, and emits qualification. `publish` consumes
that prior run by ID, publishes the preserved tarball through the protected npm
environment, reads npm and GitHub back, requalifies the registry download, and
finalizes evidence. It never repacks at publication time.

Longitudinal acceptance requires five or more strictly dependent changes. A
later step begins at the previous accepted candidate, reports new-behavior and
prior-behavior evidence separately, and cannot hide an earlier failure. A
known-bad branch from accepted history must fail its independent oracle and stay
outside the accepted chain before recovery. Support is limited to the exact
non-expired tuple and recipe in that evidence.

For greenfield or adoption onboarding, first assess and explicitly approve the
source-backed product proposal, then inspect and separately approve the exact
repository integration plan. Greenfield apply publishes no target until the
recipe's full native gate passes. Adoption apply writes one isolated branch and
does not alter the operator checkout. Registry access is a separate attended
dependency-preparation effect; later candidate verification has no network and
mounts source read-only.

A recipe-generated task may cite command evidence only through a named oracle
declared by that exact recipe and selected by the approved scenario. The oracle
binds its delivered behavior and evidence paths. Greenfield path ancestors,
adoption lock/oracle bytes, the generator version, trust mode, and attendance
are revalidated at the exported apply/effect boundary rather than trusted from
the CLI wrapper.

After onboarding, `run next` selects exactly one ready approved outcome. `start`
may resume that outcome through the existing run, verify, review, delivery
observation, and closure states. `ship --draft` remains a wrapper over the same
exact proposal-digest and attended GitHub effect boundary. Wrappers do not mark
a draft ready, merge, deploy, or create a second lifecycle. The separate
`pr merge-plan`/`pr merge` boundary is opt-in and requires its own attended
approval; see `docs/approvals.md`. Selection compares the plan, product
contract, impact, acceptance IDs, and task exactly and scans all nonterminal
runs, not only the newest record, before any spend.
