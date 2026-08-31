# Mill contract schemas

These JSON Schema 2020-12 files define Mill's compact durable repository
contracts. Schema major `1` is fail-closed: unknown fields are rejected. YAML
documents use the same data model.

- `managed-repository.schema.json`
- `product-contract.schema.json`
- `blueprint.schema.json`
- `scenario-set.schema.json`
- `outcome-plan.schema.json`
- `mill-config.schema.json`
- `mill-lock.schema.json`
- `task-packet.schema.json`
- `context-manifest.schema.json`
- `validation-evidence.schema.json`
- `review-result.schema.json`

Task packets are Git-owned approval contracts. Context manifests, validation
evidence, and review results are schema-versioned operational artifacts bound to
an exact task/base/candidate. SQLite runs and events, credentials, prompts, raw
model streams, and raw command output are deliberately not repository contracts
and are never accepted as authority.
