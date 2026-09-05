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
`requiredChecks`; omitting it requires the full PR list after merge too. The
maintainer-prepared [mill.yaml](../mill.yaml) now configures:

```yaml
# Fields under propose in the frozen configuration.
requiredChecks: [validate, dependency-review, codeql]
postMergeRequiredChecks: [validate, codeql]
```

New delivery plans bind both effective lists to exact approval and persist the
policy source as `configured` or `implicit_default`. A skipped required check
fails its phase; missing and pending checks prevent completion. Keep all three
PR requirements in branch protection. This resulting-main policy changes no
workflow event or branch-protection setting.

Historical merged deliveries have the bounded local binding described in the
[development guide](development.md#delivery-check-contract). The prepared
migration additionally covers a full defaulted list without policy provenance,
only when the exact reviewed candidate proves the optional field was omitted. It
requires authoritative merge, identity and tree readback, unchanged original PR
requirements, and a nonempty subset drawn from those requirements. It grants no
remote mutation or human merge authority. The
[migration record](canaries/post-merge-default-policy-migration.md) documents
the conditions for delivery `01801a1b-58f9-480f-8cee-54ea2bbeabb2`; it does not
claim live closure. The earlier
[check-contract canary](canaries/post-merge-check-contract.md) retains the
historical configuration and blocker as evidence of the preceding task.

## Publication settings

The publication boundary is configured as follows:

- the protected GitHub environment `npm` requires David's approval and permits
  only branch `main` and exact tag `v0.2.1` through selected branch/tag rules;
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

The exact-tag rule was separately owner-approved on 2026-09-05. The prior
protected-branches-only policy did not match the routine runbook's tag-ref
dispatch. Provider readback verified exactly the two permitted refs, unchanged
reviewer requirements and unchanged main branch protection. This is an
environment admission change, not a protection bypass or an npm token grant.
Future release tags require their own explicit policy authorization; do not
replace the exact tag rule with a wildcard or an unrestricted environment.

## Current distribution channels

As of 2026-09-05, npm `alpha` and `latest` both select `0.2.1`, and GitHub
Latest selects public release ID `383198362`. The owner separately approved each
promotion. The duplicate workflow draft `383199322` remains untouched; release
automation must not confuse its tag with the public release identity during
recovery. See [release evidence](releases/v0.2.1.md). Channel labels do not
expand Mill's qualified public-alpha support tuple or authorize republishing.
