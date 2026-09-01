# Mill architecture

Status: approved v1 decision Last updated: 2026-09-01

## Form

Mill is a TypeScript modular monolith on Node 24 LTS. It exposes the `millctl`
CLI and stable JSON result envelopes. Operational state uses Node's SQLite API;
durable product truth remains in Git. V1 runs one attended control-plane process
and exits to resumable state for long waits—there is no daemon.

## Boundaries

The implemented Wave 3 boundary is:

```text
exact human-authored task + product/scenario/policy digests
        -> passing exact-base qualification and explicit approval digest
        -> disposable exact-base worktree
        -> bounded Codex builder using operator authentication
        -> lifecycle-owned clean local commit
        -> selected digest-pinned OCI commands without network
        -> fresh read-only Codex review of the exact verified commit
        -> reviewed local candidate or one repair-and-revalidate cycle
        -> exact actor/repository/remote proposal digest
        -> expected-head push + immutable-marker draft PR
        -> exact-head CI and optional GitHub-review observation
        -> human readiness and merge
        -> exact merge/tree/default-branch check readback and closure
```

The complete planned v1 boundary extends that path:

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

The builder never receives forge/deployment authority. The shipper cannot create
or amend the candidate commit. Product/oracle changes invalidate the candidate.
Provider state is authoritative for external effects.

The GitHub adapter is isolated behind the delivery coordinator. Planning reads
the live delegated actor, repository node identity, clone URL, fork status and
default branch, then binds them with the candidate commit/tree, task/config,
branch, required checks, review policy, allowed merge methods, approval expiry,
and intended effects. Only `pr open` mutates. Its effect journal records intent
and call start before each push or PR request, caps each effect at one attempt,
and makes ambiguous results enter `effect_unknown`. Reconciliation performs
authoritative branch/marker/PR readback without mutation. GitHub API collections
are paginated under one deadline and output budget. Tokens remain behind the
operator-owned `gh` and Git credential-helper boundary and are not passed to
Codex or stored in state.

One stable delivery key and branch identify the PR across the single allowed
repair. A new candidate gets new validation, review, approval, and push-effect
identity while updating that same PR. Required checks are evaluated on the exact
current head; missing, pending, conflicting, cancelled, neutral, skipped,
timed-out, or failed results do not pass. Mill never changes draft readiness or
merge state. Finalization requires GitHub to prove the PR head, merge commit,
tree, authorized merger identity, containment in the configured default branch,
allowed merge shape, and successful required checks on the exact merge commit.
One-parent tree-preserving history is classified only as
`linear_tree_preserving`, never guessed to be squash or rebase from policy. A
tree-changing merge requires separate revalidation rather than inferred closure.

In Wave 2, the qualification approval digest binds a passing baseline's exact
base commit, canonical task and repository configuration, selected command
definitions, and normalized evidence identity. The context manifest, candidate
commit/tree, validation evidence, and review result are durably linked in
repository-namespaced SQLite state. Public CLI results and support bundles omit
the worktree path, context payload, prompts, raw model streams, command output,
and credentials. Codex invocations ignore operator configuration and execution
rules and disable host skill search to prevent globally installed workflows from
silently changing task behavior or token use. They still use the operator-owned
authentication home and honor repository-local instructions, so this is input
control rather than host containment. `contextPaths` select frozen priority
read-only context rather than limiting filesystem reads. The active task,
`mill.yaml`, authority files, repository instructions, and selected-command
`controlPaths` form the immutable oracle closure and cannot overlap candidate
output scope. Build qualification rejects tracked symlinks and configured
sensitive paths, Git replacement refs, and graft metadata before creating the
worktree; lifecycle Git commands also disable replacement objects. Secrets must
remain untracked and outside the repository.

Baseline qualification is part of build authority, not static inspection. The
runtime enforces the repository trust ceiling before OCI discovery or command
execution. Verifier preflight and commands inherit the caller's same absolute
deadline and foreground signal lifecycle, while safety cleanup alone retains its
independent bounded deadline.

## Local lifecycle and recovery

Only one writer lease may mutate a repository namespace. The lease is a
dedicated SQLite exclusive transaction: kernel ownership makes acquisition
atomic and releases it on controller death, without stale-directory deletion or
ABA races. Child processes run in their own process group with an absolute
deadline and output cap. The persisted absolute run deadline is reused for
verification, review, retry, repair, and resume; no checkpoint grants a fresh
budget. An attempt ID plus PID, PGID, and process-start digest is diagnostic
state, not signalling authority. Cancellation is durable state polled by the
foreground lease owner, which terminates its own in-memory child, including a
GitHub mutation process; no command signals a stored PID. Cancellation is
rechecked before each external effect, and an interrupted effect remains unknown
until authoritative readback. If the lease is free but a recorded process may
still exist, resume and terminal cancellation fail closed for attended
reconciliation. State events are append-only, backup restore validates SQLite
integrity, schema, and required objects before atomic replacement. Restoring
older state moves newer unreferenced Mill worktrees into a mode-restricted
quarantine with a durable prepared/completed manifest; it never silently deletes
them. Purge requires every run to be terminal. A failed pre-build context setup
removes its provisional worktree and branch. Review attempt budgets are scoped
to an exact candidate generation, and repair reasserts the reviewed commit/tree
before allowing writes. There is no background daemon or implicit retry.

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
and run UUID. A fork, changed forge owner, lookalike remote, or second clone
does not inherit `propose` authority. Every external mutation persists intent
before the call and reconciles unknown outcomes before retry.

## Containment claim

Selected verification commands run against a clean exact candidate in a
digest-pinned OCI environment with no network, a read-only root and workspace,
dropped capabilities, no-new-privileges, resource bounds, and no implicit image
pull. Every command receives an opaque Mill-owned container name and evidence is
withheld until an unconditional, separately bounded `docker rm --force`
succeeds. If a canonical workspace path contains a comma, Mill mounts it through
a mode-restricted, exact-realpath temporary alias so Docker's comma-delimited
long syntax does not truncate the source. Codex runs in attended trusted-host
mode using workspace-write sandboxing and promotion-time Git scope and identity
checks. Mill does not claim this prevents all host access. Stronger containment
requires a separately qualified container/VM worker with controlled model
authentication and no host-home, Docker-socket, keychain, or forge credential
access.

## Release trust

The first public artifact follows a genesis protocol: exact reviewed commit,
pinned external/native builder, two fresh reproductions outside candidate
control, artifact comparison, provenance verification, disposable canary, and
explicit maintainer approval. Trusted release N qualifies N+1 beginning with the
next release.
