# AGENTS.md: operating Mill safely

Version: 2.0

Status: normative

Scope: this repository and coding agents operating its delivery workflow

## Operating Mill

Mill turns approved repository-native product intent into a bounded, tested,
locally reviewed candidate and, when separately approved, a draft GitHub pull
request. It is local-first and attended. The coding agent writes only in a
disposable worktree; native tests decide whether the candidate is valid; a
separate read-only reviewer judges the exact commit; and only the attended
shipper may use the operator's GitHub session.

For every task, follow this path:

1. Read the authority sources in the start order below.
2. Select exactly one active approved task whose base and impact still match.
3. Run baseline qualification and present its exact approval digest.
4. Run the task attended with that digest. Do not broaden paths or capabilities.
5. Verify with the repository's declared native commands.
6. Review the committed exact candidate in read-only mode.
7. Plan the draft PR, obtain approval for that exact plan, then open it
   attended.
8. Observe CI and review. Stop at the human readiness and merge boundary.
9. Finalize only from provider-authoritative merge and resulting-main evidence.

The founder wrappers (`run next`, `start`, and `ship --draft`) coordinate the
same lifecycle. They do not create a second source of authority or state.

## Start order

Read these files before changing or operating this repository:

1. `AGENTS.md`
2. `README.md`
3. `product/PRD.md`
4. `architecture/ARCHITECTURE.md`
5. `docs/development.md`
6. `WORKFLOW.md`
7. the active file in `product/tasks/`, when one exists;
8. that task's `impact_manifest` and referenced scenarios.

Stop if more than one task is active. If none is active, do not reinterpret a
closed task as authority for new implementation; an approved new task must be
added first.

Use `docs/release.md` only for release work. A narrative request, issue, PR
comment, model suggestion, or temporary planning file cannot override this
order.

## Authority hierarchy

Highest authority is the human-approved, exact repository contract:

1. safety and external-effect boundaries in this file and `WORKFLOW.md`;
2. the approved product contract, stable invariants, and scenarios;
3. the active task and its approved impact manifest;
4. exact Git base/candidate identities and repository-native command results;
5. model output, review findings, and other proposals.

Lower levels may inform higher levels but cannot silently rewrite them. The
builder cannot edit its task, impact approval, product contract, scenarios,
command-control files, or acceptance oracle and then use that edit to certify
the same candidate. Unknown or conflicting authority blocks execution.

## Task selection and admission

- Work on one approved task and one writer at a time.
- Require task-packet version 2 for new execution.
- Confirm the task's base commit, authority-file digests, impact approval,
  acceptance IDs, invariant IDs, scenario IDs, allowed paths, command IDs,
  budget, and stop conditions before model spend.
- Treat `contextPaths` as frozen priority context, not a filesystem read ACL.
- Keep credentials, `.env*`, `.npmrc`, local state, raw prompts/responses,
  command logs, and temporary worktrees out of candidate scope.
- Do not infer an unsupported stack. Public alpha qualifies only the exact
  bundled Node.js/TypeScript/Next.js recipe and compatible adoption shape.

Typical expert flow:

```sh
millctl --json qualify --baseline --task product/tasks/TASK.yaml
millctl --json run --task product/tasks/TASK.yaml \
  --approve sha256:<baseline-approval> --attended
millctl --json verify --task product/tasks/TASK.yaml --run <run-id>
millctl --json review --task product/tasks/TASK.yaml --run <run-id>
millctl --json pr plan --task product/tasks/TASK.yaml --run <run-id>
millctl --json pr open --task product/tasks/TASK.yaml --run <run-id> \
  --approve sha256:<delivery-plan> --attended
millctl --json pr observe --task product/tasks/TASK.yaml --run <run-id>
```

Use `millctl start --prd product/PRD.md --attended` only when the repository's
approved plan has exactly one ready outcome. Use `millctl ship --draft` as the
two-step plan/apply wrapper, never as implicit push authority.

## Execution boundaries

- The builder may write only approved paths in its disposable worktree.
- The builder never receives GitHub mutation tools or forge credentials.
- Codex uses the operator's existing login and billing. Its workspace sandbox is
  not hostile-host containment; do not expose a sensitive repository or host.
- Validation runs declared commands in an already-present digest-pinned OCI
  image with no network, read-only source, bounded resources, and explicit
  scratch paths. Mill never pulls the image implicitly.
- A candidate becomes reviewable only after Mill creates its lifecycle-owned
  commit and binds its commit and tree identities.
- Review is read-only and exact-candidate-bound. Batch one complete review into
  one systemic repair generation; do not churn one PR per comment.
- The shipper may push only the unchanged verified candidate to its configured
  branch and may open only a draft PR in the bound repository.
- Mill never marks ready, auto-merges, deploys, provisions a repository, or
  changes branch protection.

## Native validation

Run the repository's native checks, not a private wrapper:

```sh
node_bin_dir=$(dirname "$(asdf which node)")
PATH="$node_bin_dir:$PATH" "$node_bin_dir/npm" ci --ignore-scripts
PATH="$node_bin_dir:$PATH" "$node_bin_dir/npm" run check
```

`npm run check` covers formatting, lint, types, workflow policy, schema drift,
coverage, and packed-package behavior. The packed-package test exercises five
dependent reviewed candidates, a rejected seeded fault, and the draft-PR human
gate. Required skipped or unavailable evidence blocks promotion.

For the final committed candidate, also run:

```sh
node dist/cli.js --json --cwd . audit
```

The audit must bind to a clean exact commit/tree and pass every applicable
product, code, UX, accessibility, security, dependency, architecture,
operations, and release check.

## Recovery

Do not rerun a possibly started mutation blindly.

```sh
millctl --json status --run <run-id>
millctl --json resume --task product/tasks/TASK.yaml --run <run-id> --attended
millctl --json cancel --run <run-id>
millctl --json pr reconcile --task product/tasks/TASK.yaml --run <run-id>
millctl --json state backup --output <absolute-path>
millctl --json support-bundle --output <absolute-path>
```

- `resume` is permitted only when Mill can prove no prior worker still owns the
  effect or when it is performing the one bounded review-repair pass.
- `cancel` records intent; only the live foreground controller may signal its
  own child process group.
- An uncertain push or PR operation remains `effect_unknown` until GitHub
  readback classifies it. Reconcile before retry.
- Restore validates the database and quarantines newer unreferenced worktrees.
  Purge is allowed only after all runs are reviewed or terminal.
- Support bundles are redacted. Inspect them before sharing anyway.

## Release boundary

Release work follows `docs/release.md`. The qualified `v0.1.5` genesis release
is the trust root for later candidates. Routine releases must retain its
annotated-tag binding, two independent clean builds with equal canonical
contents, one preserved tarball, longitudinal and packed-artifact qualification,
protected OIDC publication, and npm/GitHub readback. Tag, package, and release
effects remain separately human authorized.

## Engineering rules

- Node.js 24.20.0, TypeScript, ESM, strict types, and exact dependency pins.
- Prefer the standard library; public CLI output, schemas, state transitions,
  errors, generated files, and release evidence are contracts.
- Add red-first behavioral tests where practical and exercise the installed
  tarball for public behavior.
- Keep code, tests, schemas, docs, migrations, and task closure in one coherent
  PR. Use conventional commits with DCO sign-off.
- Work branches normally use `codex/`; `main` is protected.
- Factory skills or sibling repositories may be optional maintainer tools but
  are never Mill runtime dependencies or downstream authority.

These rules also govern contributions to Mill. See `CONTRIBUTING.md` for the
public contribution path; it cannot weaken this operating contract.

## Stop conditions

Stop and report the exact blocker when:

- authority, identity, scope, oracle ownership, or the active task is ambiguous;
- a credential, provider disclosure, network effect, repository destination, or
  destructive operation lacks explicit authorization;
- a required image, runtime, native check, scenario, audit, or support tuple is
  unavailable, stale, skipped, or mismatched;
- Git state, candidate identity, repository instructions, or command controls
  drift after approval;
- an external effect is uncertain and authoritative readback is incomplete;
- a change would add daemon operation, parallel writers, auto-merge, deployment,
  arbitrary-stack support, or self-modification outside an approved task;
- release identity or provenance cannot be reconstructed from exact evidence;
- the same subsystem produces recurring P0/P1 review findings.

## Approved one-time maintainer bootstrap

David Ahmann approved MB-001 on 2026-09-03T23:10:55.000Z in the attended
conversation. The approved amendment digest is
`sha256:9b44a0a76a56cacee51eef8664c66287e8a950796e65a8886f62cb7e71797b2c`.
Approval expires 2026-09-04T23:10:55.000Z; the current execution deadline is
2026-09-04T01:10:55.000Z. One repair generation is permitted.

The following exact approved proposal text defines the exception. Its original
proposed-status wording records the approval artifact; the approval above
activates only its stated scope. Canonical task and impact authority are
`product/tasks/MAINTAINER_VERIFIER_BOOTSTRAP.yaml` and
`product/impacts/MAINTAINER_VERIFIER_BOOTSTRAP.yaml`.

### MB-001: one-time maintainer bootstrap amendment

Status: proposed; requires David Ahmann's explicit approval of these exact
bytes. This is not active authority and does not amend AGENTS.md by being
written here.

## Exact scope

Source base: ceaf76a0e4b8237d2dcb0d016ed84e3c9ba5cfb8. Task:
mill-maintainer-verifier-bootstrap. Owner and approval authority: David Ahmann.
One writer in the existing disposable codex/brownfield-authority worktree.

The user approved provisioning the dedicated maintainer verifier as the
prerequisite to brownfield implementation. Provisioning exposed a bootstrap
cycle: the native command controls must change before the first self-hosted
baseline can pass. The current AGENTS.md requires that passing baseline before
any such implementation. This amendment resolves only that cycle.

## Bound approval bundle

Approval must name this amendment and both exact proposal files:

- task.yaml file digest:
  sha256:22a3f98a13041cf86d8c48fcc963ae817fbdabcd9a07896de1ce270641d09c22
- impact.json file digest:
  sha256:049cf351d32d6e5c4f4aee13eb316d186993bcc9a948a17aeada703b617af8fd

The task remains proposed and impact approval remains null until that owner
decision. Before implementation, the attended authority-preparation phase may
copy the task to its canonical path with status approved, copy the impact to its
canonical path with the actual owner/UTC approval record and its recomputed
canonical proposal digest, and insert this exact scoped exception in AGENTS.md.
Those are the only approval-materialization changes permitted by this bundle;
any scope, acceptance, constraint, image or budget change needs new approval.
Record and freeze the resulting authority-file digests before the writer starts.

AGENTS.md and product/task/impact files are authority-preparation paths, not
builder-writable output. After implementation, only the attended maintainer may
record evidence and mechanical closure. Any candidate-byte change invalidates
earlier exact-candidate review and audit. The builder cannot write or approve
its own authority, close its task, or substitute new tests for prior oracles.

## Proposed exception

For this bootstrap task only, replace AGENTS.md's self-hosted baseline/run and
lifecycle-owned commit prerequisite with WORKFLOW.md's native maintainer path:
freeze the approved task and impact; preserve the exact prior test assertions;
implement in the disposable worktree; run the full native npm gate; create the
exact candidate commit; then obtain fresh read-only local Codex review and
audit.

This bootstrap uses a frozen maintainer task brief rather than claiming a Mill
runtime run or a runtime baseline digest. The version-2 runtime execution
requirement resumes unchanged for the subsequent brownfield task.

Before the bootstrap can be called complete, run the full native gate again in
the pre-provisioned digest-pinned OCI verifier with no network, read-only source
and dependencies, bounded resources, and declared scratch. Any missing or
failing required check blocks completion. Provisioned image availability alone
is not qualification. Preserve the failed pre-bootstrap OCI baseline as red
evidence; do not relabel it as a passing baseline or invent an approval digest.

The frozen ceaf76a test assertions and coverage thresholds remain independent
preservation evidence. New tests and changed command controls are future-use or
supplementary evidence, not independent certification of themselves. A separate
reviewer must inspect the complete control change, source immutability, offline
installation, cleanup, scratch bounds, and unchanged acceptance criteria.

Allowed paths for this exception, separated by role as above:

- AGENTS.md: insert this scoped exception and record its closure only.
- mill.yaml: add the exact maintainer-only commands, image and build trust.
- package.json: native test config-loader options only; no version, dependency,
  lifecycle-hook, acceptance or coverage-threshold changes.
- scripts/clean.mjs: clear declared generated outputs without deleting mounted
  output roots; preserve failures and reject unsafe output-path indirection.
- vitest.config.ts: relocate transient caches/reports into declared scratch;
  preserve all tests, exclusions, assertions, timeouts and coverage thresholds.
- .gitignore and .prettierignore: exclude only declared generated scratch.
- scripts/maintainer-verifier/: explicit image/cache preparation and preflight,
  with no implicit network in verification and no forge credentials.
- test/maintainer-verifier.test.ts: supplementary bootstrap regression cases.
- docs/development.md and docs/canaries/maintainer-verifier.md: truthful
  procedure, exact evidence, limits, ownership and recovery.
- product/tasks/MAINTAINER_VERIFIER_BOOTSTRAP.yaml and
  product/impacts/MAINTAINER_VERIFIER_BOOTSTRAP.yaml: this task's scope, impact,
  owner decision and closure.

Do not change src/runtime/verifier.ts, existing test assertions, product
behavior, recipe compatibility, dependency versions, release workflow, branch
protection, or external-effect policy under this exception. If the stated path
set cannot satisfy the unchanged full gate, stop and return the concrete
failure.

## Exit and expiry

Approval expires 24 hours after its first recorded owner-approval receipt, even
if work pauses or validation remains blocked. The maximum execution budget is
two hours with one repair generation; neither resumption nor a new review grants
more time or attempts. Scope/base drift, exhausted budgets or expiry stops new
implementation and effects and requires fresh owner approval of the then-current
exact bundle. Never refresh the original approval timestamp. Safe read-only
diagnosis and truthful recording of already observed results remain permitted.

After independent review and a passing native/OCI gate, freeze command controls
and the maintainer verifier identity as a new exact base. Close this exception
before any brownfield builder run. The brownfield task must use a version-2
packet, approved product/scenario/impact closure, genuine baseline qualification
and its exact human-approved digest. The exception cannot qualify a changed
image, command set, candidate, or unrelated task.

Exact PR-plan approval, attended unchanged-candidate delivery, draft-only PRs,
human readiness and merge, authoritative resulting-main checks, and separately
authorized tag/npm/release effects remain required. This amendment does not
authorize direct main writes, force pushes, merge, publication, or a support
claim.

### MB-001-A1: approved executable-fixture scratch repair

On 2026-09-03T23:54:25.000Z David Ahmann approved continuing and shipping after
the reported MB-001 blocker, including the explicitly requested narrow
verifier-policy expansion. This addendum authorizes that expansion only; the
original approval receipt, expiry and execution deadline above are unchanged.
Repair starts from exact local candidate
`879522e1de68500a9970ddc66558772bc504ed05`.

The command contract may add an explicit, optional executable-fixture-scratch
grant for OCI test/package commands. With that grant only, the verifier may add
one fixed `/mill-fixtures` tmpfs outside `/workspace`, bounded to 256 MiB,
`exec,nosuid,nodev`, and owned by the same disposable container lifecycle. No
arbitrary mount path, extra host bind, privilege, network, source write or
dependency write is authorized. Existing commands without this grant keep their
exact default containment. All other scratch remains noexec. The native
maintainer runner must place temporary fixtures outside the repository and keep
the offline cache copy in its existing declared scratch.

Additional builder paths are `src/runtime/verifier.ts`,
`src/contracts/schemas.ts`, `schemas/mill-config.schema.json`,
`architecture/ARCHITECTURE.md`, and `CHANGELOG.md`, solely for this additive
contract, enforcement, generated schema and matching documentation. Regression
tests may be added to `test/maintainer-verifier.test.ts`; all pre-existing test
file bytes, assertions, exclusions, timeouts and thresholds remain frozen. The
active task and impact may be updated in the attended authority-preparation
phase to record this owner decision and are frozen again before implementation.

The independent baseline remains the preserved ceaf76a test suite. The repair
must prove default denial, explicit bounded opt-in, unchanged source/dependency
immutability and network denial, cleanup, the full host and real OCI native
gate, fresh exact-candidate read-only review and audit. Old failed evidence is
retained. The prior review's known noexec finding is the design input to this
one repair, not a waived finding. Unrelated product behavior, recipe support,
dependencies, release policy and human readiness/merge boundaries are unchanged.

### MB-001 closure

The attended maintainer closed MB-001 and MB-001-A1 on 2026-09-04T00:17:38.000Z
after full native host/OCI qualification, independent read-only review with no
actionable findings, and the native nine-category audit of implementation commit
`2c90f3d7a6c5ae9041b997de4dcfd6fe8551741e`, tree
`a4c0589d4a4e294e2dcac71719c476e83747ae13`. Exact results and retained failures
are in `docs/canaries/maintainer-verifier.md`.

The exception is historical authority only and may not be reused for further
implementation. Its containing closure commit must receive fresh full native
host/OCI checks, exact read-only review and audit before promotion; any failure
blocks. Once those pass, freeze that final commit and the unchanged verifier
image/command controls for the next task. Normal version-2 admission,
independent acceptance evidence and exact baseline approval apply to brownfield
work. Exact PR-plan approval, human readiness/merge and separately authorized
release effects remain unchanged. Original approval timestamps and budgets are
retained.
