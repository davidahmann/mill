# Local review for maintainer and dependency changes

Use this route for a committed change that has no admitted Mill task, including
Dependabot updates. It runs the validation command you select, then invokes a
fresh Codex reviewer in read-only mode. P0/P1 findings block; P2/P3 findings
stay in the receipt as advisory. The operator still decides whether the selected
validation covers the change.

Run from a clean repository, with dependencies already prepared. Supply full
commit IDs. The base must be an ancestor of the candidate, and the candidate
must be the current HEAD. Store the receipt outside the repository.

```sh
node /path/to/mill/scripts/maintainer-review.mjs run \
  --base <full-base-commit> --head <full-candidate-commit> \
  --validation '["npm","run","check"]' \
  --receipt /private/review-evidence/candidate.json

node /path/to/mill/scripts/maintainer-review.mjs check \
  --base <full-base-commit> --head <full-candidate-commit> \
  --receipt /private/review-evidence/candidate.json
```

For an installed package, the script is at
`node_modules/@davidahmann/mill/scripts/maintainer-review.mjs`. Keep the same
script version for recording and checking a receipt. A changed script, base,
candidate, tree, or dirty checkout requires fresh evidence. The checker does not
fetch the provider base; the operator must supply its current exact commit.

The validation argument is an argv array, not a shell expression. It executes
with the operator's environment and authority. Choose the repository's native
checks, and do not put secrets in command arguments. Each command has a
30-minute timeout and a bounded output buffer. Failed or excessive output blocks
evidence creation; rerun the command directly to diagnose it. The receipt stores
a digest of validation stdout, not raw logs.

Codex uses its existing local login. Its process receives no standard GitHub or
npm token environment variables. Strict configuration and the read-only sandbox
reduce accidental mutation; they do not isolate a hostile host or remove
credentials stored elsewhere on that host. This route is for trusted maintainer
checkouts. It performs no push, PR, merge or release operation.

## Keeping review rounds bounded

Each receipt preserves the full finding list, candidate identity, subsystem and
blocking/advisory disposition. Keep earlier receipts when the candidate changes.
Review all P0/P1 findings together and make one coherent repair, then validate
and review the new exact candidate. If P0/P1 findings recur in the same
subsystem, stop and revisit its design and acceptance coverage before another
repair. The operator compares the receipts; the script does not infer semantic
equivalence or automatically decide that a subsystem has converged.

## What the receipt establishes

The checker detects missing fields, malformed findings, candidate drift and
inconsistent dispositions. It does not authenticate the author of a receipt: a
user with filesystem access can manufacture or edit local evidence. It is
neither an admitted Mill run receipt nor a trusted CI producer attestation.

Use it as an attended pre-push check for maintainer changes. Dependabot has
already pushed its branch, so review its exact candidate before merge. An
optional local hook can invoke the checker but can be bypassed. Enforcing this
policy on GitHub requires a separately trusted required-check producer; this
script does not install one or claim that ordinary Git pushes are intercepted.
