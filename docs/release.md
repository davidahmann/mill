# Release runbook

Mill releases are immutable evidence chains. A release is not qualified because
the source builds or a tag exists. The reviewed candidate tree, resulting `main`
tree, annotated tag, two independent builds, one preserved tarball,
qualification, SBOM, npm publication, and GitHub Release must agree.

Tag creation, npm publication, and GitHub Release creation are separate external
effects. Run a stage only after the maintainer explicitly authorizes it.

## Genesis release

`v0.1.5` is the one-time bootstrap exception to the normal rule that trusted
release N qualifies candidate N+1. The remote `v0.1.0`, `v0.1.1`, and `v0.1.2`
tags are retained as failed prepublication evidence. Version `v0.1.0` exposed
GitHub `actions/checkout`'s inert `gc.auto=0` setting as an audit compatibility
gap. Version `v0.1.1` passed that audit and independent artifact comparison,
then its real Linux packed-artifact canary exposed root-owned bind-mount output.
Version `v0.1.2` passed the corrected full canary, then qualification could not
read generated evidence outside the repository safety root. Version `v0.1.3`
then stopped at identity verification because its annotated tag omitted the
required reviewed-tree trailer. None produced an npm package or GitHub Release.
Version `v0.1.4` passed complete candidate qualification and its exact artifact
was published under the npm `bootstrap` tag using the maintainer's 2FA session,
because npm requires an existing package before trusted publishing can be
configured. It has no CI provenance or GitHub Release and is not the supported
alpha. The package-specific trusted publisher and protected GitHub `npm`
environment now exist. The corrected supported candidate uses GitHub-hosted
clean builders outside the tagged checkout and the following gates.

### 1. Qualify the source candidate

Before tagging:

- merge the reviewed PR only after its required checks and exact-head review
  settle;
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
tag=v0.1.5
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
gh workflow run release.yml \
  -f mode=candidate \
  -f tag=v0.1.5 \
  -f support_tuple_base64="$support_tuple_base64" \
  -f sequence_base64="$sequence_base64"
```

The workflow checks out the immutable tag twice, installs with lifecycle scripts
disabled, verifies tag identity, runs the full native gate, and packs once in
each independent job. It safely extracts and compares canonical package paths,
executable bits, and bytes. Any symlink, special entry, unsafe path, excessive
entry count, package mismatch, or content difference blocks. It copies one
tarball without replacement and records SHA-256, npm integrity, and canonical
content digests.

The qualification job installs that preserved tarball, runs packed greenfield
and compatible-adoption canaries in clean temporary repositories, executes the
downstream native gate in the exact verifier image, proves downstream operation
without Mill, exercises recovery and path-escape rejection, produces an SBOM,
runs all nine read-only audits, assembles the public-alpha qualification, and
stores one seven-day `genesis-candidate-v0.1.5` artifact.

Inspect that artifact and workflow result. A missing or skipped required result
is a failure, not an exception.

### 4. Publish the preserved artifact

Publication requires separate authorization, the successful candidate workflow
run ID, the protected GitHub `npm` environment, and npm trusted publishing bound
to this repository and workflow:

```sh
gh workflow run release.yml \
  -f mode=publish \
  -f tag=v0.1.5 \
  -f candidate_run_id=<successful-run-id>
```

The publish job downloads the prior run's exact candidate artifact, validates
its preserved qualification, and assembles prepublication evidence. It runs:

```sh
npm publish "$artifact" --provenance --access public --tag alpha
```

It does not run `npm pack` again. It verifies that npm's `alpha` dist-tag names
the exact version, reads the package back, verifies registry signatures,
downloads and requalifies the registry artifact, creates a draft prerelease with
the same tarball/checksum/SBOM/evidence, downloads the GitHub asset, checks
every identity, uploads final evidence, and only then publishes the prerelease.

### 5. Close the release

Record the workflow run, tag commit/tree, tarball digest/integrity, npm tarball
and provenance, GitHub Release URL and asset digest, qualification digest,
support tuple, and canary window. Reinstall `@davidahmann/mill@0.1.5` in an
empty directory with lifecycle scripts disabled and confirm its version and
help.

The release becomes the trust root for qualifying the next candidate. It does
not qualify a new stack, host tuple, worker profile, model identity, or forge.

## Routine releases after genesis

Trusted release N must qualify candidate N+1 from outside the candidate's
control. Preserve the same exact-artifact and readback chain. Any change to the
worker harness/profile, verifier image, support tuple, schema compatibility, or
release workflow requires a fresh matched canary. A future real state/schema
migration must prove upgrade and downgrade before Mill documents an automated
migration path.

## Withdrawal

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

The GitHub `npm` environment must require maintainer approval and restrict the
deployment branch/tag policy. The workflow receives only `id-token: write` and
`contents: write` in the publish job. No long-lived npm token belongs in GitHub,
the repository, shell history, or a task packet. Configure npm trusted
publishing for `davidahmann/mill` and `.github/workflows/release.yml`, require
maintainer 2FA/passkey, and keep recovery codes offline. See
`docs/repository-settings.md`.
