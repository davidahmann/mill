# One recovery boundary for external effects

Status: approved design amendment, attended conversation on 2026-09-05. Owner:
David Ahmann. Scope: architecture follow-through AF-07, AF-08, AF-10.

The second independent review of `abd1e0e` found that merge uncertainty could be
bypassed through feedback, repair, cancellation and purge. Implementation
stopped under the recurring-P1 rule. The owner's subsequent approval authorizes
this return to design and a new coherent repair; it does not waive that rule or
the independent review and release gates. The same review found missing-task
supersession, partial authority purge recovery and resumed-usage gaps.

## Decision and sources of truth

### Approved systemic correction after review of 83d34b1

The owner's subsequent "fix systemically" request authorizes this correction
after review exposed unreachable interrupted-call recovery and task collisions.
Earlier green checks remain insufficient evidence, not promotion permission. The
same deterministic mechanism, owner, trust ceiling and release gates apply.

Blocking and recovery MUST share one typed journal classifier. Push/PR
`call_started` and `effect_unknown` are equally eligible for readback,
independent of enclosing run status. Missing, multiple, wrong-candidate or
merge-owned pending effects block draft reconciliation. Failed or conflicting
readback leaves the original journal intact; cancellation cannot erase it.

| Authoritative readback                | Atomic local settlement                             |
| ------------------------------------- | --------------------------------------------------- |
| Exact old branch / absent PR          | Retryable absent, or blocked at the attempt ceiling |
| Exact pushed candidate without PR     | Push verified; continue proposing                   |
| Exact candidate and matching draft PR | Effect verified; await CI                           |
| Unavailable, conflicting or ambiguous | No settlement and no retry                          |

Effect and run-status settlement MUST share one SQLite transaction, compare the
original journal bytes and recheck cancellation. This prevents another crash
between journal and status writes from recreating an unreachable state. Terminal
runs and pending cancellation cannot be resurrected. Readback never increments
attempts or calls a provider mutation. New effects still require the original
unexpired approval, fresh provider preconditions and the two-attempt ceiling.
`pr open` owns new effects only; `pr reconcile` exclusively owns interrupted
push/PR recovery. No event-name string grants settlement authority.

Compilation MUST reject existing generated task paths before approval, including
same-ID supersession. Apply recompiles under the writer lease before intent.
Require a fresh task ID and preserve old tasks and closed history. Exclusive
writes remain a final safeguard, not the primary collision detector.

Already-recorded failed local plans get an explicit attended abandonment path,
not an inferred successful apply or destructive rollback. `state abandon-plan`
binds the original plan digest and a clean exact commit on its recorded branch.
The operator first commits partial work they want retained. Abandonment
preserves the original plan and branch, never replays apply, and grants no task
or delivery authority. Only this verified terminal disposition permits later
purge, retaining the same branch/commit. Dirty worktrees, wrong branches, active
runs and unresolved effects block abandonment; backup/restore must preserve the
disposition.

Regressions cover push and PR hard interruption before invocation and after
provider success, absent/conflicting readback, outage, cancellation, mismatched
enclosing states, bounded retry and atomic settlement rollback. Compiler cases
cover same-ID supersession, unchanged old bytes, no intent on rejection, partial
old intents, attended abandonment, backup/restore and retained-branch purge.
These supplement the unchanged full native, OCI, package and independent review
gates; a new candidate cannot certify itself with only new tests.

Use deterministic typed policy over the existing durable journal, not a second
mutable recovery flag. Business-flow pattern: none; vertical profile: none;
horizontal foundation: none. This is an existing local CLI control boundary, not
a new agent or service. Field Guide ARC-002, STA-001/003, REL-003/005 and
HUM-002 inform the design; Mill's contracts remain authoritative.

The operator initiates effects under the existing repository/task approval. The
repository-scoped SQLite record owns local intent and candidate identity; GitHub
owns remote outcome. Git commits own retained authority bytes. Model context,
feedback and telemetry are non-authoritative. No new model calls, credentials,
network destinations or background work are introduced.

Derive unresolved effects from both the run status and delivery journal: push/PR
`call_started` or `effect_unknown`, and merge `ready_started`, `merge_started`
or `effect_unknown`. Parse the closed delivery schema; invalid records fail
closed. An enclosing status such as `blocked` or `cancelled` cannot erase a
nested effect. Confirmed merge also freezes the candidate until normal
post-merge finalization; it is not permission to repair an already merged PR.

| Operation                                     | Unresolved effect           | Confirmed merge before closure   |
| --------------------------------------------- | --------------------------- | -------------------------------- |
| Status, support, backup                       | Preserve and report         | Preserve and report              |
| Cancellation request                          | Record intent only          | Record intent only               |
| Observe feedback, repair, new plan/worker/run | Deny                        | Deny                             |
| Effect-specific reconciliation                | Authoritative readback only | Readback only                    |
| Finalize                                      | Reconcile first             | Existing exact merge/main checks |
| Purge or restore older state                  | Deny                        | Deny until closure               |

Apply the shared policy at public operation entry and state transitions that
could supersede evidence. Do not use event names as authorization. The existing
effect-specific reconciler is the only path that settles its journal; uncertain
readback never authorizes retry. Expired approval can still permit readback,
never a new effect. Cancellation continues to prevent later mutations.

## Recovery, integrity and evidence

Authority purge first retains its exact commit and durable intent. Recovery
after partial deletion verifies the retained branch and every remaining entry
against that commit (including file type/content and the worktree Git marker).
Missing entries are expected only after intent. Foreign, changed or linked
replacement content blocks deletion; the branch and journal remain available.
Deletion stays confined to the recorded disposable worktree, never the source.

Only absence of `product/plan.yaml` means no previous plan. A missing referenced
task is an integrity failure, not permission to discard prior or closed
outcomes. Usage includes resumed worker settlements and retains
partial/unavailable labels when admitted calls lack measurements; dollars are
never inferred from tokens.

Operational data are repository-local journals with exact identity and fresh
readback; knowledge inputs are unchanged approved task context; evaluation data
are frozen existing tests plus new negative regressions; telemetry uses measured
settlement events without private author metadata. No training use is added. The
owner retains backups and failed evidence until reconciliation and release
qualification permit cleanup. Malformed, stale or conflicting sources stop work.

Tests must exercise uncertain readiness and merge through feedback, resume,
cancellation, replanning, worker admission, purge and backup restore, then prove
matching readback permits the correct next step. Also test partial file and Git
marker deletion, foreign replacement rejection, missing superseded task with
closed history, and failed-attempt/resume/review usage aggregation.

Promotion remains full native checks, exact clean audit, offline OCI checks and
a fresh read-only complete-PR-diff review, followed by CI/main and the preserved
release artifact qualification. Passing regressions alone is not independent
release evidence. Support directs the operator to the effect-specific reconcile
command; no manual database edit is a supported recovery path. Rollback is a
corrective commit/version, never deletion of an unresolved journal or moved tag.
