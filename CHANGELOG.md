# Changelog

All notable changes follow Keep a Changelog and Semantic Versioning.

## [Unreleased]

### Added

- Pre-alpha `millctl` package foundation with exact-version lock enforcement.
- Stable human and JSON result envelopes.
- Compact executable schemas for repository, product, blueprint, scenario,
  outcome, configuration, and lock contracts.
- Non-executing PRD inspection, static repository adoption scan, and truthful
  mode-aware doctor command.
- Pinned least-privilege CI, CodeQL, dependency review, DCO, package smoke,
  coverage, and trusted-publishing release foundations.
- Attended local task delivery through explicit canonical approval, a disposable
  worktree, lifecycle-owned commit, digest-pinned no-network OCI verification,
  and exact-candidate read-only Codex review.
- Repository-namespaced SQLite state with append-only events, exclusive writer
  leases, cancellation, interruption recovery, backup/validated restore,
  reviewed-or-terminal purge, and redacted support export.
- Executable task-packet, context-manifest, validation-evidence, and
  review-result contracts with aligned runtime and JSON Schema validation.
- Exact-candidate draft-PR planning, attended push/open, unknown-effect
  reconciliation, paginated GitHub policy observation, human merge gating, and
  exact post-merge closure with an executable delivery-record contract.
- Coordinator-enforced remote attendance, one readback-authorized effect retry,
  changing-blocker replacement, and database-swap state-restore recovery.
- Source manifests, stable product invariants and decision cards, canonical
  specification assessment/promotion/diff, approved impact manifests, and
  item-level new-behavior versus preservation evidence.
- One internal Codex worker adapter with immutable profile and invocation
  contracts, durable admission/launch/settlement state, recursive instruction
  freezing, and strict provider-event settlement.
- A source-qualified Node.js 24, Next.js 16, and React 19.2 web-recipe decision
  for the Wave 4B greenfield path.

### Changed

- Dependabot preserves the qualified Node type and TypeScript major boundaries;
  incompatible major upgrades require an intentional toolchain qualification.
- Executable JSON Schemas are generated from runtime contract inputs and checked
  for exact drift in the native gate.
- New baseline qualifications and runs require task-packet version 2 with exact
  continuity authority; version 1 remains byte-stable for in-flight resume.

### Deprecated

- None.

### Removed

- None.

### Fixed

- Exact-version recovery, DCO parsing, per-job workflow bounds, JSON usage
  errors, malformed-contract classification, operator-tool discovery, Node
  readiness, valid `..name` paths, Git-root lock authority, JSON help isolation,
  and runtime/JSON Schema parity now honor their documented contracts.
- Codex builder invocation uses approval routing's workspace-write sandbox
  without passing the mutually exclusive explicit sandbox selector.
- Structured review schemas use Codex-compatible explicit and nullable types;
  failed provider JSONL retains only a safe error code for diagnosis.
- Builder and reviewer invocations disable host skill search so operator-global
  skills cannot silently widen behavior or inflate provider usage.
- Transient or invalid review-provider results can retry the unchanged verified
  candidate once through a durable per-candidate attempt budget, without
  consuming the one post-repair review generation.
- Builder, retry, repair, and review completions record source-qualified token
  usage while refusing to invent currency cost.
- Baseline approval now requires matching successful qualification state and
  binds the exact base, task, command configuration, and normalized evidence.
- Exact-candidate checks reject ignored-file contamination, repair reasserts the
  reviewed candidate before writes, and failed context setup removes provisional
  worktree and branch state.
- Bound task, configuration, authority, context, instruction, and declared
  command-control inputs cannot overlap candidate output scope or be rewritten
  into a validated commit.
- Legacy context manifests retain their exact bytes; new runs freeze Codex
  instruction override precedence and reject instruction-path drift. Semantic
  authority rejects duplicate IDs, unbound oracle commands, and attestations
  without exact item claims. Review evidence and worker settlement now commit
  atomically, while blocked planning assessments return truthful failures.
- Writer exclusion now uses a crash-released SQLite transaction instead of a
  stale-directory protocol; cancellation is polled by the exact foreground
  owner, persisted PIDs are never signalling authority, and delayed exits clear
  active attempts only through compare-and-swap.
- Named OCI verifier containers are force-removed under an independent cleanup
  deadline after success, failure, timeout, output exhaustion, or cancellation.
- OCI verification safely aliases comma-bearing bind paths, and restoring an
  older state backup quarantines newer unreferenced worktrees with durable
  recovery evidence rather than deleting them.
- Planning promotion now rebinds approval to the proposal's current canonical
  bytes; task semantics and selected scenarios must match approved impact, and
  inactive impact exceptions grant no authority.
- Candidate publication and mutating-worker settlement are atomic, review
  attempts use their exact per-candidate generation, and worker profile digests
  bind the prompt-template bytes actually used by the adapter.

### Security

- Static inspection rejects path escape, symlink targets, oversized inputs,
  malformed UTF-8, executable or unclassified Git configuration, incomplete or
  over-budget trees, and repository-controlled command execution. Lock markers
  fail closed; scan digests include Git hazard and truncation state. Git config
  syntax and linked-worktree metadata now fail closed at their parsing and
  indirection boundaries, and explicit tool overrides must be absolute.
- Candidate building is restricted to an exact-base disposable worktree and
  approved paths. Tracked symlinks and configured sensitive paths are rejected
  before builder access; Git hooks and transforming attributes are disabled or
  blocked. Required verification runs without network under resource bounds,
  process-group cancellation escalates across signal-ignoring descendants, and
  public runtime output excludes host worktree paths and frozen context
  contents.
- Codex invocations ignore ambient execution rules, and OCI verification uses a
  clean read-only candidate workspace so uncommitted ignored artifacts cannot
  affect promotion evidence.
- GitHub credentials stay behind the operator-owned `gh` and Git credential
  helper boundary. Exact actor/repository/remote binding, expiring approval,
  expected-head push leases, immutable PR markers, effect journaling, and
  authoritative readback prevent builder access and blind duplicate mutation.
  Durable cancellation is polled before and during mutations; top-level and
  inline review findings, exact merger identity, provable merge shape, and
  non-false-green post-merge results remain fail-closed.
