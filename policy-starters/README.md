# Mill policy starters

These files help a Node/npm repository adopt Mill's documentation and routine
dependency-maintenance practices. They are examples, not an installer and not a
claim that branch protection or GitHub settings have changed.

Copy a starter only through a reviewed repository change. Keep its native
commands runnable when Mill is absent. Compare existing instructions, workflow
jobs, Dependabot settings, and branch-protection rules before copying anything.
Resolve conflicts in the target repository; do not overwrite local policy.

`node-npm/` contains an agent-contract addendum, documentation checker, DCO
workflow, DCO script, and Dependabot configuration. Its DCO workflow checks out
the pull request base before reading GitHub commit metadata, so it does not run
pull-request code with `pull_request_target` credentials. Add its `dco` status
to branch protection through the target repository's own reviewed settings.

Add `node scripts/check-docs.mjs` to the target repository's native validation
script. The starter detects local-link and stock-phrase mistakes; pair it with a
review of the changed prose and the technical source that supports each claim.
