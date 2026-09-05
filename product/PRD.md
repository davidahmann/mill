# Mill product requirements

Status: approved v1 contract with approved architecture follow-through Owner:
David Ahmann Last updated: 2026-09-04

## Problem

A founder can give a coding agent a PRD, but still has to challenge the product
specification, choose a viable stack, bootstrap or understand the repository,
translate intent into bounded work, orchestrate tests and review, recover from
interruptions, push safely, chase CI, and reconstruct whether the outcome
actually landed. Existing agent harnesses execute code; they do not by
themselves provide a small, repo-owned delivery contract and truthful lifecycle.

## Primary user and job

David is the v1 product owner, maintainer, and final release authority. When he
starts or extends a software product, he wants to supply product intent and
evidence and receive a source-backed proposal followed by a tested, locally
reviewed draft PR without manually orchestrating every internal step.

## V1 outcome

Given a PRD and supporting evidence, Mill must:

1. classify sources, contradictions, assumptions, unknowns, and authority;
2. propose an exact product contract, scenarios, and one supported blueprint;
3. bootstrap or adopt a repository without creating parallel truth;
4. compile one approved outcome into a bounded task;
5. use the operator's logged-in Codex CLI through a narrow adapter;
6. create a local candidate commit before validation and review;
7. run native deterministic gates and realistic delivered-surface scenarios;
8. obtain isolated-context local review and at most one normal repair wave;
9. push only the verified commit and open one draft PR through local `gh`;
10. reconcile ambiguous external effects and observe human merge/main checks;
11. audit the clean exact repository candidate across the bounded product and
    release-readiness categories required by the supported shape;
12. qualify cumulative behavior across dependent changes and preserve one exact
    independently reproduced artifact through genesis release readback.

In the current public-alpha candidate, an operator supplies the structured
source manifest and specification proposal that Mill assesses and freezes. Mill
does not yet claim autonomous live research or proposal generation from prose
alone. Once a repository is integrated, `start` coordinates one already approved
ready outcome through the existing lifecycle; it does not reinterpret the PRD on
every run.

For every material slice, Mill must also preserve product continuity: stable
acceptance and invariant IDs, an approved impact manifest, a realistic scenario
set, and item-level evidence that distinguishes new behavior from preservation.
A generic passing test, model statement, digest, or current-run oracle change is
not semantic evidence for an unrelated requirement. For repository creation, a
task may use bundled command evidence only when its approved scenario selects a
named recipe oracle that declares the specific behavior and evidence paths.
Otherwise the evidence disposition blocks.

## Trust modes

- `inspect`: static reads and proposals; no repository command execution,
  writes, or remote mutation.
- `build`: bounded writes in a disposable worktree and declared commands; no
  GitHub mutation.
- `propose`: push the verified candidate and open a draft PR through an exact
  scoped grant. Optional attended readiness/merge requires explicitly enabled
  policy and a separate exact-plan human approval. No deployment.

The approved increment in `architecture-follow-through.md` additionally binds
complete base-to-candidate review, producer/event/head CI evidence, one bounded
native-validation repair, deterministic follow-up task compilation, bounded
brownfield context, experimental native adoption, truthful audit/usage labels
and independently pinned release verification. These do not broaden worker
authority or qualify an untested stack.

## Success measures

- accepted customer-visible outcomes per week;
- median PRD-to-reviewed-draft time;
- required checks and scenarios passing on the exact head;
- escaped defect and rollback rate;
- human interventions and review generations per outcome;
- CI minutes and model usage when provider-authoritative usage is available;
- truthful recovery from cancellation and ambiguous remote effects.

## Non-goals

V1 excludes a daemon, hosted control plane, automatic merge, deployment,
parallel writers, cross-repository atomic work, tracker synchronization,
arbitrary stack support, plugin execution, shared credentials, and autonomous
self-modification.

## Product principles

- A PRD is narrative evidence, not execution authority.
- Humans approve consequential ambiguity and remote effects; tools do not infer
  authority from available credentials.
- Native repo commands and typed contracts are authoritative.
- Repository onboarding has a non-mutating product approval followed by an exact
  integration-plan approval; apply never infers approval from a PRD.
- Integration identities bind the generator version, canonical target, exact
  recipe and adoption-oracle bytes, and frozen dependency lock graph.
- Model output may vary; approved canonical bytes and exact candidates do not.
- Research and planning propose product truth; they never approve themselves.
- Durable worker admission precedes process launch, and a possibly started
  mutating invocation is reconciled rather than blindly replayed.
- Required pending, skipped, stale, or flaky evidence does not count as pass.
- A later successful task cannot conceal an earlier unresolved preservation
  failure; public-alpha evidence includes dependent history and a rejected
  known-bad branch.
- Release qualification publishes one preserved tarball. Tag, source, builders,
  package integrity, SBOM, registry provenance, and GitHub asset must reconcile.
- Downstream repositories work without Mill.
- Dependency preparation may use attended registry network, but candidate
  verification is offline, source-read-only, and limited to declared scratch;
  attendance and build trust are enforced again at the effect boundary.
- Outcome execution compares plan, product, impact, acceptance, and task
  authority and accounts for every nonterminal run before external spend.
