# Public historical replay: semantic-release/github Search API deprecation

## Authority

David Ahmann authorized this attended-maintainer qualification in the Codex
conversation on 2026-09-08: “ok lets do it plan implement test validate fix any
gaps/bugs ship till green no new release though yet”, followed by confirmation
that the semantic-release/github historical replay is included after release
workflow hardening.

This is a public historical replay only. It may use a disposable local clone of
`semantic-release/github`, but it must not push to, open an issue or pull
request in, release from, or otherwise mutate that upstream repository. It must
not create a Mill tag, publish an npm package, or create a GitHub Release.

## Frozen public source

The replay uses the following public GitHub pull-request facts, read on
2026-09-08:

- upstream repository: `https://github.com/semantic-release/github`;
- change notice: GitHub Search API consumption is removed because the endpoint
  was deprecated;
- pull request: `https://github.com/semantic-release/github/pull/1037`;
- upstream base commit: `6e2ac27ef2e2807a1d3af0962681aaac41218398`;
- upstream implementation head: `b2b09e5f4d2c005118eb80f96f28e28f96eacf5d`.

The base repository is treated as the problem input. The implementation head is
comparison evidence only and must not be supplied to the coding agent.

## Acceptance boundary

The replay must prove only that a bounded Node ESM/npm repository can be
inspected, adoption-planned, changed in a disposable clone, and independently
verified for this historical change. It is not evidence of customer demand,
autonomous discovery, cross-tenant learning, application deployment, or broad
stack support.

The independent acceptance conditions are:

1. a Mill native-adoption plan accepts the clean exact upstream base under a
   frozen local overlay without changing upstream source or scripts;
2. the candidate removes runtime REST `GET /search/issues` consumption;
3. a GraphQL response with no semantic-release issue produces no REST Search
   request and an empty result; and
4. the upstream native test command passes on the candidate.

The human maintainer must review any candidate diff and record whether a source
change to Mill is necessary. Replaying the upstream patch, comparing against it
after the fact, or a green test suite alone does not establish novel
problem-solving ability.
