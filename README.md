# Mill

Mill is an experimental local-first software-delivery system for turning an
approved product outcome into a tested, reviewed draft pull request.

The project is pre-alpha. Wave 1 provides an installable source package, compact
schemas, static PRD/repository inspection, and readiness diagnostics. The CLI is
`millctl`, published eventually as `@davidahmann/mill` to avoid collision with
the existing `mill` command and npm package.

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

## Develop from source

```sh
asdf install
npm ci --ignore-scripts
npm run check
npm run build
node dist/cli.js doctor --mode inspect
node dist/cli.js inspect --prd product/PRD.md
node dist/cli.js adopt --scan-only
```

Use `--json` before the command for the stable machine-readable envelope.
`doctor` and static adoption never execute repository-controlled commands.

## Status

Not published. No Codex execution, GitHub mutation, compatibility, containment,
or release claim exists until its corresponding later-wave canary passes.

## License

Apache-2.0. Contributions require a Developer Certificate of Origin sign-off.
