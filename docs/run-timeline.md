# Run timelines

`millctl timeline` projects one durable local run into a compact, read-only
event timeline:

```sh
millctl --json timeline --run <run-id>
```

It returns the run identity and status plus each event's sequence, timestamp,
type and any lifecycle transition. Event payloads stay local and are omitted.
The timeline checks that events are ordered, begin with `run.created`, follow
the allowed lifecycle edges, and end at the stored run status. A discrepancy
blocks the command with stable reason codes; it does not modify, resume, repair
or authorize the run.

Use `status` and `continuation` to choose an attended next step. Use a redacted
`support-bundle` for local diagnostic evidence after inspecting it for sensitive
material. A timeline is not telemetry, trace export, acceptance evidence or a
substitute for authoritative external-effect readback.
