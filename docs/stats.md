# Local delivery statistics

`millctl --json stats` returns a redacted aggregate for the current repository's
Mill state. It is for a maintainer deciding where delivery is stalling or
whether a repair budget needs investigation.

Opening an older supported state records the required local schema migration
before the aggregate is read. The command does not create a run, change run
evidence, or perform a repository or remote effect.

The response includes the state schema version and named applied migrations, the
total number of runs grouped by lifecycle status, total builder attempts, and
completed repair waves. It does not include task IDs, paths, prompts,
credentials, command output, review data, delivery receipts, or event payloads.

```sh
millctl --json stats
```

Use the result as an operating signal, not a productivity score. A higher repair
count can reflect a harder change, a weak acceptance case, or a runtime failure.
Inspect the affected run's [timeline](run-timeline.md) and
[outcome](run-outcome.md) before changing policy. The current task schema keeps
one repair wave. A later increase needs fixture evidence and an explicit state
migration because the database enforces that limit.
