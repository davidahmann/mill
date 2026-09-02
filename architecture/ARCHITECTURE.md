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
contracts carry stable outcome, acceptance, invariant, decision, and scenario
IDs. Each material task binds one approved outcome and an exact human-approved
impact manifest, and validation reports new-behavior and preservation evidence
separately. Scenario and invariant evidence must execute their own approved
command or carry an unexpired human attestation with an exact kind, stable ID,
and content-digest claim for that item; an acceptance claim or generic passing
command cannot certify another semantic item. Task-packet version 1 remains a
byte-stable, resume-only legacy shape for in-flight runs. Every new run uses
version 2, which requires the impact manifest and exact product-to-task semantic
graph.

Codex remains the only worker implementation behind an internal `WorkerAdapter`.
Before every builder, repair, or reviewer process starts, Mill records an
immutable redacted invocation envelope containing the task, context epoch,
candidate when applicable, role profile, prompt-template digest, allowed scope,
deadline, and output budget. Launch intent is durable before spawn. Exactly one
terminal provider event settles an invocation, and reviewers must emit exactly
one structured result. Candidate publication is atomic with its mutating-worker
settlement, and review-result publication is atomic with its reviewer
settlement, so a crash cannot consume an attempt without preserving the
corresponding result. Process exit is journaled against the invocation in the
same transaction that clears its active-process binding. A possibly started
mutating invocation becomes uncertain and is reconciled from candidate, process,
and worktree state instead of being blindly replayed.

Wave 4B turns those approved contracts into repository integration without
adding another executor. The bundled `node-typescript-next-web` recipe binds one
manifest digest to every exact generated asset, dependency version, runtime
patch, native command, license allowlist, and digest-pinned verifier image. A
greenfield plan is staged outside its destination, receives a separate exact
human approval, prepares lock-bound dependencies through attended registry
network, runs the complete recipe gate, creates one canonical DCO commit, and
only then reserves the still-absent target without replacement. It materializes
files without `.git` and atomically renames the complete staged `.git` directory
into place as the final authority-publication boundary; the reserved path is not
a repository before that operation. A target-scoped exclusive lock prevents
concurrent Mill apply, while the exclusive reservation preserves a target
created by another process after approval. Greenfield publication is a two-phase
cancellation boundary: target materialization stays cancellable and rechecks
immediately before the atomic `.git` rename; once that rename is invoked, Mill
completes and reports the exact published result. Failure removes staging, the
Mill-owned reservation, and only state created by that attempt. Adoption first
performs the static scanner and exact compatibility checks, rejects symbolic
links and credential-like files including `.npmrc`, and requires the approved
PRD to remain outside generated builder-writable source scopes. It then records
only non-conflicting integration files on an isolated branch; the operator
checkout does not move. Adopted commands retain their native scripts only when
they and their recipe-owned oracle files match the exact qualified closure; Mill
does not guess an arbitrary repository's test graph. `mill.lock` records recipe
and plan identity, base commit, file ownership, template bytes, installed bytes,
and preexisting bytes so detachment can remain an inspectable manual decision.
The approved plan identity excludes its derived lock bytes to avoid a digest
cycle, binds every other plan field and file action including a digest of the
canonical absolute target, and is then recorded unchanged in both the plan and
`mill.lock`. Planning also proves that the approved blueprint selects the exact
bundled recipe, version, and runtime. Packable template aliases are rendered to
required dotfiles, and product values are emitted as syntax-safe source and
Markdown literals. A generated product task may use recipe command evidence only
when its approved scenario names a matching recipe oracle. That oracle declares
the specific delivered behavior, command, and evidence paths; a generic `check`
label alone grants no product evidence. Selected invariants must be
command-verifiable, and scenarios cannot cross the selected outcome's acceptance
closure. The integration identity also binds the exact Mill generator
package/version. Greenfield targets are canonicalized beneath the selected root
and reject symbolic-link or non-directory ancestors before plan or apply
effects. Integration writes independently reject unsafe file ancestors rather
than trusting a previous scan. Generated task risk is derived from affected
invariant criticality; medium- and high-risk outcomes need an approved
executable non-normal scenario.

Dependency preparation and candidate verification are separate authorities.
Preparation uses the exact verifier image, an explicit npm manager and HTTPS
registry origin, disabled lifecycle scripts, bounded resources, and an attended
network disclosure. The exported boundary independently requires build trust and
attendance. It copies approved lock inputs to staging before identity, rejects
an absent root `package-lock.json`, alternate or credential/query-bearing
sources, unsupported links/workspaces, malformed or incomplete SHA-512
integrity, and absent or symbolic dependency output, then rechecks the frozen
inputs before atomically publishing a snapshot keyed by verifier image, manager,
registry, target, and lock bytes. The marker also binds a deterministic digest
of every installed directory, regular-file byte stream, executable bit, and
contained symbolic-link target; both preparation reuse and verification
recompute it. Operator cancellation reaches the networked installer process
group and cleanup completes before the cancellation result is returned.
Verification never installs or pulls. It mounts that snapshot read-only, mounts
each top-level source entry read-only through a protected workspace skeleton,
and exposes only declared comma-free top-level scratch directories as bounded
tmpfs. This preserves a read-only candidate while supporting framework and
browser outputs. Nested scratch paths, occupied mount targets, symbolic links,
unsupported entries, and ambiguous comma-bearing entry names fail closed.

The founder commands are coordinators, not new state machines. `run next`
resolves exactly one ready outcome and calls the existing run boundary. `start`
binds that outcome, its product-contract digest, approved impact, acceptance
set, and task before registry or model spend, inventories all nonterminal runs
rather than trusting recency, then advances the same sole durable build,
verification, review, remote-readback, and closure states. Remote readback and
closure do not re-run build preflight or dependency preparation. `ship --draft`
retains the existing separate exact proposal and attended open operations. None
of these commands can mark ready, merge, deploy, or interpret an unapproved PRD
as execution authority. The lifecycle boundary repeats the no-active-run check
under the same exclusive writer lease that creates a run, so two coordinators
cannot pass a stale preflight and create parallel lifecycles.

The GitHub adapter is isolated behind the delivery coordinator. Planning reads
the live delegated actor, repository node identity, clone URL, fork status and
default branch, then binds them with the candidate commit/tree, task/config,
branch, required checks, review policy, allowed merge methods, approval expiry,
and intended effects. Only `pr open` mutates. Its effect journal records intent
and call start before each push or PR request, caps each effect at two attempts,
and makes ambiguous results enter `effect_unknown`. Reconciliation performs
authoritative branch/marker/PR readback without mutation. Expiration blocks new
mutation authority but never prevents readback or truthful lifecycle closure for
an already attempted effect. Exact absence permits one retry; a second absent
outcome blocks for human disposition. The same recorded PR number, node
identity, marker, branch, base, open-draft state, and observed head are
invariant whether an ambiguous repair push is absent or landed. A retry performs
that check again from a fresh readback immediately before recording call start
and invoking Git. GitHub API collections are paginated under one deadline and
output budget. Tokens remain behind the operator-owned `gh` and Git
credential-helper boundary and are not passed to Codex or stored in state.

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
control rather than host containment. Mill freezes the effective per-directory
`AGENTS.override.md` or `AGENTS.md` choice and re-enumerates the complete path
set before every later worker wake; changed bytes, additions, removals, or
precedence changes invalidate the context epoch. `contextPaths` select frozen
priority read-only context rather than limiting filesystem reads. The active
task, `mill.yaml`, authority files, repository instructions, and
selected-command `controlPaths` form the immutable oracle closure and cannot
overlap candidate output scope. Build qualification rejects tracked symlinks and
configured sensitive paths, Git replacement refs, and graft metadata before
creating the worktree; lifecycle Git commands also disable replacement objects.
Secrets must remain untracked and outside the repository.

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

The first qualified greenfield recipe is a Node.js 24.18.1 and npm 11.16.0
TypeScript web modular monolith using Next.js 16.3.4, React 19.2.8, and
Playwright 1.62.1. These runtime patches truthfully match the selected exact OCI
image and are intentionally independent of Mill's Node 24.20.0 maintainer
runtime. The recipe generates native format, lint, type, unit, integration,
browser, build, and package gates and remains independently operable with npm.
It is deliberately one qualified recipe, not a generalized stack claim.

## Identity and authority

Product truth and native commands come from the canonical Git revision.
Operational state is keyed by repository UUID, canonical Git common directory,
and run UUID. A fork, changed forge owner, lookalike remote, or second clone
does not inherit `propose` authority. Every external mutation persists intent
before the call and reconciles unknown outcomes before retry.

## Containment claim

Selected verification commands run against a clean exact candidate in a
digest-pinned OCI environment with no network, a read-only root, individually
read-only top-level source mounts, dropped capabilities, no-new-privileges,
bounded PID/memory/CPU/shared-memory/output/deadline resources, and no implicit
image pull. Declared top-level dependency inputs mount read-only and declared
top-level scratch outputs mount as bounded tmpfs; they may not hide candidate
content. Every command receives an opaque Mill-owned container name and evidence
is withheld until an unconditional, separately bounded `docker rm --force`
succeeds. If the canonical workspace or dependency source path contains a comma,
Mill uses a mode-restricted exact-realpath alias so Docker's comma-delimited
long syntax cannot truncate it. A top-level candidate entry containing a comma
is not representable by this verifier and blocks. Codex runs in attended
trusted-host mode using workspace-write sandboxing and promotion-time Git scope
and identity checks. Mill does not claim this prevents all host access. Stronger
containment requires a separately qualified container/VM worker with controlled
model authentication and no host-home, Docker-socket, keychain, or forge
credential access.

## Release trust

The first public artifact follows a genesis protocol: exact reviewed commit,
pinned external/native builder, two fresh reproductions outside candidate
control, artifact comparison, provenance verification, disposable canary, and
explicit maintainer approval. Trusted release N qualifies N+1 beginning with the
next release.
