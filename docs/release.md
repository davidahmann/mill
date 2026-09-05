# Release runbook

Mill releases are immutable evidence chains. A release is not qualified because
the source builds or a tag exists. The reviewed candidate tree, resulting `main`
tree, annotated tag, two independent builds, one preserved tarball,
qualification, SBOM, npm publication, and GitHub Release must agree.

Tag creation, npm publication, and GitHub Release creation are separate external
effects. Run a stage only after the maintainer explicitly authorizes it.

## Genesis release

`v0.1.5` completed the one-time bootstrap exception to the normal rule that
trusted release N qualifies candidate N+1. It is the first qualified public
alpha and trust root for future candidates. The remote `v0.1.0`, `v0.1.1`, and
`v0.1.2` tags are retained as failed prepublication evidence. Version `v0.1.0`
exposed GitHub `actions/checkout`'s inert `gc.auto=0` setting as an audit
compatibility gap. Version `v0.1.1` passed that audit and independent artifact
comparison, then its real Linux packed-artifact canary exposed root-owned
bind-mount output. Version `v0.1.2` passed the corrected full canary, then
qualification could not read generated evidence outside the repository safety
root. Version `v0.1.3` then stopped at identity verification because its
annotated tag omitted the required reviewed-tree trailer. None produced an npm
package or GitHub Release. Version `v0.1.4` passed complete candidate
qualification and its exact artifact was published under the npm `bootstrap` tag
using the maintainer's 2FA session, because npm requires an existing package
before trusted publishing can be configured. It has no CI provenance or GitHub
Release and is not the supported alpha. The package-specific trusted publisher
and protected GitHub `npm` environment now exist. Candidate run `33769558396`,
OIDC publish run `33770023370`, and the final npm and GitHub readbacks establish
the result. The publish run stopped after the successful immutable npm effect
when the new attestation endpoint briefly returned 404; the effect was not
replayed, and the same artifact completed signature, provenance,
registry-canary, and GitHub Release verification after propagation. The workflow
now retries signature readback within a fixed budget. The qualified path uses
GitHub-hosted clean builders outside the tagged checkout and the following
gates.

## Qualified release procedure

Use a fresh approved package version in place of `vX.Y.Z`. This procedure is for
new releases, never replay of an existing npm version. Genesis identities above
remain historical evidence.

### 1. Qualify the source candidate

Before tagging:

- merge the reviewed PR only after its required checks and exact-head review
  settle;
- add the reviewed, regular, non-symlink, nonempty `docs/releases/vX.Y.Z.md`
  record to the candidate before tagging; candidate builders require it
  immediately after immutable checkout, before any other workflow step;
- prove the reviewed candidate tree equals the resulting squash-merged `main`
  tree;
- run `npm run check` from a fresh checkout of resulting `main`;
- run `millctl --json --cwd . audit` on that clean exact commit;
- complete a five-or-more-step dependent canary in which every step starts from
  the prior accepted candidate;
- create a separate known-bad branch from accepted history, prove its
  preservation oracle fails, and return to the unchanged accepted base;
- record provider-measured usage when available and otherwise use explicit
  `null` values with source `unavailable`;
- record the exact support tuple. Only the environment actually exercised may
  move from `experimental` to `qualified`.

The longitudinal input has this top-level shape and is checked again by
`millctl qualify public-alpha`:

```json
{
  "steps": [
    {
      "id": "step-1",
      "dependsOn": [],
      "baseCommit": "<40-hex>",
      "candidateCommit": "<different-40-hex>",
      "status": "accepted",
      "newBehavior": { "requiredIds": ["A1"], "passedIds": ["A1"] },
      "preservation": { "requiredIds": ["I1"], "passedIds": ["I1"] },
      "scenarioIds": ["SCN-1"],
      "usage": {
        "inputTokens": null,
        "outputTokens": null,
        "currencyCost": null,
        "source": "unavailable"
      }
    }
  ],
  "seededFault": {
    "baseCommit": "<accepted-40-hex>",
    "candidateCommit": "<rejected-40-hex>",
    "status": "failed",
    "rejected": true,
    "recovered": true,
    "enteredAcceptedSequence": false,
    "reason": "<which independent oracle rejected it>"
  }
}
```

Five to twenty steps are required. Step IDs and candidate commits must be
unique. Every later step must depend on the immediately prior step and use that
step's candidate commit as its base. Required and passed sets must match
exactly.

### 2. Create the annotated tag

Recheck that the package version and intended tag match. Record the reviewed
candidate tree in exactly one annotated-tag trailer:

```sh
tag=vX.Y.Z
reviewed_tree=$(git rev-parse <reviewed-candidate>^{tree})
main_tree=$(git rev-parse origin/main^{tree})
test "$reviewed_tree" = "$main_tree"
git tag -a "$tag" origin/main \
  -m "Mill $tag" \
  -m "Reviewed-Candidate-Tree: $reviewed_tree"
MILL_RELEASE_TAG="$tag" node scripts/verify-release-tag.mjs
git push origin "refs/tags/$tag"
```

Do not move, recreate, or reuse a published tag or version.

### 3. Build and qualify the candidate

Encode the exact qualified support tuple and longitudinal record without line
breaks, then start the `candidate` workflow:

```sh
support_tuple_base64=$(base64 < /absolute/path/support-tuple.json | tr -d '\n')
sequence_base64=$(base64 < /absolute/path/sequence.json | tr -d '\n')
gh workflow run release.yml --ref "$tag" \
  -f mode=candidate \
  -f tag="$tag" \
  -f support_tuple_base64="$support_tuple_base64" \
  -f sequence_base64="$sequence_base64"
```

The workflow checks out the immutable tag twice, then immediately verifies a
regular, non-symlink, nonempty tag-bound release record before any other step.
It installs with lifecycle scripts disabled, verifies tag identity, runs the
full native gate, and packs once in each independent job. It safely extracts and
compares canonical package paths, executable bits, and bytes. Any symlink,
special entry, unsafe path, excessive entry count, package mismatch, or content
difference blocks. It copies one tarball without replacement and records
SHA-256, npm integrity, and canonical content digests.

The qualification job installs that preserved tarball, runs packed greenfield
and compatible-adoption canaries in clean temporary repositories, executes the
downstream native gate in the exact verifier image, proves downstream operation
without Mill, exercises recovery and path-escape rejection, produces an SBOM,
runs all nine read-only audits, assembles the public-alpha qualification, and
stores one seven-day `genesis-candidate-<tag>` artifact. Routine releases retain
this historical artifact-name prefix.

Inspect that artifact and workflow result. A missing or skipped required result
is a failure, not an exception.

### 4. Publish the preserved artifact

Publication requires separate authorization, the successful candidate workflow
run ID, the protected GitHub `npm` environment, and npm trusted publishing bound
to this repository and workflow:

```sh
gh workflow run release.yml --ref "$tag" \
  -f mode=publish \
  -f tag="$tag" \
  -f candidate_run_id=<successful-run-id>
```

The publish job downloads the prior run's exact candidate artifact, validates
its preserved qualification, and assembles prepublication evidence. It runs:

```sh
npm publish "$artifact" --provenance --access public --tag alpha
```

It does not run `npm pack` again. It verifies that npm's `alpha` dist-tag names
the exact version, reads the package back, verifies registry signatures with a
bounded propagation retry, downloads and requalifies the registry artifact,
creates a draft prerelease with the same tarball/checksum/SBOM/evidence,
downloads the GitHub asset, checks every identity, uploads final evidence using
the durable tag URL, and only then publishes the prerelease.

### 5. Close the release

Record the workflow run, tag commit/tree, tarball digest/integrity, npm tarball
and provenance, GitHub Release URL and asset digest, qualification digest,
support tuple, and canary window. Reinstall the exact newly qualified version in
an empty directory with lifecycle scripts disabled and confirm its version and
help.

The release becomes the trust root for qualifying the next candidate. It does
not qualify a new stack, host tuple, worker profile, model identity, or forge.

## Routine releases after genesis

Before creating a new release identity, read back the `npm` environment's
reviewer and branch/tag admission rules. Protected-branches-only is not the same
policy as selected release tags. The owner authorized `main` plus exact tags
`v0.2.1` and `v0.3.0` on 2026-09-05; provider readback confirmed all three
permitted refs and unchanged reviewer and main branch protections. A subsequent
tag needs its own explicit environment-policy authorization. Do not use a
wildcard, bypass approval, or dispatch a different ref to work around an
admission failure.

The `v0.2.0` tag is retained as prepublication evidence. Publication was held
after source inspection identified that the fresh publish runner lacked explicit
preparation of the image required by its registry canary (`--pull never`). No
`0.2.0` npm publication or GitHub Release was attempted. The `0.2.1` repair
prepares and inspects the digest-pinned image before the irreversible publish
step. Every full-canary job must have its own unconditional preparation; jobs do
not share a Docker cache. Native workflow policy rejects missing, duplicate,
late, conditional, failure-ignored or noncanonical preparation. This explicit
release preparation does not authorize implicit image pulls during Mill runtime
validation. Fresh exact-source and artifact qualification still apply.

Trusted release N must qualify candidate N+1 from outside the candidate's
control. Preserve the same exact-artifact and readback chain. Any change to the
worker harness/profile, verifier image, support tuple, schema compatibility, or
release workflow requires a fresh matched canary. A future real state/schema
migration must prove upgrade and downgrade before Mill documents an automated
migration path.

The 0.2.0 candidate workflow adds `independent-release-policy`, checked out at
qualified v0.1.5 commit `c547762d7644f62ac48011089564f5f46a48b786` with its own
lock, assessor and packed-artifact canary. Its tag/source identity is checked
before execution. The candidate's own tests remain additional evidence, not a
replacement for this independently pinned policy.

Dispatch both phases with `--ref <exact-tag>` so the workflow-run head matches
the immutable tag commit. Publication downloads both preserved artifacts from
the same successful candidate run. It verifies the trusted verifier pin,
tarball/qualification digests, exact repository/workflow/event/head and
successful `build-a`, `build-b`, `qualify-candidate` and
`independent-release-policy` jobs. A missing, duplicate, skipped or mismatched
job blocks publication. Keep the seven-day artifact retention window in mind; an
expired artifact is not permission to rebuild during publication.

Native Node ESM/npm adoption remains experimental. A successful JSON Server
canary does not add an enterprise-stack or pnpm support tuple to the qualified
web recipe. Record exact upstream revision, local dependency overlay, native
commands, failed and passing independent cases, worker usage and review in the
architecture follow-through canary evidence.

## Withdrawal

First classify an interrupted publication from provider readback; do not rerun
the publish workflow. If npm and registry qualification succeeded but GitHub
finalization is incomplete, inventory all release records for the tag by numeric
ID. A draft and a public release can share a tag; tag-only lookup may select the
wrong record. Stop for owner disposition before changing an existing release.
The owner-approved `0.2.1` recovery retained the duplicate draft and verified
the original artifact on the public release, using the tagged native evidence
tools. It did not waive an artifact mismatch or failed package qualification.
See [the exact recovery record](releases/v0.2.1.md).

npm versions and Git tags are immutable. Never overwrite or republish a broken
version.

If prepublication qualification fails, do not publish. Delete an unpushed local
tag, fix through a new reviewed PR, and restart with a new exact candidate. If a
remote tag exists, retain it as evidence and use a new version.

If publication succeeded but readback or postpublication qualification fails:

1. stop the workflow before making a public support claim;
2. deprecate the exact npm version with a concise safety message;
3. keep the GitHub tag and evidence immutable;
4. leave or create a GitHub Release notice that states the failure and affected
   tuple without attaching an unverified replacement;
5. use private vulnerability reporting for a security defect and publish an
   advisory when disclosure is safe;
6. instruct users to pin the last qualified version or remove Mill using the
   pre-integration snapshot and `detach plan`;
7. fix and publish a new version through the complete release path.

Do not unpublish except for a narrowly justified legal or credential incident.
Do not claim rollback to a prior Mill version until a real released migration
has proven state and schema compatibility.

## Required repository and npm settings

### Channel promotion

GitHub Latest and npm dist-tags are separate owner-approved effects after exact
release qualification and readback. They do not require rebuilding or
republishing. GitHub Latest cannot designate a prerelease; a separately approved
normal-release label must still disclose Mill's public-alpha limits. As of
2026-09-05, GitHub Latest and npm `alpha`/`latest` select `0.3.0`.

For an approved npm channel change, use the operator's own npm login and 2FA,
change only the named dist-tag, and read back the resulting version and
unchanged integrity. Do not collect credentials in chat, store tokens in the
repository, weaken trusted publishing, or replay publication after an
authentication error. Keep exact install pins in user docs; never replace
historical trust-root pins.

### Publication protection

The GitHub `npm` environment must require maintainer approval and restrict the
deployment branch/tag policy. The workflow receives only `id-token: write` and
`contents: write` in the publish job. No long-lived npm token belongs in GitHub,
the repository, shell history, or a task packet. Configure npm trusted
publishing for `davidahmann/mill` and `.github/workflows/release.yml`, require
maintainer 2FA/passkey, and keep recovery codes offline. See
`docs/repository-settings.md`.
