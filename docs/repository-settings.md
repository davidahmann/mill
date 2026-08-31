# Repository settings

The repository is public and uses `main` as its protected default branch.

After the Wave 1 checks have run at least once, configure:

- pull requests required before merge;
- required status checks for the exact contexts produced by `validate`,
  `dependency-review`, and `codeql`;
- conversation resolution required;
- no force pushes or default-branch deletion;
- merge queue disabled initially;
- squash merge as the only merge method;
- automatic branch deletion after merge;
- zero required approving human reviews, because David is the sole maintainer;
- maintainer bypass allowed only for emergencies and recorded as repair/audit
  intake.

`CODEOWNERS` routes ownership but must not deadlock the sole maintainer. GitHub
Codex review is optional repository policy in v1; frozen local review and
required machine checks are portable and mandatory.

Release settings remain inactive until Wave 5: an `npm` environment with
maintainer approval and npm trusted-publisher binding must exist before the
first immutable release tag. No npm token is stored in GitHub.
