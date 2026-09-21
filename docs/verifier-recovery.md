# Recover verification of an unchanged candidate

A missing approved image can stop verification before any test runs. Pull that
exact digest explicitly and inspect the run's status and timeline. Mill never
pulls it during verification, and restoring it does not establish passing tests.

Recovery is available only for a committed candidate with an eligible
infrastructure failure and a valid `mill.lock` committed in that candidate.
Unpinned candidates cannot use this recovery route. The task, configuration,
frozen context, base, candidate commit and tree must still match. Failed tests,
changed files, cancellation, uncertain workers or containers, and delivery
effects require their existing reconciliation or disposition.

## One attended recovery window

The recovery plan retains the original deadline and grants one separate window
for verification and read-only review of the same candidate. Select an explicit
future ISO timestamp no more than the smaller of the task's original duration
and 1,200 seconds away. Use the same timestamp in both commands:

```sh
millctl --json verification-recovery plan --task product/tasks/TASK.yaml \
  --run <run-id> --expires-at <ISO-timestamp>
millctl --json verification-recovery apply --task product/tasks/TASK.yaml \
  --run <run-id> --expires-at <same-ISO-timestamp> \
  --approve sha256:<recovery-plan> --attended
millctl --json verify --task product/tasks/TASK.yaml --run <run-id>
millctl --json review --task product/tasks/TASK.yaml --run <run-id>
```

Inspect the exact plan before applying it. Every fresh recovery window requires
the original run deadline to have expired. This prevents an older controller
from using remaining worker authority. The approval binds the recorded failure,
immutable candidate pin, invoking checkout, authority and recovery controller. A
changed checkout pin blocks recovery. A newer controller can service only the
bound recovery operations; it does not silently upgrade the repository's tool.
Preserve its installed artifact and release evidence. Repin the downstream
repository through a reviewed change after the old run closes.

The recovery grants no builder, repair, new candidate or delivery approval.
P0/P1 findings stop a candidate-only allowance. Required test failures remain
failures. Another expired recovery window requires a new owner decision outside
this single-use mechanism; repeating the command cannot extend it.

## Historical failures

Older Mill versions could replace an infrastructure blocker with
`RUN_NOT_COMMITTED` after an invalid retry. Recovery examines the retained event
chain instead of trusting that latest code alone. It must prove the eligible
failure belongs to the current candidate and excludes intervening validation,
review, cancellation and external effects. Retain both original and rejected
command evidence. Never edit the database to manufacture eligibility.
