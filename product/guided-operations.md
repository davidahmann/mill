# Guided operations increment

Status: proposed for v0.6.0 on 2026-09-15

Mill needs a shorter route from inspected repository material to a reviewed
draft PR while keeping the existing approval and evidence boundaries. This
increment adds that route and closes the practical gaps found in the v0.5.0
candidate release preparation.

## Accepted scope

1. Add `init propose`, a read-only command that combines existing inspected
   planning drafts into one review summary. It must not create authority files,
   approve a proposal, run a model, or perform a delivery effect.
2. Add an optional attended shipper credential reference. The configuration may
   name only `MILL_GITHUB_TOKEN`; the token bytes remain outside configuration,
   state, prompts, logs, and support output.
3. Add `millctl report` alongside `stats`. It must report redacted lifecycle,
   verification, elapsed-time, and recorded-usage aggregates. A self-hosting
   rate is enabled only by repository-local configuration and counts managed
   runs, not customer or engineering value.
4. Keep one repair generation as the default. Add one fixture-only task shape
   with exactly two repair generations and prove validation and review run after
   every repaired candidate.
5. Make the packaged public interface CLI and JSON schemas only. Verify that an
   installed package rejects its package-root JavaScript import.
6. Correct release qualification-input encoding before a fresh v0.6.0 candidate.
   Preserve the immutable v0.5.0 failed candidate rather than retrying or
   retagging it.
7. Rewrite the changed public and operator documents in direct language. Keep
   limitations near the features they constrain and maintain the README's
   limitations section.

## Boundaries

This increment does not add a GitHub App, create a token, verify token scope,
add a second model, use GitHub merge queue as a replacement for delivery
readback, raise repair limits generally, auto-renew qualifications, add a
daemon, add parallel writers, add a central MCP service, or widen the public
support matrix.

## Evidence required

- Focused regression tests cover no-write proposal assembly, token absence and
  forwarding, redacted reports, package exports, workflow-input validation, and
  the two-repair fixture.
- The full native check, generated schemas, packed-package check, and exact
  candidate audit pass.
- Required GitHub checks and review feedback pass or are resolved on the full
  pull request.
- A new annotated v0.6.0 tag, two independent builds, qualification, protected
  publication, and npm/GitHub readback bind to one preserved artifact.
