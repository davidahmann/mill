# Release channel security follow-through

## Authorization and scope

David Ahmann's attended release authorization on 2026-09-15 covers the qualified
`v0.6.0` artifact and its npm `latest` promotion. npm accepted the artifact
through trusted publishing but rejected the later dist-tag request with `EOTP`.
David directed Mill to account for npm's announced restriction of bypass-2FA
tokens.

This increment changes only the future release procedure: a fresh, qualified
artifact publishes directly to `latest` through the existing protected OIDC
workflow. It records the current `v0.6.0` provider state accurately. It does not
create a token, alter an existing npm channel, republish a version, change a
GitHub environment, or widen the support claim.

## Acceptance

1. The protected OIDC publish step names `latest` explicitly and reads that
   exact pointer back before release finalization.
2. Static workflow tests reject an `alpha` publication or missing `latest`
   readback.
3. Public and operator documentation distinguish a fresh OIDC publication from a
   later existing-tag correction and prohibit bypass-2FA tokens.
4. The source change passes the native gate and exact-candidate audit. A later
   fresh release must exercise the changed workflow before it becomes live
   release evidence.
