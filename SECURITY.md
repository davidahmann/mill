# Security policy

Mill `0.1.0` is a public-alpha release candidate. Do not use it on hostile
repositories, production systems, or sensitive source. The coding worker runs
attended on the trusted host; its workspace sandbox does not prevent access to
unrelated host files, processes, keychains, or network. Native verification is
container-bounded, but Docker is not a security boundary against a malicious
host or privileged daemon.

Report vulnerabilities through GitHub private vulnerability reporting. Do not
open a public issue for an undisclosed vulnerability. David Ahmann coordinates
triage and disclosure on a best-effort basis with no response or remediation
SLA.

Mill stores neither Codex nor GitHub credentials. Codex and `gh` authenticate
through the operator's existing sessions. Credentials, `.env*`, `.npmrc`, raw
model streams, prompts, command output, local SQLite state, and temporary
worktrees must not enter task context, candidate commits, support bundles, or
release artifacts. Telemetry is off by default. Any model, research, registry,
or forge call must disclose provider, data class, and network effect before use.

The release workflow uses npm trusted publishing with GitHub OIDC and provenance
from a protected environment. No long-lived npm token is accepted. A release is
trusted only after exact-artifact registry and GitHub readback. Follow
`docs/release.md` for withdrawal and advisory handling.
