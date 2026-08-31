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

Operational runs, events, credentials, prompts, responses, and raw validation
evidence are deliberately not repository contracts.
