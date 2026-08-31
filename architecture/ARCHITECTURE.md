# Mill architecture

Status: approved foundation decision
Last updated: 2026-08-31

## Form

Mill is a TypeScript modular monolith on Node 24 LTS. It exposes the `millctl`
CLI and stable JSON result envelopes. Operational state uses Node's SQLite API;
durable product truth remains in Git. V1 runs one attended control-plane
process and exits to resumable state for long waits—there is no daemon.

## Boundaries

```text
untrusted PRD/repo/web inputs
        -> source and product compiler (proposal only)
        -> exact human-approved product/scenario/blueprint contract
        -> one JIT task and capability grant
        -> Codex builder in disposable worktree
        -> lifecycle-owned local commit
        -> native verifier + realistic scenarios
        -> fresh read-only local reviewer
        -> shipper using local gh
        -> GitHub CI/readback
        -> human readiness + merge
        -> main-check observation and closure
```

The builder never receives forge/deployment authority. The shipper cannot
create or amend the candidate commit. Product/oracle changes invalidate the
candidate. Provider state is authoritative for external effects.

## Core modules

- intake/source classifier;
- product, scenario, blueprint, and JIT compilers;
- static repository scanner and transactional bootstrap/retrofit engine;
- frozen context compiler and Codex adapter;
- SQLite control plane and append-only run events;
- worktree/process runner and command policy;
- native verifier and scenario runner;
- exact-candidate local reviewer and bounded repair coordinator;
- GitHub shipper, effect journal, readback, and closure;
- audits and qualification/release commands.

## Identity and authority

Product truth and native commands come from the canonical Git revision.
Operational state is keyed by repository UUID, canonical Git common directory,
and run UUID. A fork, changed forge owner, lookalike remote, or second clone does
not inherit `propose` authority. Every external mutation persists intent before
the call and reconciles unknown outcomes before retry.

## Containment claim

Build/test commands should run in a pinned OCI environment where available.
Codex initially runs in attended trusted-host mode using workspace-write
sandboxing and promotion-time scope checks. Mill does not claim this prevents
all host access. Stronger containment requires a separately qualified
container/VM worker with controlled model authentication and no host-home,
Docker-socket, keychain, or forge credential access.

## Release trust

The first public artifact follows a genesis protocol: exact reviewed commit,
pinned external/native builder, two fresh reproductions outside candidate
control, artifact comparison, provenance verification, disposable canary, and
explicit maintainer approval. Trusted release N qualifies N+1 beginning with
the next release.

