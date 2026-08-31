# Mill

Mill is an experimental local-first software-delivery system for turning an
approved product outcome into a tested, reviewed draft pull request.

The project is pre-alpha. Today this repository contains the product and
architecture contract; implementation is being delivered through five vertical
waves. The intended CLI is `millctl`, published eventually as
`@davidahmann/mill` to avoid collision with the existing `mill` command and npm
package.

Mill's v1 boundary is deliberately narrow:

- local and attended;
- one repository and one writer at a time;
- the operator's own Codex and GitHub identities;
- deterministic native gates plus realistic scenarios;
- isolated-context local review before push;
- draft PR creation, with human readiness and merge;
- no daemon, auto-merge, deployment, or hosted control plane.

See [the PRD](product/PRD.md), [architecture](architecture/ARCHITECTURE.md), and
[development guide](docs/development.md).

## Status

Not yet installable. No compatibility, security, containment, or release claim
exists until its corresponding clean-room canary passes.

## License

Apache-2.0. Contributions require a Developer Certificate of Origin sign-off.

