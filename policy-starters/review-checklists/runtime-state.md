# Runtime and state review

- Check every state transition and event write for one transactional outcome.
- Check restart, cancellation, timeout, and ambiguous process-exit paths.
- Reject authority inferred from mutable worktree state or unbound provider
  data.
- Check schema compatibility, migration behavior, and old-record parsing.
- Check path, process, and concurrency boundaries for fail-open behavior.
