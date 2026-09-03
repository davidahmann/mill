# Support

Mill is public-alpha candidate software provided on a best-effort basis with no
SLA.

Use [GitHub Issues](https://github.com/davidahmann/mill/issues) for reproducible
defects and feature requests. Include the exact Mill version, support-tuple ID,
host/runtime versions, command, stable error code, and a minimal non-sensitive
reproduction. Use the redacted `millctl support-bundle` output when helpful, but
inspect it before sharing. Do not attach credentials, proprietary source, raw
model conversations, or local state databases.

Use GitHub private vulnerability reporting for security issues. Do not disclose
an unpatched vulnerability in a public issue.

Only combinations named `qualified` in evidence attached to a verified release
are supported. A checked-in `experimental` candidate tuple is not a support
claim. Everything else is experimental or unsupported. A mutable Codex worker
profile is requalified at release time, and qualification expires on the date
recorded in its tuple or immediately after a material harness, verifier, recipe,
or trust-boundary change.

Mill does not provide production incident response, hosted execution, account
recovery, or migration guarantees. Release withdrawal and reinstall guidance is
in `docs/release.md`; repository recovery and manual detach are in `README.md`.
