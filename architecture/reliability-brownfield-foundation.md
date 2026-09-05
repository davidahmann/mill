# Reliability and brownfield foundation

This increment strengthens evidence and attended recovery in Mill's existing
local-first architecture. It does not turn Mill into an autonomous engineering
system.

## Continuation packet

`millctl continuation` will project durable run state into a stable, read-only
packet. The projection has three jobs:

1. bind the handoff to task, base, candidate, and configuration identities;
2. state the observed lifecycle phase and any reconciliation requirement; and
3. name the next attended command category without executing it.

The packet is derived from durable state and event evidence. It is not an
agent-maintained memory file and does not expose a worktree path, prompt,
credentials, or GitHub delivery record. `effect_unknown`, an unresolved worker
admission, or an observed live worker routes only to reconciliation or wait; it
cannot recommend another build, push, merge, or release.

## Resource observations

Mill sums only integer usage fields emitted in completed worker events. It
reports the provider's input, output, and cache-input token observations with
separate completeness states. Cost remains `unavailable`: a token count is not a
bill and must not be used as an estimate or an enforced spend boundary.

## Brownfield evaluation

The evaluation pack uses local deterministic fixtures and a fake worker to
exercise the product boundaries that commonly fail in an inherited repository:
stale identity, a missing settlement, a failed native validation, an uncertain
external effect, and a human merge boundary. It provides regression evidence for
Mill's harness—not a benchmark claim about a foundation model or a promise that
customer code needs no qualification.

## Builder isolation boundary

The built-in Codex adapter runs on the attended operator's trusted host with
`workspace-write`. Its profile is descriptive, not a sandbox attestation. A
separate isolated adapter must prove all of the following before Mill can
advertise it:

- disposable filesystem with only the approved worktree and explicit scratch;
- no host home, SSH agent, GitHub credentials, npm credentials, or provider
  configuration mounted into the worker;
- deny-by-default egress with an explicit provider path when required;
- immutable adapter/profile/image identity, resource caps, and cancellation
  behavior; and
- negative tests proving secrets, host paths, and forge mutation are denied.

Until that adapter is separately qualified, a request for isolated execution is
rejected rather than silently falling back to the trusted host.

## Bounded future forms

### Repository context adapter

Mill may later accept an optional revision-bound symbol index such as SCIP. The
import must have an extractor digest, source tree digest, strict size limits,
and a deterministic projection into the task's frozen context. It must never
execute project code, add retrieval over external data by default, or become a
long-lived graph/Graphiti service. Repository-owned notes can be referenced as
ordinary frozen files after their provenance is established.

### Governed improvement record

Mill may later accept an operator-authored improvement proposal that binds a
problem to evaluation cases, observed evidence, a suggested bounded change, an
owner, and a disposition. The record is advisory only. It cannot change an agent
prompt, tool policy, model route, context selection, or release gate; each such
change needs a fresh approved task, adversarial regression evidence, and normal
release qualification.
