# Mill contract schemas

These JSON Schema 2020-12 files define Mill's compact durable repository
contracts. Schema major `1` is fail-closed: unknown fields are rejected. YAML
documents use the same data model.

- `managed-repository.schema.json`
- `source-manifest.schema.json`
- `product-contract.schema.json`
- `specification-proposal.schema.json`
- `blueprint.schema.json`
- `scenario-set.schema.json`
- `outcome-plan.schema.json`
- `impact-manifest.schema.json`
- `mill-config.schema.json`
- `mill-lock.schema.json`
- `task-packet.schema.json`
- `context-manifest.schema.json`
- `worker-profile.schema.json`
- `worker-invocation.schema.json`
- `validation-evidence.schema.json`
- `review-result.schema.json`
- `delivery-record.schema.json`

Task packets are Git-owned approval contracts. Context manifests, validation
evidence, review results, and delivery records are schema-versioned operational
artifacts bound to an exact task/base/candidate and external-effect identity.
SQLite runs and events, credentials, prompts, raw model streams, and raw command
output are deliberately not repository contracts and are never accepted as
authority.

Task packet version `1` remains byte-stable for in-flight Wave 1-3 runs but
cannot start new work. Version `2` is the continuity contract: it requires an
approved impact manifest and explicit acceptance, invariant, scenario, coverage,
and evidence bindings. Every new run requires version `2`.

JSON Schemas are generated from the runtime Zod contracts in input mode. Run
`npm run schemas:generate` after an intentional contract change;
`npm run schemas:check` fails if committed JSON and runtime validation drift.
