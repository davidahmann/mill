# Mill

Mill is an experimental local-first software-delivery system for turning an
approved product outcome into a tested, reviewed draft pull request.

The project is pre-alpha. Wave 1 provides the installable source package,
compact schemas, static PRD/repository inspection, and readiness diagnostics.
Wave 2 adds an attended local path from one explicit task approval to an exact
committed, OCI-validated, independently reviewed candidate. Wave 3 adds an
attended, exact-candidate path to one draft GitHub pull request, bounded
CI/review observation, human merge, and truthful closure. The CLI is `millctl`,
published eventually as `@davidahmann/mill` to avoid collision with the existing
`mill` command and npm package.

Wave 4A adds source-backed planning contracts, stable product invariants,
approved per-slice impact, scenario-specific semantic evidence, and durable
worker admission. Wave 4B adds one exact Node.js 24/Next.js 16 web recipe,
transactional greenfield and compatible-adoption integration, lock-bound
dependency preparation, offline read-only recipe verification, manual detach
planning, and resumable founder commands. Planning remains deliberately honest:
in this pre-alpha, an operator supplies the structured proposal that Mill
assesses and freezes; live autonomous research and proposal generation are not
implemented.

Mill's v1 boundary is deliberately narrow:

- local and attended;
- one repository and one writer at a time;
- the operator's own Codex and GitHub identities;
- deterministic native gates plus realistic scenarios;
- isolated-context local review before push;
- draft PR creation, with human readiness and merge;
- no daemon, auto-merge, deployment, or hosted control plane.

See [the PRD](product/PRD.md), [architecture](architecture/ARCHITECTURE.md), and
[development guide](docs/development.md).

## Develop from source

```sh
asdf install
npm ci --ignore-scripts
npm run check
npm run build
node dist/cli.js doctor --mode inspect
node dist/cli.js inspect --prd product/PRD.md
node dist/cli.js adopt --scan-only
```

## Onboard one supported repository

The first supported recipe is exact: Node.js 24.18.1, npm 11.16.0, Next.js
16.3.4, React 19.2.8, TypeScript 6.0.3, and Playwright 1.62.1 in a digest-pinned
OCI image. Mill itself uses Node.js 24.20.0; the recipe patches follow the
contents of its verifier image.

First run the read-only specification assessment and copy its exact approval
digest. Then preview a greenfield or adoption plan. Apply is a second explicit,
attended operation bound to that exact plan:

```sh
node dist/cli.js --json plan specification \
  --prd product/PRD.md --sources product/sources.yaml \
  --proposal product/proposal.yaml

node dist/cli.js --json new my-product --dry-run \
  --prd product/PRD.md --sources product/sources.yaml \
  --proposal product/proposal.yaml --approve-product sha256:<product> \
  --repository-id <uuid> --approved-by <identity> --approved-at <iso-time> \
  --author-name <name> --author-email <email>

node dist/cli.js --json new my-product --apply --attended \
  --prd product/PRD.md --sources product/sources.yaml \
  --proposal product/proposal.yaml --approve-product sha256:<product> \
  --approve-plan sha256:<integration-plan> --repository-id <uuid> \
  --approved-by <identity> --approved-at <iso-time> \
  --author-name <name> --author-email <email>
```

For an existing compatible repository, use `adopt --plan` and then
`adopt --apply --attended` with the same authority fields. Adoption supports
only the exact recipe-compatible Next.js tuple, blocks conflicting repository
truth, a missing or drifted recipe-native oracle closure, or unsafe Git state.
The adoption boundary compares the exact qualified dependency lock, runtime,
native scripts, and oracle bytes; existence alone is never compatibility. It
creates an isolated branch and leaves the operator checkout unchanged; arbitrary
existing test graphs are not inferred. Adoption also blocks symbolic links and
credential-like files, including `.npmrc`, rather than allowing generated writes
or builder context to follow them. The approved PRD must remain outside the
generated `app`, `public`, and `src` builder scopes. Greenfield apply stages the
complete target and, only after qualification succeeds, reserves the absent path
without replacement. It copies non-authoritative files first and atomically
installs the complete `.git` directory last; the target is not a repository
before that final boundary. The integration approval digest is a
non-self-referential identity over the approved target, including its
canonical-path digest, product, recipe, policy, and every non-lock file action.
`mill.lock` is deterministically derived from and records that same digest. An
approved blueprint selecting any other recipe, version, or runtime blocks. The
plan also exposes and binds the exact Mill generator package/version. Greenfield
paths are canonicalized beneath the selected root, and any symbolic link or
non-directory ancestor blocks before staging or registry access. Approval
timestamps must be exact ISO datetimes that are already active, never
future-dated declarations.

Dependency installation is a distinct attended step with disclosed npm-registry
network and disabled lifecycle scripts. The config declares npm and the exact
`https://registry.npmjs.org` origin; preparation rejects resolved lock entries
outside that HTTPS origin, credential-bearing or query-bearing URLs, entries
without a complete SHA-512 source identity, and unsupported links/workspaces.
The root `package-lock.json` consumed by `npm ci` must be included and is always
the lock graph validated, regardless of other bound locks. Mill copies lock
inputs first, keys and validates the frozen copies, and rechecks them after
installation before atomic publication. Its marker binds and revalidates the
installed dependency-tree bytes and filesystem shape before reuse and
verification. Cancellation stops the installer process group and completes
container cleanup. Preparation requires both attendance and build trust at the
exported runtime boundary. Later verification has no network and never writes
source:

```sh
node dist/cli.js --json dependencies prepare --attended
node dist/cli.js --json detach plan
```

`detach plan` reports Mill-only files to remove and downstream-owned files to
retain or review. It does not mutate the repository.

## Run one attended local task

A build-enabled downstream repository supplies `mill.yaml`, a task packet, and
the product/scenario/policy files whose digests the task binds. First qualify
the unchanged base and copy the returned `data.approvalDigest`; that digest is
issued only for a passing baseline and binds the exact base, task, repository
configuration, selected commands, and baseline evidence. Then approve and run
that exact qualified input set. Qualification is executable build authority: an
`inspect` trust ceiling rejects it before OCI discovery or command execution,
and interruption terminates the foreground verifier and completes cleanup:

```yaml
commands:
  test:
    argv: ["npm", "test"]
    cwd: "."
    controlPaths: ["package.json", "package-lock.json", "test/**"]
    capability: test
    required: true
    timeoutSeconds: 600
    execution: oci
```

```sh
node dist/cli.js --json qualify --baseline --task product/tasks/TASK.yaml
node dist/cli.js --json run --task product/tasks/TASK.yaml \
  --approve sha256:<digest-from-qualification> --attended
node dist/cli.js --json verify --task product/tasks/TASK.yaml --run <run-id>
node dist/cli.js --json review --task product/tasks/TASK.yaml --run <run-id>
node dist/cli.js --json status --run <run-id>
```

A managed repository may instead select exactly one ready outcome and use the
founder wrappers:

```sh
node dist/cli.js --json qualify --baseline \
  --task product/tasks/<outcome>.yaml
node dist/cli.js --json run next --approve sha256:<baseline> --attended
node dist/cli.js --json start --prd product/PRD.md --attended
node dist/cli.js --json ship --draft \
  --task product/tasks/<outcome>.yaml --run <run-id>
# Inspect the returned proposal, then:
node dist/cli.js --json ship --draft \
  --task product/tasks/<outcome>.yaml --run <run-id> \
  --approve sha256:<delivery-plan> --attended
```

`start` proves the selected PRD and task authority before registry or model
spend, including identical product-plan, product-contract, impact, and
acceptance sets. It inventories every nonterminal run, even when a newer run is
already terminal, then resumes the sole matching durable lifecycle. New-run
admission repeats that check under the writer lease that creates the run.
`run next` applies the same authority comparison before it can create a run.
With `--draft-pr`, `start` prepares and returns the exact draft-PR plan digest;
`ship --draft --approve` remains the separate attended mutation. A later `start`
can resume remote readback and closure without requiring Codex or repeating
dependency preparation. It still cannot mark ready, merge, or deploy. The expert
lifecycle commands remain available for inspection and recovery.

`run` creates the candidate on a Mill-owned branch in a disposable worktree; it
does not modify the operator checkout. `resume` reconciles an interrupted
controller only when no recorded execution can still be active, or performs the
one allowed review-repair pass. `cancel` records durable intent; the exact
foreground lease owner polls that intent and terminates its own in-memory child
group. Mill never signals a process from a persisted PID. Ambiguous orphaned
execution state fails closed for attended reconciliation. `state backup`,
`state restore`, `state purge`, and `support-bundle` provide explicit local
recovery and redacted diagnostics. The unchanged exact candidate may retry one
transient or invalid provider review; the durable per-candidate attempt budget
prevents an unbounded token loop while still allowing the one reviewed repair
generation.

## Open one attended draft pull request

The downstream repository must explicitly raise `trustCeiling` to `propose` and
bind its immutable GitHub repository node ID, target branch, accepted operators,
required checks, review policy, and allowed human merge methods. Mill reads the
live actor, repository, remote, and default branch before it returns an approval
digest. That plan performs no remote mutation. The separate `pr open` command
requires the exact unexpired digest and an attended operator:

```yaml
trustCeiling: propose
propose:
  forge: github
  host: github.com
  owner: example
  repository: app
  repositoryNodeId: R_kgDOExample
  remoteName: origin
  baseBranch: main
  branchPrefix: mill/
  allowedActors: [founder]
  allowedMergerLogins: [founder]
  requiredChecks: [validate, CodeQL]
  reviewPolicy:
    mode: local_only
    requiredReviewerLogins: []
  allowedMergeMethods: [linear_tree_preserving]
```

```sh
node dist/cli.js --json pr plan --task product/tasks/TASK.yaml --run <run-id>
node dist/cli.js --json pr open --task product/tasks/TASK.yaml --run <run-id> \
  --approve sha256:<digest-from-pr-plan> --attended
node dist/cli.js --json pr observe --task product/tasks/TASK.yaml --run <run-id>
# A human may mark ready; a configured merger merges in GitHub.
node dist/cli.js --json pr finalize --task product/tasks/TASK.yaml --run <run-id>
```

Only the shipper reads the operator-owned `gh` session. Builder and reviewer
processes receive neither GitHub credentials nor mutation tools. Mill journals
intent before push and PR creation, uses an expected-old-head lease, and reads
GitHub back before claiming an effect. An uncertain outcome becomes
`effect_unknown`; `pr reconcile` is read-only and must classify it before any
retry. Expired impact authority blocks a new remote mutation but does not block
readback, observation, or truthful finalization of an already attempted effect.
Exact readback proving absence authorizes one retry only while current mutation
authority remains valid; a second absent outcome blocks. Required checks pass
only when every latest exact-head result is successful. A configured
`github_required` reviewer may complete a current-head `APPROVED` or `COMMENTED`
review, but any current-head actionable finding still blocks, including a
severity-tagged top-level review body. Mill stops at `awaiting_human`; draft
readiness is not closure authority and Mill never changes it or merges.
Finalization verifies the recorded merger against `allowedMergerLogins`. Because
GitHub does not expose an authoritative distinction between a one-commit squash
and rebase, the provable policy is `linear_tree_preserving`; Mill never guesses
a specific linear method from its allowlist.

Use `--json` before the command for the stable machine-readable envelope.
`--json --version` is machine-readable; help is human-only and combining it with
`--json` returns a typed usage error. `doctor` and static adoption never execute
repository-controlled commands. Tool discovery accepts fixed system locations,
trusted non-repository `PATH` entries, the macOS ChatGPT-bundled Codex, and
explicit absolute `MILL_GIT_PATH`, `MILL_CODEX_PATH`, or `MILL_GH_PATH`
overrides. An explicit override is exclusive, and a relative, missing, or
unusable override blocks readiness rather than falling back silently. Static
adoption validates normal and linked-worktree Git metadata, inspects common and
worktree configuration, and blocks syntax it cannot classify without running
repository-controlled commands.

Codex build execution uses the operator's existing Codex login and provider
billing. It is attended trusted-host execution: the builder receives an explicit
`workspace-write` sandbox and `never` approval policy, so Mill cannot approve an
escalation request. Workspace scope is checked before promotion, but Mill does
not claim that the Codex process is isolated from the host, network, keychain,
or unrelated files. Repository validation is separate: selected commands run in
an already-present digest-pinned OCI image with no network, a read-only
container root, dropped capabilities, bounded resources, deadlines, and bounded
output. Mill never pulls the image implicitly. The candidate workspace is
mounted read-only and ignored builder artifacts are removed before
exact-candidate evidence is accepted. Each verifier command has a unique
Mill-owned container name, and Mill force-removes that exact container under a
fresh cleanup deadline before accepting evidence. Mill ignores operator Codex
configuration, disables host skill search, and ignores ambient execution rules
for builder/reviewer invocations; repository-local `AGENTS.override.md` or
`AGENTS.md` instructions still apply. Provider usage is measured when Codex
reports it, while currency cost is reported as unavailable rather than
estimated. Completion events in the redacted support bundle preserve that
source-qualified token evidence for the initial build, retries, repairs, and
review.

The builder can read the non-sensitive tracked files in its disposable worktree;
`contextPaths` are frozen, read-only priority inputs, not a filesystem read ACL.
They, `mill.yaml`, the active task, authority files, the frozen effective
repository-instruction set, and each selected command's declared `controlPaths`
cannot overlap task output scope or enter the candidate. `controlPaths` name the
scripts, tests, manifests, or other repository files that define the selected
command's acceptance oracle. Qualification therefore rejects tracked symlinks
and any tracked path matched by `sensitivePaths`. Keep secrets and other
excluded material untracked and outside the repository.

## Status

Not published. Local attended delivery and the bounded draft-PR lifecycle are
implemented, and the first disposable real-Codex/GitHub canary was human-merged,
verified on resulting main, and truthfully finalized. Product continuity, worker
admission, transactional application of one exact web recipe, compatible
adoption, and the resumable founder path are implemented. Autonomous planning,
stronger hostile-host worker containment, longitudinal qualification, genesis
release, and generalized stack-compatibility claims remain pending their
explicit gates.

## License

Apache-2.0. Contributions require a Developer Certificate of Origin sign-off.
