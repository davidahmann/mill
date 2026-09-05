# Changelog

## 0.2.0 — candidate

- Add opt-in, exact-plan attended readiness/merge with producer-bound CI,
  strict-protection checks, separate intent journals and readback recovery.
- Bind local review to the complete base-to-candidate diff, including
  preparatory commits; add pre-effect attended scope refresh without changing
  candidate identity or resetting budgets. Preserve one bounded
  native-validation repair.
- Compile source-backed change requests into dependency-checked version-2 tasks;
  bind explicit supersession and propose closure from finalized evidence.
- Add bounded repository-map context and experimental native Node ESM/npm
  adoption without replacing existing source or native oracles.
- Back up generated authority-plan receipts in SQLite and require committed
  readback before purge; preserve partial apply worktrees. Reject existing task
  output paths before approval; add attended exact-plan abandonment retaining
  the original plan and partial-output commit without claiming successful apply.
  Centralize pending-effect admission for both authority compilers and refuse
  authority purge when ignored or untracked foreign content remains.
- Reconcile interrupted push/PR intent independently of enclosing run status;
  settle the effect journal and lifecycle atomically without losing cancellation
  or the original retry budget.
- Sanitize public PR subjects, omit raw evidence from routine status,
  distinguish structural audits and report measured/partial/unavailable usage
  honestly.
- Qualify later releases with the independently pinned v0.1.5 verifier before
  publishing one preserved artifact through the existing OIDC boundary.

Candidate status is not a publication or expanded support claim. Release
qualification and npm/GitHub readback are separate gates.

All notable changes follow Keep a Changelog and Semantic Versioning.

## [Unreleased]

The maintainer-prepared package identity is `0.2.0`. Release qualification,
tagging, npm publication, and GitHub Release creation remain outstanding and
separately authorized; `0.1.5` remains the qualified public-alpha trust root.

### Added

- Persist `configured` or `implicit_default` post-merge policy provenance in
  every new delivery so historical compatibility cannot relax future records.

- Explicit OCI test/package command opt-in for fixed, bounded executable fixture
  scratch outside the repository, retaining default noexec containment and
  read-only source/dependencies.
- A deterministic `millctl discover` command and public schema for bounded,
  source-revision-bound TypeScript repository evidence, conservative importer
  leads, static test-selection reporting, and stale-map detection.

### Changed

- Configure `validate` and `codeql` for resulting-main readback while retaining
  `validate`, `dependency-review`, and `codeql` for the exact pull-request head.

- Make native cleanup retain mounted output roots and use Vitest's native
  configuration loader with caches/reports in generated output scratch.

### Fixed

- Permit one historical full-list post-merge policy binding only when the record
  lacks provenance and a prior binding, the exact reviewed candidate proves an
  implicit default, and authoritative merge readback establishes all other
  delivery identities. Persist the configured nonempty subset and its
  configuration digest as `legacy_migrated`. The
  [migration record](docs/canaries/post-merge-default-policy-migration.md)
  documents delivery `01801a1b-58f9-480f-8cee-54ea2bbeabb2` without claiming
  live recovery or weakening original PR checks.

- Retry npm signature verification within a fixed budget because registry
  package bytes and attestations can become visible at slightly different times,
  while still failing closed when the budget is exhausted.
- Record the durable tag URL in final GitHub Release evidence instead of the
  temporary URL returned while a release is still a draft.

## [0.1.5] - 2026-09-03

Version `0.1.4` passed complete candidate qualification and its exact artifact
was published under the npm `bootstrap` tag to create the package identity that
npm requires before trusted publishing can be configured. That bootstrap used
the maintainer's 2FA session, has no CI provenance or GitHub Release, and is not
the supported alpha. The package-specific OIDC publisher and protected GitHub
environment are now active. Version `0.1.5` completed the provenance-backed
release and is the first qualified public alpha.

### Changed

- Advance the unchanged qualified package identity for publication through the
  protected OIDC workflow and complete npm and GitHub Release readback.

## [0.1.4] - 2026-09-03

Version `0.1.3` was retained as failed prepublication evidence after both clean
builders rejected its annotated tag for omitting the mandatory reviewed-tree
trailer. Version `0.1.4` was the first fully qualified candidate and later
became the package-identity bootstrap described above.

### Changed

- Advance the package identity and release records without moving the failed
  tag; require the documented local tag-identity check before the `v0.1.4` tag
  is first pushed.

## [0.1.3] - 2026-09-03

Version `0.1.2` was retained as failed prepublication evidence after the full
Linux artifact canary passed but qualification could not read its generated
evidence outside the repository safety root. It was never published to npm or as
a GitHub Release. Version `0.1.3` was the fourth prepublication candidate.

### Fixed

- Stage generated qualification evidence at a collision-checked transient path
  inside the repository safety root for validation, remove it on every exit, and
  preserve the same bytes in the release artifact.
- Apply the same bounded staging protocol when the separate publish job
  revalidates the preserved candidate.

## [0.1.2] - 2026-09-03

Version `0.1.1` was retained as failed prepublication evidence after the real
Linux packed-artifact canary exposed root-owned bind-mount output. It was never
published to npm or as a GitHub Release. Version `0.1.2` was the third
prepublication candidate.

### Fixed

- Run release-canary containers as the invoking POSIX user and group with
  writable container-local cache homes, so Linux bind-mounted browser and build
  output remains removable by the runner.

## [0.1.1] - 2026-09-03

Version `0.1.0` was retained as failed prepublication evidence after GitHub's
checkout action exposed an audit compatibility defect. It was never published to
npm or as a GitHub Release. Version `0.1.1` was the second prepublication
candidate.

### Fixed

- Accept only the exact inert `gc.auto=0` repository setting written by GitHub's
  checkout action while continuing to reject other unclassified Git
  garbage-collection configuration.
- Print the structured exact-tag audit report when release qualification blocks,
  and select release notes from the immutable requested tag rather than a
  hard-coded version.
- Accept non-authoritative Codex review progress messages while consuming only
  the CLI's private, bounded final-message file as the structured review result.
- Qualify process-group cancellation on Linux by recognizing a killed zombie
  descendant as terminated without accepting an executing descendant.
- Bind public-alpha support evidence to the exact verifier image embedded in the
  qualified recipe, preventing a stale container identity from entering a
  release candidate.
- Give the packed public-alpha canary explicit adversarial evidence so the
  high-risk greenfield and adoption plans pass the same admission rules as real
  repositories.
- Prepare release-canary dependencies inside the exact Linux verifier image so
  macOS optional native packages cannot leak into the no-network OCI gate.
- Format pre-existing adoption authority artifacts with the downstream native
  style so release qualification measures adoption rather than fixture drift.
- Use a single explicit integration-test timeout that remains stable under the
  full parallel suite instead of accumulating per-test timing exceptions.
- Align generated YAML wrapping with the generated repository's native formatter
  so realistic product contracts qualify before Git publication.

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
- One exact bundled Node.js 24.18.1, npm 11.16.0, Next.js 16.3.4, React 19.2.8,
  and Playwright 1.62.1 web recipe with native format, lint, type, unit,
  integration, browser, build, package, and CI gates.
- Deterministic separately approved greenfield and compatible-adoption plans,
  transactional apply, generated-file ownership in `mill.lock`, manual detach
  planning, and isolated adoption branches.
- Attended lock/image-bound dependency preparation plus `run next`, resumable
  `start`, and two-step `ship --draft` founder commands over existing lifecycle
  authority.
- Read-only exact-candidate audits across product, code, UX, accessibility,
  security, dependencies, architecture, operations, and release.
- Public-alpha qualification contracts for exact support tuples, five-or-more
  dependent accepted changes, item-level preservation, rejected seeded faults,
  packed canaries, and source-qualified usage.
- A two-phase genesis release workflow that compares independent clean builds,
  preserves one tarball, qualifies that exact artifact, publishes it through npm
  trusted OIDC, and verifies npm and GitHub Release readback.
- A value-led operator README, coding-agent operating contract, release and
  withdrawal runbook, support policy, and Wave 5 canary guide.

### Changed

- Dependabot preserves the qualified Node type and TypeScript major boundaries;
  incompatible major upgrades require an intentional toolchain qualification.
- Executable JSON Schemas are generated from runtime contract inputs and checked
  for exact drift in the native gate.
- Repository apply now uses target-scoped exclusion, no-replace reservation, and
  final atomic Git-authority publication; dependency snapshots bind npm/registry
  identity, validate lock origins and installed-tree content, stop and clean up
  on cancellation, and founder start binds the selected PRD before spend.
- New baseline qualifications and runs require task-packet version 2 with exact
  continuity authority; version 1 remains byte-stable for in-flight resume.
- OCI command scratch is explicit and limited to comma-free top-level tmpfs
  directories; dependency inputs remain exact-lock-bound and read-only.
- Repository plans use one non-self-referential approval identity recorded in
  the returned plan and `mill.lock`; founder resume selects preflight and
  dependency work from the persisted lifecycle stage.
- Recipe tasks require named behavior-specific oracles; integration plans bind
  the generator version and canonical target, adoption binds exact lock/oracle
  bytes, and dependency snapshots derive identity from frozen lock copies.
- Canonical target identity is digest-bound, final greenfield publication never
  replaces a late-created target, adoption blocks symbolic links and
  credential-like files, and integration writes reject unsafe ancestors.
- Generated impact and task risk now follows affected invariant criticality,
  medium/high risk requires non-normal scenario evidence, and active-run
  admission is serialized with run creation.
- Founder resume preflights exact remote-review and interrupted recovery before
  spending its bounded repair, and integration approvals must be active ISO
  timestamps.
- Recipe integration rejects cross-outcome scenarios, duplicate acceptance
  references, unprovable invariant modes, builder-writable PRDs, `.npmrc`, and
  non-root or credential/query-bearing npm lock-source bypasses.

### Deprecated

- None.

### Removed

- None.

### Fixed

- Complete SHA-512 integrity parsing and CommonMark punctuation escaping close
  truncated-integrity and product-title interpretation gaps.
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
  instruction override precedence, reject instruction-path drift, and keep
  effective instructions outside candidate write scope. Semantic authority
  rejects duplicate IDs, unbound oracle commands, future-dated approvals, and
  attestations that do not bind the complete canonical item. Conflicting worker
  terminal events fail closed; review evidence and worker settlement commit
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
- Product outcomes now carry stable IDs that impact manifests must resolve;
  single-blueprint proposals are valid, duplicate source identities block, and
  expired effect authority cannot strand readback or truthful closure.
- Worker exit evidence and active-process clearing now commit atomically, so a
  controller crash after process exit leaves a safely reconcilable invocation.
- Recipe verification uses a read-only workspace skeleton with individually
  bound source entries, bounded writable scratch and browser shared memory,
  delayed-mount cleanup handling, and fail-closed occupied or unrepresentable
  mount targets.

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
