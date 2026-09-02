# Mill architecture

Status: approved v1 decision Last updated: 2026-09-02

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

Wave 4A adds two fail-closed seams without adding another harness. Read-only
planning commands assess an operator-supplied PRD, disclosed source manifest,
and structured proposal; they return blockers, semantic differences, canonical
bytes, and exact approval digests without writing files, running repository
commands, or invoking a model. Live research and proposal generation remain an
explicit later coordinator step, not an implied crawler. Approved product
contracts carry stable acceptance, invariant, decision, and scenario IDs. Each
material task binds an exact human-approved impact manifest, and validation
reports new-behavior and preservation evidence separately. Scenario and
invariant evidence must execute their own approved command or carry a scoped,
unexpired human attestation; a generic passing command cannot certify them.

Codex remains the only worker implementation behind an internal `WorkerAdapter`.
Before every builder, repair, or reviewer process starts, Mill records an
immutable redacted invocation envelope containing the task, context epoch,
candidate when applicable, role profile, prompt-template digest, allowed scope,
deadline, and output budget. Launch intent is durable before spawn. Exactly one
terminal provider event settles an invocation, and reviewers must emit exactly
one structured result. A possibly started mutating invocation becomes uncertain
and is reconciled from candidate, process, and worktree state instead of being
replayed.

The GitHub adapter is isolated behind the delivery coordinator. Planning reads
the live delegated actor, repository node identity, clone URL, fork status and
default branch, then binds them with the candidate commit/tree, task/config,
branch, required checks, review policy, allowed merge methods, approval expiry,
and intended effects. Only `pr open` mutates. Its effect journal records intent
and call start before each push or PR request, caps each effect at two attempts,
and makes ambiguous results enter `effect_unknown`. Reconciliation performs
authoritative branch/marker/PR readback without mutation. Exact absence permits
one retry; a second absent outcome blocks for human disposition. The same
recorded PR number, node identity, marker, branch, base, open-draft state, and
observed head are invariant whether an ambiguous repair push is absent or
landed. A retry performs that check again from a fresh readback immediately
before recording call start and invoking Git. GitHub API collections are
paginated under one deadline and output budget. Tokens remain behind the
operator-owned `gh` and Git credential-helper boundary and are not passed to
Codex or stored in state.

One stable delivery key and branch identify the PR across the single allowed
repair. A new candidate gets new validation, review, approval, and push-effect
identity while updating that same PR. Required checks are evaluated on the exact
current head; missing, pending, conflicting, cancelled, neutral, skipped,
timed-out, or failed results do not pass. Mill never changes draft readiness or
merge state, and readiness is not treated as closure authority. Finalization
requires GitHub to prove the PR head, merge commit, tree, authorized merger
identity, containment in the configured default branch, allowed merge shape, and
successful required checks on the exact merge commit. One-parent tree-preserving
history is classified only as `linear_tree_preserving`, never guessed to be
squash or rebase from policy. A tree-changing merge requires separate
revalidation rather than inferred closure.

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
quarantine. Its immutable recovery manifest records the database-swap commit
point and exact moved paths; restore never silently deletes them. Purge requires
every run to be reviewed or terminal. A failed pre-build context setup removes
its provisional worktree and branch. Review attempt budgets are scoped to an
exact candidate generation, and repair reasserts the reviewed commit/tree before
allowing writes. There is no background daemon or implicit retry.

## Core modules

- intake/source classifier;
- product, scenario, blueprint, and JIT compilers;
- static repository scanner and transactional bootstrap/retrofit engine;
- frozen context compiler and Codex adapter;
- immutable worker profile, admission, launch, and settlement journal;
- SQLite control plane and append-only run events;
- worktree/process runner and command policy;
- native verifier and scenario runner;
- exact-candidate local reviewer and bounded repair coordinator;
- GitHub shipper, effect journal, readback, and closure;
- audits and qualification/release commands.

The first qualified greenfield recipe is a Node.js 24 TypeScript web modular
monolith using Next.js 16 App Router and the React 19.2 family. It is
deliberately one recipe, not a generalized stack claim. Wave 4B must freeze
exact dependency and OCI identities, generate native
lint/type/unit/integration/browser/build gates, and prove the repository works
without Mill before applying it.

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
