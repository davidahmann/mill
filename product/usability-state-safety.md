# Usability and state-safety increment

Status: completed in PR #48 on 2026-09-15; v0.5.0 candidate failed before
publication and remains preserved evidence

Mill's approval boundaries and release evidence are useful only when a
maintainer can understand and operate them without recreating the internal
model. This increment improves the public route through an already approved
outcome, makes local state upgrades inspectable, and exposes aggregate local
evidence. It preserves the current authority boundary: an operator still
supplies authenticated Codex and GitHub sessions, and a person still approves
remote effects.

## Accepted scope

1. Make the existing `millctl start` route, planning boundaries, and public
   interface easier to find in the README. Add a compact glossary. Move the long
   greenfield planning history under `docs/history/` and repair references.
2. Replace the state store's implicit version update with numbered, idempotent
   SQLite migrations. Existing supported v1 and v2 state must open without
   losing run, event, qualification, invocation, or authority-plan records.
   Invalid and future versions must block before state is used.
3. Add a redacted `millctl stats` view for one repository's aggregate run,
   lifecycle, attempt, and repair counts. It may record a required supported
   local schema migration, but must not alter run evidence or disclose paths,
   prompts, credentials, raw command output, or event payloads.
4. Introduce a named worker-adapter registry while preserving `codex-cli` as the
   only supported adapter. Document that the trusted-host model boundary is not
   container isolation and document how an operator can use a scoped GitHub
   credential for attended delivery.
5. Add regression coverage for migration routes, stable CLI envelopes, canonical
   JSON, and repository-path safety. Keep the default one-repair limit; a larger
   limit requires a later measured fixture and a state-constraint migration.

## Boundaries

This increment does not create a GitHub App, token, central MCP service, second
model adapter, merge queue, daemon, event-sourced state engine, parallel worker
execution, automatic instruction update, or support-tuple renewal. It does not
claim restricted host credentials or model egress.

## Evidence

- Native Node 24 check, package inspection, generated schemas, and audit of the
  exact candidate pass.
- Tests cover new state and CLI behavior plus expected failure routes.
- Required PR checks and GitHub review feedback cover the full candidate diff
  before merge.
- The implementation task records the exact merge and test evidence before the
  separate release task begins.

The exact source change merged as `99c987040f3d81e07b01b96e459d8103ab340147`
after green validate, dependency review, DCO, and CodeQL checks. The local
exact-candidate audit, package canary, and 356-test coverage run also passed.
GitHub reported no review feedback on the exact head.

The v0.5.0 candidate's independent builds and packed canaries passed, but its
qualification input contained a literal `\n` after JSON and was rejected before
publication. No npm or GitHub Release effect occurred. A fresh v0.6.0 release
task owns the corrected release path.
