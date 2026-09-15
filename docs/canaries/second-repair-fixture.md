# Two-repair fixture experiment

This source-only fixture tests one narrow question: whether Mill can preserve
the normal validation and review gates across a second repair generation. It is
not evidence that a higher repair budget improves production outcomes.

The fixture task declares:

```yaml
repairExperiment:
  scope: fixture_only
  maximumRepairGenerations: 2
  evidenceLabel: two-review-repair-fixture
```

The first review finds a defect, the first repaired candidate is validated and
reviewed again, the second review finds a defect, and the second repaired
candidate is validated and reviewed again. The final review passes. The
regression test asserts all four gates and rejects a third repair.

Normal task packets still allow one repair generation. The experiment is a
bounded mechanism check. Before any broader repair policy, compare a
disposable-canary outcome against the default: accepted result, elapsed time,
review findings, token usage, and repair count. Keep the default when the second
repair only hides a recurring design or acceptance problem.
