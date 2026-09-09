# Repository-owned playbooks

Mill playbooks are small, versioned repository files that supply operational
knowledge for one recurring job. They improve context selection; they never
become product, acceptance, delivery or merge authority.

Each repository keeps an index and one file per playbook. The index exposes only
compact metadata, so an operator or agent can search it before loading the
relevant file:

```sh
millctl playbooks list --index playbooks/index.yaml
millctl playbooks search --index playbooks/index.yaml --query "provider migration"
millctl playbooks show --index playbooks/index.yaml --id provider-api-adaptation
```

All three commands are read-only and do not execute repository code. `show`
verifies that the selected file's bytes match the index digest before returning
its content.

## Use in an approved task

An approved task selects playbooks by ID and pins the index bytes:

```yaml
playbooks:
  index:
    path: playbooks/index.yaml
    digest: sha256:<index-bytes>
  ids: [provider-api-adaptation]
```

At admission, Mill verifies the pinned index and each selected playbook's digest
and matching ID/kind. It adds only the index and selected files to the frozen
priority context and records the selection in the context manifest. A changed,
missing, duplicate or mismatched selection blocks. Selected files are immutable
runtime inputs and cannot overlap the builder's allowed output paths.

This is progressive selection, not a claim that Mill observes every filesystem
read by a coding agent. The index supports discovery; task selection is the
reviewable choice that enters an attended run.

## Shared knowledge and local approval

`shared_migration_knowledge` may describe a provider change, expected code
patterns, migration procedure, common failure cases and stop conditions.
`repository_procedure` may describe repository-local operational steps. Neither
kind can supply acceptance criteria. The approved task, product contract,
scenarios, impact manifest and repository-owned checks remain the authority for
what passes in one application.

Keep customer configurations, private data and acceptance criteria in the
customer repository. Reusable knowledge should state what needs investigation;
each application still supplies its own approved workflow and verification.

## Improving a playbook

After a run, an operator may propose a correction when the run exposes stale,
missing or unclear guidance. Make that proposal in a separate reviewable change
that cites the relevant run evidence without copying raw prompts, credentials or
customer data. Updating a playbook never repairs or recertifies the candidate
that discovered the problem; any new run requires a fresh task selection,
qualification and verification.

Mill does not provide an MCP server, centralized distribution, automatic
updates, background maintenance or autonomous playbook mutation. Those require a
separately approved integration and evidence that this repository-first form
improves accepted outcomes.
