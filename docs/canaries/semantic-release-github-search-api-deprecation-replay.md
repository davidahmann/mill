# semantic-release/github Search API deprecation replay

Status: passed public historical engineering replay; it does not add a supported
customer stack, release qualification, or autonomous-maintenance claim.

## Question and boundary

This attended qualification asks whether Mill's experimental native-adoption
boundary can preserve an exact public Node ESM/npm repository, accept its native
test contract, and provide controlled context for a bounded maintenance task.
The task is governed by the [replay authority][authority], its [task][task] and
[impact manifest][impact].

The target was a disposable local copy of
[`semantic-release/github`](https://github.com/semantic-release/github). No
branch, issue, pull request, tag, release, package, deployment, credential, or
other external effect was created in that project or by Mill.

The evidence replays the endpoint deprecation notice recorded in
[upstream pull request #1037](https://github.com/semantic-release/github/pull/1037).
It is historical and public: a passing replay establishes a bounded engineering
signal, not customer demand or novel maintenance ability.

## Frozen input and blind candidate

On 2026-09-08, the frozen source was upstream commit
`6e2ac27ef2e2807a1d3af0962681aaac41218398`, tree
`610012a2de18fff73c4f474432f8ec016f36b402`. It is an MIT-licensed Node ESM
package with an npm v3 lockfile. The package declares Node
`^22.14.0 || >=24.3.0` and its native `npm test` command runs formatting,
package, engine, lockfile, unit, and integration checks.

The public upstream resolution was retained separately at
`b2b09e5f4d2c005118eb80f96f28e28f96eacf5d`. It was not present in the coding
candidate's fetched history and was not supplied to the coding agent. The agent
received only this problem statement: a GitHub endpoint deprecation notice
requires removal of runtime REST Search API consumption while preserving
existing GraphQL issue lookup and local tests. It was instructed to remain
local, avoid network and Git history access, and make no external effects.

After the candidate was complete, comparison showed the same relevant behavior:
the REST Search fallback is absent and the GraphQL path remains. The candidate
also removes the now-unused internal logger parameter and strengthens the
no-REST regression; those are implementation differences, not an upstream patch
copy.

## Mill adoption evidence

Before task execution, `adopt-native` accepted a local, untracked overlay that
declared one build-only `npm run test` command, the frozen npm lock, a
digest-pinned Node 22.14.0 OCI image, no verifier network, and explicit package,
lock, runtime, and test control paths. The clean-base plan reported:

- base commit `6e2ac27ef2e2807a1d3af0962681aaac41218398` and tree
  `610012a2de18fff73c4f474432f8ec016f36b402`;
- configuration digest
  `sha256:0b4daab4ed35c9f5bd596ec10d933ed72b5dc69260810c32e950846da77882c2`;
- native package digest
  `sha256:9a39869719bc63583dd325f4221664133658df8050724eb1150e1b6a472a5623`;
- native lock digest
  `sha256:fc14143e32f64e6930df9885405165a18f317948d46bdd288e8abaa575c29802`;
- source scan digest
  `sha256:53a57a3d0fa665df33f25214fe71b367fb570b0b27631d565b12b732024c936f`; and
- attended approval digest
  `sha256:146966d72a332e8484b1bef6859ad4d90cfb4aa64f194112d347ded152fd6916`.

The exact attended apply created only `mill.yaml` and `mill.lock` in Mill's
isolated state worktree. It did not alter the frozen upstream source, target
scripts, lockfile, tests, or dependencies. This is positive evidence for the
current Node ESM/npm onboarding boundary, not a claim that Mill executed the
maintenance task or isolated an arbitrary target repository.

## Independent acceptance evidence

The unmodified base first passed its full native `npm test` suite. The blind
candidate then:

1. removed `GET /search/issues` from the runtime lookup and all associated test
   fixtures;
2. retained the GraphQL issue query, filtering semantic-release issue markers
   and deduplicating by issue number;
3. passed the target's full native `npm test` suite, including 250 unit tests
   and 12 integration tests; and
4. passed a separate maintainer oracle that supplied an empty GraphQL response
   and a REST `request` stub that throws if called. The result was an empty
   array with no REST invocation. A static runtime search also found no
   `GET /search/issues` or `/search/issues` reference under `lib/`.

The target tests used mocked GitHub endpoints. They did not operate on GitHub.
The human maintainer inspected the candidate diff and checked that it contains
no task-wide source rewrite, dependency change, or target external effect.

## Result and limits

The replay passes its bounded question: Mill's current native-adoption planner
can bind this exact Node ESM/npm base to explicit local verification, while an
independent blind candidate can implement and demonstrate the specified API
deprecation change.

Mill did not itself discover the deprecation notice, parse an API compatibility
contract, select this repository, execute the candidate through a Mill run
lifecycle, approve business acceptance criteria, deploy, observe production
behavior, or share migration knowledge across private customers. The isolated
onboarding state is also not a security qualification for an arbitrary target.
Those gaps are the work required before Mill can serve as Telryn's maintenance
foundation.

The next evidence target should be a small TypeScript/Node business workflow
with owner-approved behavioral cases. A HubSpot V1 retirement case must first
prove actual V1 use; code already on Pipelines V3 is an unaffected control, not
an eligible migration.

[authority]: ../../product/oss-semantic-release-replay.md
[task]: ../../product/tasks/OSS_SEMANTIC_RELEASE_REPLAY.yaml
[impact]: ../../product/impacts/OSS_SEMANTIC_RELEASE_REPLAY.yaml
