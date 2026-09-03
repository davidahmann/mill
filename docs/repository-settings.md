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

Before the genesis publication run:

- create a protected GitHub environment named `npm` with David as the required
  approver and tag/branch restrictions appropriate to immutable releases;
- configure npm trusted publishing for package `@davidahmann/mill`, repository
  `davidahmann/mill`, and workflow `.github/workflows/release.yml`;
- require passkey or 2FA on the npm maintainer account and store recovery codes
  offline;
- keep GitHub Actions artifact retention long enough for the seven-day
  candidate-to-publish window;
- keep release/tag mutation limited to the maintainer and never store an npm
  token in GitHub, the repository, or a task packet;
- preserve published tags and releases. Withdrawal deprecates the npm version
  and publishes an advisory instead of moving identities.

The release workflow's candidate phase has read-only repository permission. The
publish phase alone receives `id-token: write` and `contents: write`, inside the
protected environment. Fork jobs never supply artifacts or credentials to that
phase.
