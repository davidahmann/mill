# Brownfield delivery

Mill uses a bounded static map, native repository tests and explicit product
authority. A graph service is not required. The map answers where to look; it
cannot authorize changes or prove behavior.

## Context acquisition

Run `millctl --json discover /absolute/repository --changed src/service.ts` on a
clean Git root. Source bytes must match that exact tree. Local imports,
reverse-import leads and test inventory are derived evidence; dynamic imports,
external systems and unknown selectors remain explicit unknowns. Extraction is
bounded by traversal, file and aggregate source-byte limits.

Set `repositoryIntelligence: true` in a task or change request to include a
bounded map slice in builder/reviewer context. It carries the source commit, map
digest, extractor version, up to 24 relevant modules and omitted/unknown counts.
This is historical base context, not a current runtime trace. Native validation
and exact-candidate review remain mandatory.

`budget.maxContextBytes` limits supplied priority context, with an 8 MiB
default. It is not a filesystem read ACL or a provider token/currency ceiling.
Status reports provider-measured token totals where available, partial totals
when some calls lack usage, and unavailable currency costs rather than
estimates.

## Experimental native Node adoption

`adopt` retains the exact qualified web-recipe compatibility contract.
`adopt-native` is a separate experimental Node ESM/npm path. It requires:

- a clean safe Git root, ESM `package.json` and npm lockfile version 3;
- explicit build-only configuration with a pre-provisioned digest-pinned OCI
  image and separately configured lock-bound npm dependencies;
- required native test commands using exact `npm run SCRIPT` argument arrays;
- repository-owned `controlPaths` covering the package/lock and existing
  acceptance oracles relevant to those commands.

Mill does not infer complete oracle ownership from script names. The maintainer
must review the command closure. It must not blanket-freeze all source paths if
those same paths are intended builder output. Existing tests remain immutable;
additive regression tests may be explicitly approved output, but do not become
independent certification of their own implementation.

```sh
millctl --json adopt-native --config adoption.yaml
millctl --json adopt-native --config adoption.yaml --apply \
  --approve sha256:EXACT_PLAN --attended
```

Apply adds only `mill.yaml` and `mill.lock` in an isolated worktree. It does not
replace source, scripts, tests or dependencies and does not run target code.
Commit the controls, run `state reconcile-plans`, then explicitly prepare
dependencies and provide approved product/scenario/impact/task authority for
native baseline qualification and execution.

An incompatible original package manager requires a separately reviewed local
overlay, not a silent conversion or support claim. Qualification applies only to
the exact tested repository revision, commands, dependency lock, image and host.
Java, Python, arbitrary monorepos, external databases and enterprise network
integrations remain outside this native adoption boundary.
