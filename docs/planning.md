# From approved intent to tasks

Mill separates prose, approval and execution. `plan specification` assesses a
structured source-backed product proposal. `plan tasks` then compiles approved
product/scenario/impact authority into bounded executable packets. Neither
command invents an approved PRD, performs autonomous web research, or treats a
model-generated acceptance test as independent authority.

## Change request

Use `schemas/change-request.schema.json` as the exact contract. A request names:

- `kind`: `prd`, `plan`, `bug`, `review` or `maintenance`;
- one source `path` and its SHA-256 `digest`;
- approved `productPath`, `scenariosPath` and `policyPath`;
- one or more tasks with stable task/outcome IDs, approved `impactPath`,
  explicit allowed/context paths and outcome dependencies;
- one `readyOutcomeId`, DCO commit identity and bounded execution budget.

The compiler checks source freshness, configured native commands, impact
approval, product acceptance IDs, dependencies and cycles. A ready outcome
cannot depend on an unclosed outcome. Each acceptance item needs one explicit
repository-owned command selected by its scenarios. External or human oracles
require the expert task-packet path. Acceptance coverage is derived from those
scenarios, not asserted merely because a task compiled.

Allowed output cannot overlap authority, command controls or sensitive paths.
Existing closed outcomes are preserved; follow-up work needs a new outcome ID.
Unmentioned outcomes remain in the plan. Replacing a nonclosed outcome requires
`supersedesTaskDigest` matching its exact prior task-file bytes. Review that
supersession in the generated plan before approval; the old task is preserved.
The replacement must use a fresh task ID and output path. Compilation rejects
existing task paths with `CHANGE_OUTPUT_EXISTS`, before it offers an approval
digest or records apply intent; supersession does not authorize overwriting.

## Apply and execute

```sh
millctl --json plan tasks --request product/change.yaml
millctl --json plan tasks --request product/change.yaml --apply \
  --approve sha256:EXACT_PLAN --attended
```

The digest binds the clean base commit/tree, request, configuration and
generated file bytes. Apply creates a disposable worktree, never overwrites an
existing task, and leaves your checkout unchanged. Review and commit the
generated authority on that branch. Then run ordinary baseline qualification,
approved execution, native verification and read-only review for its selected
task. Compilation or committing authority does not grant model spend or
delivery.

`inspect` permits compilation only. Apply requires `build` or `propose` trust at
the exported runtime boundary, not merely an attended CLI flag.

## Recovery

Apply intent and exact generated-file digests are stored in repository SQLite
state and included in backups. A repeated apply is blocked, including after an
interruption. Preserve partially written worktrees; do not repair them by
blindly rerunning apply.

After committing the exact approved files:

```sh
millctl --json state reconcile-plans
```

Readback verifies the recorded repository, branch, clean commit and exact file
digests. It never writes Git files, approves a task or reruns a failed effect.
Purge blocks unresolved plans and rechecks committed worktrees before removal.
It journals each exact retained commit before deletion. After an interrupted
purge, an absent worktree is accepted only with that journal and matching Git
branch/file readback. Normal purge also checks every entry against the retained
commit: ignored or untracked foreign files block deletion, even if Git reports
the checkout clean. Missing intent or changed branch blocks cleanup; do not
erase the database to bypass recovery. Purge retains the committed Git branch.
Restore preserves referenced plan worktrees and quarantines newer unreferenced
ones. Back up and inspect recovery evidence before any manual disposition.

If a failed plan should not be completed, preserve its partial output in a clean
commit on its recorded branch, then explicitly abandon that exact plan:

```sh
millctl --json state abandon-plan --approve sha256:ORIGINAL_PLAN --attended
```

This records `abandoned`, not successful application or approved authority. It
does not commit, alter files, replay apply or remove the original plan. The
receipt binds the retained commit; backups retain the disposition. Purge can
later remove the disposable worktree only while that exact clean branch is
retained. Dirty or changed worktrees, a different branch, an active run or an
unresolved external effect block abandonment. Repeating abandonment is readback
only; repeating the original apply remains blocked. Use a newly reviewed plan
for further work. If the worktree was never created or its Git metadata is
missing, preserve the journal and restore its recorded worktree/branch identity
before disposition; Mill does not guess ownership or create a recovery branch.

## Evidence-based closure

After `pr finalize` closes the exact run from GitHub merge and resulting-main
evidence, use `plan close-outcome --task product/tasks/TASK.yaml --run RUN`.
Optional `--next OUTCOME_ID` selects one already approved, dependency-ready
successor. The returned proposal binds the current base/product/task, prior plan
and finalized delivery evidence. It does not mutate the plan or automatically
approve the next task. Review and commit this authority update through the
ordinary repository change path. A model statement, successful build or manually
toggled ready flag cannot supply closure evidence to this command.
