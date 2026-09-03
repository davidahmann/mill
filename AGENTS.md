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

Release work follows `docs/release.md`. The `v0.1.3` genesis path requires an
annotated tag on the reviewed tree's resulting `main` commit, two independent
clean builds with equal canonical package contents, one preserved tarball,
longitudinal and packed-artifact qualification, a protected npm environment,
trusted OIDC publication, and npm/GitHub readback. Creating the tag, publishing
to npm, and creating the GitHub Release are separate human-authorized effects.

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
