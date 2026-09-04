# Brownfield discovery intent

Status: approved source intent for one deterministic, read-only increment.

On 2026-09-04, David Ahmann authorized implementation of the previously proposed
brownfield plan, including local validation, exact-candidate review, and the
separately controlled delivery stages. This record promotes only the bounded
product intent below. It does not override `AGENTS.md`, `WORKFLOW.md`, or
`docs/release.md`: a draft-PR plan, human merge, tag, npm publication, and
GitHub Release still each require their own exact evidence and effect boundary.

## Outcome

Mill adds a deterministic TypeScript repository-intelligence command that reads
one clean exact Git source tree without executing repository code. It returns a
canonical, source-linked map of local module imports, test inventory, declared
test selection, and conservative importer leads for explicitly named changed
paths.

## Acceptance

1. Identical source, extractor version, and configuration produce identical
   canonical evidence with source locations.
2. A source commit/tree or extractor change makes prior evidence stale.
3. The reader is bounded and fail-closed for dirty sources, sensitive paths,
   symbolic links, truncated source, unsafe Git configuration, and unsafe
   changed paths. External and unresolved imports remain explicit.
4. Discovery is read-only: it does not execute repository code, install
   dependencies, call a model, mutate source, or grant delivery authority.
5. Change output gives direct and transitive importer leads with provenance. A
   path absent from the static map is an unknown, never proof of unaffectedness.
6. Test-file inventory, declared static selector, and executed coverage are
   distinct; executed coverage remains `unknown` in this static capability.
7. The installed Mill package exposes the same command and schema.
8. The external evaluation fixture is `typicode/json-server` at commit
   `89a34a44b7a6a5311dc84f3b8a1b8b45c0905aea`, tree
   `d305d02f13ab51efaa9af089c65881f276a5e97f`, under its MIT license. It is
   inspected only; it is not a supported runtime, dependency, vendored source,
   or productivity claim.

## Scope and non-goals

This increment is a deterministic local extractor using the TypeScript compiler
API. It is not a graph database, graph service, watcher, retrieval index,
model-generated domain map, arbitrary-stack adapter, dependency installer, or
autonomous delivery system. The map is derived evidence only and cannot skip a
native gate or approve a task, PR, merge, release, or external effect.
