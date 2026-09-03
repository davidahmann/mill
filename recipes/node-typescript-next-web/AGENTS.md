# Repository agent operating contract

This generated repository owns its product truth and remains operable without
Mill. A coding agent must read, in order:

1. this file;
2. `README.md`;
3. `product/PRD.md` and `product/contract.yaml`;
4. `quality/scenarios.yaml`;
5. `architecture/blueprint.yaml`;
6. `WORKFLOW.md`;
7. the active version 2 task and its approved impact manifest.

The approved product contract and stable invariants outrank the task. The task
and impact approval define what may change. Native command results and exact Git
identities decide promotion. Model output is only a proposal.

Change only paths granted by the active task. Do not edit the task, impact,
product, scenario, instruction, or command-control files and then use those
changes to certify the same candidate. Do not read or write `.env*`, `.npmrc`,
credentials, local Mill state, raw model logs, or unrelated host files.

Run the complete native gate before proposing delivery:

```sh
npm ci --ignore-scripts
npm run check
```

The gate includes format, lint, type, unit, integration, Accessibility and
browser behavior, build, and package checks. Required skipped evidence blocks.
Keep these commands authoritative even when Mill is absent.

Mill's builder may edit only the disposable worktree. It cannot push, merge,
deploy, broaden scope, approve escalation, or rewrite acceptance oracles. The
reviewer is read-only. Only the attended shipper may use the operator's GitHub
identity, and it may open only the exact verified candidate as a draft PR.

If execution is interrupted, inspect `millctl status` and use the documented
`resume`, `cancel`, or `pr reconcile` path. Never blindly replay a possibly
started worker or GitHub effect. Stop on drift, ambiguous authority, unknown
external effects, failing native checks, unsupported stack changes, or missing
credentials/provider disclosure. A human marks the PR ready, merges, and owns
deployment.
