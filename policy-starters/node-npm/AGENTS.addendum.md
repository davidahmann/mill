# Documentation and dependency-maintenance addendum

Use the repository writing guide for changed prose. Freeze that guide and its
selected playbook before an agent writes or reviews documentation. Run the
native documentation check with the repository's normal validation commands.

Routine dependency updates still require a review of manifests, lockfiles,
scripts, workflows, permissions, and affected behavior. A Dependabot pull
request may use its verified `support@github.com` sign-off alias only when the
base-owned DCO workflow confirms the bot identity, exact head, verified commit,
and single-commit scope. Human commits always use an author-matching DCO
sign-off.
