# Attended approvals

Draft-only remains the default. Opt-in merge is a trusted operator capability,
not a builder/reviewer tool, automatic merge, or a GitHub protection bypass.

## Configure the boundary

In `mill.yaml`, retain `trustCeiling: propose`, exact repository node identity,
allowed operator/merger identities, checks and merge methods. Set
`propose.attendedMerge: true`. Every required PR check must have a
`checkProducers` entry binding its GitHub App ID, workflow path, PR event and
resulting-main event. Example producer:

```yaml
checkProducers:
  validate:
    appId: 15368
    workflowPath: .github/workflows/ci.yml
    pullRequestEvent: pull_request
    postMergeEvent: push
```

Use the actual producer for your repository. A same-name status from another
App, workflow, event or head cannot satisfy this policy. Mill verifies Actions
job/run relationships through GitHub readback. Missing, pending, failed or
skipped required results do not pass. Strict up-to-date required checks must be
enabled in branch protection; Mill never configures protection itself.

## Plan, approve, verify

After a reviewed candidate reaches `awaiting_human`:

```sh
millctl --json pr merge-plan --task product/tasks/TASK.yaml --run RUN --method squash
millctl --json pr merge --task product/tasks/TASK.yaml --run RUN \
  --approve sha256:EXACT_PLAN --attended
millctl --json pr finalize --task product/tasks/TASK.yaml --run RUN
```

Inspect the displayed repository, PR, head, base, tree, actor, policy, expiry,
method and readiness action. `merge` and `squash` are the available request
methods; squash requires the existing `linear_tree_preserving` policy. The
operator is reauthenticated through the configured local `gh` session.

A trusted chat integration must authenticate its operator and obtain their
approval of this exact displayed plan before invoking the CLI. The local
`attended_operator` receipt is not a signed chat event, an identity federation
service, or proof that an arbitrary message was human-authored. Keep this
capability outside all model-controlled builder/reviewer tool bundles.

Mill rechecks policy, native validation, full-diff review, current GitHub
review, feedback and CI before effects. GitHub's merge API compares the exact PR
head; it does not offer an atomic base-SHA comparison. Strict branch protection
and fresh base checks constrain that race, and exact merged-tree readback is
still required. Do not interpret an API success as verified lifecycle closure.

## Interruptions

```sh
millctl --json status --run RUN
millctl --json pr merge-reconcile --task product/tasks/TASK.yaml --run RUN
```

Intent is durable before readiness and merge calls. Never rerun an uncertain
merge. Readback can establish an exact merged PR, authorized merger and matching
tree; `pr finalize` separately requires successful resulting-main checks.

If readiness succeeded but merge never started, reconciliation can establish
`ready_verified`; inspect and approve a fresh merge plan. If merge may have
started, an open PR alone is not proof that retry is safe. Preserve the receipt
and investigate GitHub state. Expiry prevents new effects, not readback.

## Public metadata and identity

PR titles use a sanitized first subject line, omit DCO/coauthor trailers, redact
email-shaped text and remove control characters. Routine status excludes raw
validation/review payloads. Private local evidence is still retained for repair
and audit; inspect support bundles before sharing.

Use your verified GitHub noreply address in repository-local Git author settings
and new task commit metadata. DCO sign-off remains in commits, not PR titles.
This does not erase email addresses from historical commits, old artifacts, task
packets or cached copies. Do not rewrite released history to hide them.
