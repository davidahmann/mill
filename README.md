# Mill

Mill is a local-first software factory that turns approved product intent into
bounded, tested, locally reviewed draft pull requests.

It is designed for a founder or small team that wants coding-agent leverage
without handing one agent an open-ended ticket, production credentials, and the
power to judge its own work. Product truth stays in the repository. Codex writes
inside a disposable worktree. Native tests and scenarios verify the committed
candidate. A separate read-only pass reviews that exact commit. Only the
attended shipper can use your GitHub identity, and it stops at a draft PR.

Mill `0.1.5` is the first qualified public alpha. It is available from npm and
as a GitHub prerelease with provenance, an SBOM, exact-artifact qualification,
and registry and GitHub readback evidence.

## Why Mill

Coding is only one part of software delivery. The difficult failure modes live
between a PRD and a merged change: ambiguous intent, changing architecture, weak
acceptance tests, context drift, cumulative regressions, credential leakage,
interrupted side effects, noisy review, and artifacts that cannot be
reconstructed later.

Mill makes those boundaries explicit:

- approved outcomes, invariants, scenarios, impacts, and tasks are versioned in
  Git;
- each run is bound to an exact base, authority closure, worker profile, budget,
  candidate commit, validation result, and review result;
- product code remains independently buildable and testable without Mill;
- the builder cannot push, merge, deploy, or rewrite the oracle that certifies
  its own candidate;
- GitHub mutations are separately planned, approved, journaled, and reconciled;
- one complete review is repaired systemically instead of creating micro-PR
  churn;
- longitudinal qualification proves that accepted behavior survives a sequence
  of dependent changes, not just one isolated demo;
- releases preserve and publish one independently reproduced tarball rather than
  rebuilding at publication time.

This is the differentiator: Mill is not another chat UI or general coding
harness. It is the small, inspectable delivery control plane around the coding
agent you already use.

## What it can do

For its one qualified shape, Mill can:

1. inspect a PRD, source manifest, structured product proposal, and repository
   without executing repository code;
2. freeze an approved product contract, stable invariants, scenarios, and
   per-change impact;
3. create a repository from the bundled web recipe or plan a compatible adoption
   without overwriting existing truth;
4. prepare exact npm dependencies as a separate attended network effect;
5. run one approved task through Codex build, OCI validation, exact-candidate
   review, and one bounded repair generation;
6. plan and open one draft GitHub PR through the operator's own `gh` session;
7. observe exact-head CI and review, then record human merge and resulting-main
   closure;
8. back up, restore, purge, reconcile, cancel, detach, and export a redacted
   support bundle through explicit commands;
9. audit the exact repository candidate and validate a public-alpha
   qualification record.

Mill does not autonomously research the web or invent a product specification in
this alpha. The operator supplies the structured proposal that Mill assesses and
freezes.

## Supported shape

The first recipe is intentionally exact:

- Node.js 24.18.1 and npm 11.16.0 inside the verifier image;
- TypeScript 6.0.3;
- Next.js 16.3.4 and React 19.2.8;
- Playwright 1.62.1;
- GitHub as the only forge;
- Codex CLI with the operator's existing login;
- Docker-compatible OCI verification;
- macOS arm64 as the first candidate host tuple.

Mill itself is developed with Node.js 24.20.0 and npm 11.19.0. Exact support is
published in release qualification evidence, not inferred from nearby versions.
All other stacks, operating systems, architectures, forges, models, and worker
harnesses are experimental or unsupported until independently qualified.

## Install

Install the qualified public alpha at its exact version with lifecycle scripts
disabled:

```sh
npm install --save-dev --ignore-scripts @davidahmann/mill@0.1.5
npx --no-install millctl --version
```

To develop Mill itself from a clean source checkout:

```sh
git clone https://github.com/davidahmann/mill.git
cd mill
asdf install
node_bin_dir=$(dirname "$(asdf which node)")
PATH="$node_bin_dir:$PATH" "$node_bin_dir/npm" ci --ignore-scripts
PATH="$node_bin_dir:$PATH" "$node_bin_dir/npm" run check
PATH="$node_bin_dir:$PATH" "$node_bin_dir/npm" run build
node dist/cli.js --version
```

The `alpha` and `latest` npm tags currently resolve to `0.1.5`. Downstream
repositories should still pin the exact version so a later release cannot alter
their delivery machinery implicitly.

## Quick start

Start with read-only readiness. These commands do not execute repository code:

```sh
node dist/cli.js doctor --mode inspect
node dist/cli.js inspect --prd product/PRD.md
node dist/cli.js adopt --scan-only
```

For a source-backed specification, supply the PRD, source manifest, and
structured proposal:

```sh
millctl --json plan specification \
  --prd product/PRD.md \
  --sources product/sources.yaml \
  --proposal product/proposal.yaml
```

Review the returned contradictions, assumptions, questions, and exact proposal
digest. Approval freezes that proposal; it does not grant repository writes.

### Create a repository

Preview the exact file plan first, then apply the same plan attended:

```sh
millctl --json new my-product --dry-run \
  --prd product/PRD.md --sources product/sources.yaml \
  --proposal product/proposal.yaml --approve-product sha256:<product> \
  --repository-id <uuid> --approved-by <identity> \
  --approved-at <iso-time> --author-name <name> --author-email <email>

millctl --json new my-product --apply --attended \
  --prd product/PRD.md --sources product/sources.yaml \
  --proposal product/proposal.yaml --approve-product sha256:<product> \
  --approve-plan sha256:<integration-plan> --repository-id <uuid> \
  --approved-by <identity> --approved-at <iso-time> \
  --author-name <name> --author-email <email>
```

Greenfield apply stages and runs the complete native recipe gate before the
target becomes a Git repository. It never replaces an existing path.

### Adopt a compatible repository

Use the same two-step boundary with `adopt --plan` and then
`adopt --apply --attended`. Adoption supports only the exact recipe-compatible
Node/Next.js shape. It keeps the operator checkout unchanged, writes an isolated
branch, and blocks on conflicting product truth, drifted native oracle files,
unsafe Git state, symlinks, credential-like files, or incompatible versions.

Prepare dependencies separately because it is the only recipe step that needs
registry network access:

```sh
millctl --json dependencies prepare --attended
```

Later verification has no network and receives read-only source.

### Deliver one approved task

The downstream repository owns `mill.yaml`, `product/contract.yaml`,
`quality/scenarios.yaml`, an approved impact manifest, and a version 2 task.
Qualify the unchanged base, then use the returned digest once:

```sh
millctl --json qualify --baseline --task product/tasks/TASK.yaml
millctl --json run --task product/tasks/TASK.yaml \
  --approve sha256:<baseline-approval> --attended
millctl --json verify --task product/tasks/TASK.yaml --run <run-id>
millctl --json review --task product/tasks/TASK.yaml --run <run-id>
```

The shorter resumable path is:

```sh
millctl --json start --prd product/PRD.md --attended
```

`millctl start` selects exactly one approved ready outcome or resumes its sole
existing lifecycle. It checks authority before dependency or model spend.

### Open a reviewed draft PR

Raise `trustCeiling` to `propose` only after configuring the exact GitHub
repository node ID, branch, allowed operator and merger, checks, review policy,
and approval TTL in `mill.yaml`.

```sh
millctl --json pr plan --task product/tasks/TASK.yaml --run <run-id>
millctl --json pr open --task product/tasks/TASK.yaml --run <run-id> \
  --approve sha256:<delivery-plan> --attended
millctl --json pr observe --task product/tasks/TASK.yaml --run <run-id>
# A human marks ready and merges in GitHub.
millctl --json pr finalize --task product/tasks/TASK.yaml --run <run-id>
```

Or use `millctl ship --draft` twice: first to return the proposal, then with its
exact digest and `--attended` to perform it. `millctl` never marks ready or
merges.

## Trust model

Mill separates four principals:

| Principal        | May do                                             | Cannot do                                          |
| ---------------- | -------------------------------------------------- | -------------------------------------------------- |
| Builder          | Edit approved paths in a disposable worktree       | Push, merge, deploy, change authority or oracles   |
| Verifier         | Run declared commands in bounded no-network OCI    | Write candidate source or use forge credentials    |
| Reviewer         | Read the exact committed candidate                 | Execute or edit code                               |
| Attended shipper | Push the unchanged candidate and open its draft PR | Change the candidate, mark ready, merge, or deploy |

Codex uses your existing Codex CLI session and therefore your own provider
billing. GitHub operations use your existing `gh` session. Another maintainer
can clone Mill and use their own Codex and GitHub accounts after the downstream
repo explicitly allows their identity. Mill stores neither credential.

The Codex worker runs on the trusted host with a workspace-write sandbox. This
is not containment against hostile code, host files, keychains, processes, or
network access. Native candidate verification is the stronger boundary: a
pre-pulled digest-pinned OCI image, no network, read-only source/root, dropped
capabilities, deadlines, bounded output and resources, and explicit cleanup. Do
not use this alpha with hostile repositories or sensitive source.

## Recovery

Every run has durable state and an append-only event history. If a controller is
interrupted, inspect before acting:

```sh
millctl --json status --run <run-id>
millctl --json resume --task product/tasks/TASK.yaml --run <run-id> --attended
millctl --json cancel --run <run-id>
millctl --json pr reconcile --task product/tasks/TASK.yaml --run <run-id>
```

Mill never signals a process solely from a stored PID and never retries an
uncertain external effect without authoritative readback. Use explicit local
recovery for state and diagnostics:

```sh
millctl --json state backup --output /absolute/path/backup.sqlite
millctl --json state restore --input /absolute/path/backup.sqlite --attended
millctl --json state purge --attended
millctl --json support-bundle --output /absolute/path/support.json
millctl --json detach plan
```

Restore validates the database before atomic replacement and quarantines newer
unreferenced worktrees. Detach is plan-only; the operator performs the reviewed
removal. A generated/adopted repo must continue to build and test natively after
Mill is removed.

## Audit and qualification

`millctl audit` is a bounded, read-only milestone check for Mill's selected
recipe and release path. It requires a clean exact Git candidate and reports
product, code, UX, accessibility, security, dependency, architecture,
operations, and release checks in a schema-valid JSON envelope.

```sh
millctl --json --cwd . audit
millctl --json --cwd . qualify public-alpha \
  --file /absolute/path/qualification.json
```

Public-alpha qualification requires at least five dependent accepted changes,
item-level new-behavior and preservation evidence, a rejected and recovered
seeded-fault branch, a current exact support tuple, every required packed and
integration canary, and all nine audits. A later success cannot conceal an
earlier unresolved preservation failure.

The one-time genesis release additionally requires two independent clean builds
from the exact annotated tag, canonical content equality, a preserved tarball,
SBOM, trusted npm OIDC publication, provenance, registry reinstallation, and
GitHub Release readback. See [the release runbook](docs/release.md).

## Troubleshooting

- `WRONG_MILL_VERSION`: run the exact package version in `mill.lock`; Mill does
  not silently delegate to another version.
- `BASE_REF_DRIFT` or context drift: stop, review the new repository state, and
  requalify. Never reuse the old approval digest.
- missing OCI image: pull the exact digest explicitly outside Mill, then rerun
  readiness. Mill never pulls implicitly.
- provider login failure: run `codex login` as the operator; do not pass a token
  through the task or repository.
- GitHub identity or destination mismatch: correct `mill.yaml` or log in with
  the explicitly allowed `gh` identity. Do not weaken the binding.
- `effect_unknown`: run read-only reconciliation. Do not retry push or PR
  creation until absence or success is authoritative.
- active-run conflict: resume or safely terminalize the existing run; do not
  start a second writer.

Use [GitHub Issues](https://github.com/davidahmann/mill/issues) for reproducible
defects and private vulnerability reporting for security issues. Support is
best-effort with no SLA.

## Limitations

- local and attended only;
- one repository, outcome, and writer at a time;
- one exact web recipe and compatible adoption shape;
- operator-supplied structured proposal, not autonomous planning research;
- Codex and GitHub through the operator's existing sessions;
- no hostile-host containment for the coding agent;
- no daemon, hosted control plane, scheduler, fleet, or parallel agents;
- no automatic readiness, merge, deployment, repository provisioning, or issue
  synchronization;
- no general migration engine, automatic upgrade/rollback, or automatic detach;
- no self-improvement loop or model-authored acceptance authority.

For system detail, read the [product requirements](product/PRD.md),
[architecture](architecture/ARCHITECTURE.md),
[development guide](docs/development.md), [workflow](WORKFLOW.md), and
[agent operating contract](AGENTS.md).
