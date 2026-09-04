# Repository settings

The repository is public and uses `main` as its protected default branch.

After the Wave 1 checks have run at least once, configure:

- pull requests required before merge;
- required status checks for the exact contexts produced by `validate`,
  `dependency-review`, and `codeql`;
- conversation resolution required;
- no force pushes or default-branch deletion;
- merge queue disabled initially;
- squash merge as the only GitHub UI method; Mill records the independently
  provable result as `linear_tree_preserving` because one-commit squash and
  rebase are not distinguishable from post-merge topology alone;
- automatic branch deletion after merge;
- zero required approving human reviews, because David is the sole maintainer;
- maintainer bypass allowed only for emergencies and recorded as repair/audit
  intake.

`CODEOWNERS` routes ownership but must not deadlock the sole maintainer. GitHub
Codex review is optional repository policy in v1; frozen local review and
required machine checks are portable and mandatory.

## Check names and workflow events

Keep all three exact contexts in branch protection and `propose.requiredChecks`:
`validate`, `dependency-review`, and `codeql`. The frozen
[CI workflow](../.github/workflows/ci.yml) runs on pull requests and pushes to
`main`, but its `dependency-review` job is conditional on
`github.event_name == 'pull_request'`. That job reviews the PR dependency
change; it is skipped on a main push. `validate` runs in both phases, including
the production dependency audit. The
[CodeQL workflow](../.github/workflows/codeql.yml) also runs `codeql` on pull
requests and main pushes. Neither main-branch audit nor CodeQL removes the PR
dependency-review requirement.

The source implementation supports optional `propose.postMergeRequiredChecks`
for the resulting-main phase. It must be nonempty and a subset of
`requiredChecks`; omitting it requires the full PR list after merge too. A
future, separately approved policy change for this repository could set:

```yaml
# Proposed fields under propose; not the current frozen mill.yaml policy.
requiredChecks: [validate, dependency-review, codeql]
postMergeRequiredChecks: [validate, codeql]
```

The current [mill.yaml](../mill.yaml) remains a frozen runtime control and has
no `postMergeRequiredChecks` field. Do not apply the example during an approved
builder run or remove `dependency-review` from branch protection to bypass
closure. New delivery plans bind both effective lists to exact approval and
persist them. A skipped required check fails its phase; missing and pending
checks prevent completion.

A legacy merged delivery without the second list has only the bounded local
binding described in the
[development guide](development.md#delivery-check-contract). It requires
authoritative merge, identity and tree readback, unchanged original PR
requirements, and a subset drawn from those original requirements. It grants no
remote mutation or human merge authority. The
[canary record](canaries/post-merge-check-contract.md) explains why the current
policy still blocks closure and distinguishes regression fixtures from live
recovery evidence.

## Publication settings

The genesis publication boundary is configured as follows:

- the protected GitHub environment `npm` requires David's approval and permits
  deployment only from protected refs;
- npm trusted publishing binds package `@davidahmann/mill`, repository
  `davidahmann/mill`, workflow `release.yml`, and environment `npm`;
- require passkey or 2FA on the npm maintainer account and store recovery codes
  offline;
- keep GitHub Actions artifact retention long enough for the seven-day
  candidate-to-publish window;
- keep release/tag mutation limited to the maintainer and never store an npm
  token in GitHub, the repository, or a task packet. The one package-identity
  bootstrap used the maintainer's interactive 2FA session and stored no token;
- preserve published tags and releases. Withdrawal deprecates the npm version
  and publishes an advisory instead of moving identities.

The release workflow's candidate phase has read-only repository permission. The
publish phase alone receives `id-token: write` and `contents: write`, inside the
protected environment. Fork jobs never supply artifacts or credentials to that
phase.
