# Development evidence report

`millctl --json report` reads two local records. It reports durable run state
and, when `mill.yaml` declares `reporting.ledgerPath`, a maintainer-entered set
of development changes. It does not run repository code, contact a provider,
create a run, or change state.

```sh
millctl --json report
```

The run section groups lifecycle and validation facts. Its elapsed time is run
wall time. It is not a measure of human effort or productivity. Provider usage
appears only when the provider recorded it; unavailable usage remains `null` or
`unavailable`.

The `developmentEvidence` section uses the ledger as its denominator. Each
record states whether a change was eligible, whether it used Mill or a manual
route, why a manual route was used, its outcome, known human minutes, elapsed
time, repair count, and provider measurements when available. Eligible manual
and unsuccessful work stay in the count. A total for effort, elapsed time, or
usage is `null` unless every eligible record supplied that measurement. Mill
does not infer missing time, tokens, currency, customer value, or a productivity
rate.

For example:

```yaml
# mill.yaml
reporting:
  ledgerPath: quality/development-evidence-ledger.yaml
```

Keep the ledger in the repository so another maintainer can inspect its scope
and exclusions. It is an operating record, not a customer report. The command
does not expose task IDs, file paths, authority digests, prompts, command
output, review text, delivery receipts, credentials, or event payloads. Use a
specific [timeline](run-timeline.md), [outcome](run-outcome.md), or
[`artifacts` listing](development.md#retained-verifier-artifacts) when an
aggregate shows a problem.
