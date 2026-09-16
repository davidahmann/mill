# Local delivery statistics

`millctl --json stats` reads the current repository's local Mill state. It is
for finding a stalled lifecycle stage or deciding where a repair budget needs
attention.

```sh
millctl --json stats
```

The command opens state read-only. With no state it reports an empty aggregate.
With an older supported state it stops with an upgrade-required error instead of
recording a migration while answering a diagnostic request. Use an attended
mutating command to perform the guarded upgrade and retain its backup.

The response includes the state schema version, applied migrations, runs by
lifecycle status, builder attempts, and completed repair waves. It excludes task
IDs, paths, prompts, credentials, command output, review data, delivery
receipts, and event payloads.

Use the result as an operating signal, not a productivity score. A higher repair
count may reflect a harder change, weak acceptance cases, or a runtime failure.
Inspect the affected [timeline](run-timeline.md) and [outcome](run-outcome.md)
before changing policy. The default task schema keeps one repair wave. A task
may opt into two waves only through its named fixture-only experiment; every
repaired candidate still receives fresh validation and review.

For the declared change denominator and maintainer-entered effort measurements,
use [`report`](report.md).
