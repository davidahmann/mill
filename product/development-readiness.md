# Generic development readiness

Status: approved implementation scope, 2026-09-14. Owner: David Ahmann.

## Authority

David Ahmann authorized this native-maintainer increment in the attended Codex
conversation on 2026-09-14: “ok execute the plan end to end test validate update
and rewrite the docs as per ai slop skill ship till green no release yet.” He
then narrowed the product context: “do telryn as genereic there willbe new
product.” This authorizes one reviewed source change to Mill. It does not
authorize a tag, npm publication, GitHub Release, deployment, provider or
customer-system action, telemetry export, centralized service, MCP server, or
automatic mutation.

## Outcome

Mill can carry a small amount of reusable operational knowledge and support a
strict generic pnpm workspace preparation shape without pretending that every
Node repository is qualified. Documentation work has a repository-owned guide,
an optional digest-pinned procedure, and a narrow local check. Downstream
Node/npm repositories can copy reviewed policy starters through their own review
process.

The implementation stays generic. It does not encode Telryn, Setrya, a provider
API, a customer configuration, or a new product's acceptance criteria.

## Acceptance

- DR-01 Human commits still require an author-matching DCO sign-off. A
  Dependabot exception passes only when a base-owned workflow verifies the bot
  identity, exact head, one verified commit, and the documented bot sign-off.
- DR-02 Changed documentation can use a repository-owned writing guide and
  digest-pinned procedure. The local check catches broken local links and a
  short list of stock phrases without claiming to certify truth or voice.
- DR-03 The packed package contains reviewable Node/npm policy starters for the
  writing check, DCO, Dependabot and agent instructions. They do not alter a
  downstream repository's settings or branch protection.
- DR-04 Experimental native adoption and dependency preparation accept one
  declared shallow pnpm workspace shape. The adapter binds the exact pnpm
  version, lockfile, workspace file, and direct workspace manifests. It rejects
  lifecycle scripts, native-build allowlists, hook files, and registry config.
- DR-05 originally recorded the pnpm path as source-only and unqualified. The
  later MREV OCI canary exercises one pinned shallow workspace. It does not
  claim broad workspace support, native dependency support, or a public-alpha
  expansion.
- DR-06 Native checks, generated-schema checks, the packed-package check, a
  clean audit, independent review, and required pull-request checks pass before
  any later merge decision. No release occurs.

## Deferred work

Artifact retention remains a separate design question. A command may need
bounded output collection only after a real qualification case establishes which
artifact is necessary, who can read it, and how it binds to a candidate. A
Docker-backed generic pnpm canary remains required before a support claim. The
target repository's owner must add the DCO status to branch protection through
its own reviewed settings; Mill does not mutate it.
