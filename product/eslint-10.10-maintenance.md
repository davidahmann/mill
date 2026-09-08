# ESLint 10.10 maintenance and v0.3.1 documentation

## Authorization

David Ahmann authorized this maintenance task in the attended Codex conversation
on 2026-09-08 by asking to "also check pr33" and to "also update docs in new pr
to use new version while doing pr 33." The prior attended release authorization
covers v0.3.1 publication and channel promotion only; this task is a separate
source maintenance pull request and creates no release identity or external
package effect.

## Scope

The task reconstructs Dependabot PR #33's direct development dependency update
from ESLint 10.9.1 to 10.10.0 on current main, preserving the lockfile's exact
resolution. It also updates live public documentation to identify v0.3.1 as the
current qualified alpha and npm alpha/latest version. Historical release
records, immutable tags, published package contents, release evidence, and
support-tuple evidence remain unchanged.

## Delivery boundary

The pull request must use a maintainer-authored DCO-signed commit because the
Dependabot commit's sign-off identity does not satisfy this repository's DCO
check. Validate the reconstructed candidate with the native full check and
exact-candidate audit, review the complete diff, and require green PR checks. Do
not tag, publish, change npm distribution channels, modify the GitHub release,
or alter GitHub environment policy.
