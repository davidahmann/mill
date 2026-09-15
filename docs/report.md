# Local outcome reports

`millctl --json report` returns a redacted operating summary for the current
repository. It reads local Mill state only. It does not run repository code,
contact a provider, create a run, or change a run.

The report groups runs by lifecycle status and validation result. It includes
total builder attempts, repair generations, elapsed wall time, and provider
usage only when completed worker events recorded measured values. Missing usage
remains `unavailable`; the command does not estimate tokens or cost.

```sh
millctl --json report
```

Set `reporting.selfHosted: true` in a repository's `mill.yaml` only when that
repository wants to count its own managed runs. The resulting completion rate is
closed runs divided by managed runs. It is a local process measure, not a claim
about engineering output, customer value, or other repositories. With the flag
absent, the self-hosting fields remain declared false and the rate is `null`.

The output excludes task IDs, file paths, authority digests, prompts, command
output, review text, delivery receipts, credentials, and event payloads. Use a
specific [timeline](run-timeline.md) or [outcome](run-outcome.md) when an
aggregate shows a problem.
