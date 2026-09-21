# Mill

Mill is a local-first software factory for new and existing codebases. It turns
approved product intent into bounded, tested, reviewed pull requests with
repository-owned evidence and explicit human approval for delivery and merge.

Mill wraps the coding agent you already use. The builder works in a disposable
Git worktree. Declared checks run against the committed candidate in a
no-network OCI verifier. A separate read-only pass reviews the complete diff.
Only the attended shipper can use your GitHub identity.

## Why Mill

A coding agent can produce a patch, but production delivery also depends on
clear scope, stable acceptance checks, complete review, and recoverable external
effects. Mill records those boundaries in the repository and binds each decision
to the exact candidate it governs.

This keeps product approval, implementation, verification, review, and shipping
with separate principals while preserving the repository's native commands and
GitHub workflow.

## Install

Pin a released version in the repository that will use Mill:

```sh
npm i -D -E --ignore-scripts @davidahmann/mill@0.9.0
npx --no-install millctl --version
```

The exact pin prevents a later release from changing delivery behavior without
review. `--ignore-scripts` prevents package lifecycle code from running during
installation. Before adopting a release, inspect its
[GitHub evidence](https://github.com/davidahmann/mill/releases/latest) and npm
channel with `npm view @davidahmann/mill dist-tags --json`.

## First reviewed pull request

Mill's shortest useful path is: inspect the repository, approve the proposed
authority files, run one bounded task, then approve draft delivery.

### 1. Inspect

These commands read files without executing repository code:

```sh
npx --no-install millctl doctor --mode inspect
npx --no-install millctl inspect --prd product/PRD.md
npx --no-install millctl adopt --scan-only
```

Use `init propose` when the repository already contains a PRD, source manifest,
product proposal, contract, scenarios, impact, and change request:

```sh
npx --no-install millctl --json init propose \
  --prd product/PRD.md \
  --sources product/sources.yaml \
  --proposal product/proposal.yaml \
  --product product/contract.yaml \
  --scenarios quality/scenarios.yaml \
  --impact product/impact.yaml \
  --request product/change-request.yaml
```

The command reports contradictions, assumptions, questions, and digests. It does
not write authority files or approve product intent.

### 2. Approve one bounded task

Review and commit the product contract, scenarios, impact manifest, and task
packet through the repository's normal process. The repository owns these files.
Mill checks their exact digests before spending dependency or model budget.

The [planning guide](docs/planning.md) defines the contracts. The
[glossary](docs/glossary.md) explains Mill's terms.

### 3. Build, verify, and review

```sh
npx --no-install millctl --json start --prd product/PRD.md --attended
npx --no-install millctl --json status
```

`start` selects one approved ready outcome or resumes its sole active run. The
long form exposes each boundary separately:

```sh
npx --no-install millctl --json qualify --baseline \
  --task product/tasks/TASK.yaml
npx --no-install millctl --json run \
  --task product/tasks/TASK.yaml \
  --approve sha256:<baseline-approval> --attended
npx --no-install millctl --json verify \
  --task product/tasks/TASK.yaml --run <run-id>
npx --no-install millctl --json review \
  --task product/tasks/TASK.yaml --run <run-id>
```

The builder cannot edit task authority or the declared controls that certify its
change. Verification and review bind to the same candidate commit.

### 4. Approve a draft pull request

```sh
npx --no-install millctl --json pr plan \
  --task product/tasks/TASK.yaml --run <run-id>
npx --no-install millctl --json pr open \
  --task product/tasks/TASK.yaml --run <run-id> \
  --approve sha256:<delivery-plan> --attended
```

Draft delivery is a separate external effect. It does not authorize readiness,
merge, deployment, or release.

## Review and merge policy

Repositories choose one GitHub review mode in `mill.yaml`:

- `local_only` requires Mill's exact-candidate local review.
- `github_required` also requires an `APPROVED` GitHub review from every named
  reviewer on the exact PR head.
- `github_codex_required` also requires the GitHub Codex review summary to be
  complete for the exact PR head. When marking a draft ready starts that review,
  Mill stops after readiness. The operator observes completion, approves a new
  merge plan bound to that review evidence, then merges.

An approved top-level `review: { blocking: p0_p1 }` keeps standalone P2/P3
findings advisory while retaining them in evidence. P0, P1, unclassified
feedback, missing completion, stale feedback, failed checks, and review drift
block the applicable phase. Read [review policy](docs/review-policy.md) before
changing this boundary.

Attended merge is opt-in. It requires producer-bound checks, strict up-to-date
branch protection, allowed operator and merger identities, and an exact approval
plan:

```sh
npx --no-install millctl --json pr observe \
  --task product/tasks/TASK.yaml --run <run-id>
npx --no-install millctl --json pr merge-plan \
  --task product/tasks/TASK.yaml --run <run-id> --method squash
npx --no-install millctl --json pr merge \
  --task product/tasks/TASK.yaml --run <run-id> \
  --approve sha256:<merge-plan> --attended
npx --no-install millctl --json pr finalize \
  --task product/tasks/TASK.yaml --run <run-id>
```

Mill rereads checks, review, feedback, identities, head, base, and candidate
tree before remote effects. Finalization separately verifies the merge and
required checks on resulting `main`. See [attended approvals](docs/approvals.md)
and [repository settings](docs/repository-settings.md).

## What Mill enforces

- Product authority, stable invariants, scenarios, impacts, and tasks are
  versioned in Git.
- Each run binds the base, configuration, context, budget, candidate,
  validation, review, and delivery evidence by digest.
- The builder cannot push, merge, deploy, or rewrite its acceptance oracle.
- GitHub effects are planned, approved, journaled, read back, and reconciled.
- Native checks remain the repository's source of behavioral evidence.
- Releases publish one independently reproduced tarball with provenance and
  registry readback.

The supported public interface is `millctl --json` plus the published JSON
schemas. Mill does not expose a supported package-root JavaScript API.

## Trust boundary

| Principal        | May do                                                                   | Cannot do                                                        |
| ---------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Builder          | Edit approved paths in a disposable worktree                             | Push, merge, deploy, or change authority and oracles             |
| Verifier         | Run declared commands in bounded no-network OCI                          | Write candidate source or use forge credentials                  |
| Reviewer         | Read the exact committed candidate                                       | Execute or edit candidate code                                   |
| Attended shipper | Push/open a draft; execute a separately approved readiness or merge plan | Change the candidate, self-approve, bypass protection, or deploy |

The Codex builder runs on the trusted host with a workspace-write sandbox. This
is not containment against hostile source, host files, keychains, processes, or
network access. Use Mill only with repositories you trust. Candidate
verification uses a pre-pulled digest-pinned OCI image with no network,
read-only source, bounded resources, deadlines, and explicit cleanup. Read the
[architecture](architecture/ARCHITECTURE.md) for the full boundary.

GitHub operations use the operator's `gh` session by default. A repository can
instead name the fixed `MILL_GITHUB_TOKEN` environment variable for a reviewed,
repository-scoped token. Mill does not store credentials or attest their
permissions. See [delivery access](docs/delivery-access.md).

## Supported scope

The qualified support tuple belongs to each release. The current core path is a
single local Node/npm repository using GitHub, Codex CLI, and a
Docker-compatible OCI runtime on macOS arm64. The repository also contains
narrower exercised paths for shallow pnpm workspaces and synthetic
integration-adaptation replays; those do not establish general pnpm,
native-package, live-provider, customer, or market compatibility.

Mill is local and attended. It supports one repository, outcome, and writer at a
time. It has no hosted control plane, daemon, scheduler, fleet, parallel agent
runtime, deployment authority, autonomous research, or model-authored acceptance
authority.

## Recovery and evidence

Every run has durable state and append-only lifecycle events. Inspect before
acting after interruption:

```sh
npx --no-install millctl --json status --run <run-id>
npx --no-install millctl --json continuation --run <run-id>
npx --no-install millctl --json timeline --run <run-id>
npx --no-install millctl --json pr reconcile \
  --task product/tasks/TASK.yaml --run <run-id>
npx --no-install millctl --json pr merge-reconcile \
  --task product/tasks/TASK.yaml --run <run-id>
```

Mill does not retry an uncertain external effect without authoritative readback.
Cancellation preserves unresolved receipts. The
[approval guide](docs/approvals.md#interruptions),
[OCI recovery guide](docs/oci-recovery.md), and
[verifier recovery guide](docs/verifier-recovery.md) describe the supported
routes.

Use these read-only views for local operating evidence:

```sh
npx --no-install millctl --json stats
npx --no-install millctl --json report
npx --no-install millctl --json outcome --run <run-id>
```

They report lifecycle and measured usage without inferring owner acceptance or
commercial value.

## Reference

- [Planning and authority](docs/planning.md)
- [Brownfield discovery and adoption](docs/brownfield.md)
- [Repository playbooks](docs/playbooks.md)
- [Development evidence](docs/report.md)
- [Run timelines](docs/run-timeline.md) and [outcomes](docs/run-outcome.md)
- [Development guide](docs/development.md)
- [Release runbook](docs/release.md)
- [Product requirements](product/PRD.md)
- [Agent operating contract](AGENTS.md)

## Develop Mill

```sh
git clone https://github.com/davidahmann/mill.git
cd mill
asdf install
node_bin_dir=$(dirname "$(asdf which node)")
PATH="$node_bin_dir:$PATH" "$node_bin_dir/npm" ci --ignore-scripts
PATH="$node_bin_dir:$PATH" MILL_GIT_PATH=/opt/homebrew/bin/git \
  "$node_bin_dir/npm" run check
```

Use [GitHub Issues](https://github.com/davidahmann/mill/issues) for reproducible
defects and private vulnerability reporting for security issues. Support is best
effort with no SLA.
