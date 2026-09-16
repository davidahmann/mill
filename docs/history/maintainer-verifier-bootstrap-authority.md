# Historical maintainer verifier bootstrap authority

Status: closed and expired. This record is preserved for lineage only; it grants
no current authority.

The following text was moved from `AGENTS.md` on 2026-09-16 without changing its
historical wording.

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
