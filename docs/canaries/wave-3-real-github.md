# Wave 3 attended real-provider canary

Status: passed and closed

Date: 2026-09-02

## Bound identities

- Disposable private repository: `davidahmann/mill-wave3-canary-20260902`
- Pull request: `#1`
- Base commit: `f12d170939175110119c7b4c797adf7d27c2552b`
- Candidate commit: `bbeabb2bde1c5f07ed8c409bbe4daada524840e5`
- Candidate tree: `5d4c7420a0d7f68338d9534b4d175af3f4ace23e`
- Resulting main commit: `9b1f179e3870aaa8b510b4f22a48c9c461e7489a`
- Mill run: `7c0be8fb-46c7-4286-bc47-b8ced212c98f`

## Observed lifecycle

Mill qualified the exact base, built and committed the candidate through the
operator's logged-in Codex CLI, ran the selected verifier, obtained a fresh
local review, pushed the unchanged candidate, and opened one draft pull request.
The maintainer marked it ready and squash-merged it. Mill then read GitHub back,
proved the configured merger, candidate tree preservation, default-branch
containment, and a successful `validate` check on resulting main before closing
the run as `linear_tree_preserving`. No push, readiness change, or merge was
performed by CI.

## Usage and limitations

The provider reported 170,671 input tokens for the tiny builder task and 90,602
input tokens for review. Currency cost was unavailable and Mill did not estimate
it. This canary proves the attended GitHub lifecycle, not cost efficiency,
host-level Codex containment, unattended operation, arbitrary repositories, or
general stack compatibility. Wave 4 must budget and expose context growth before
routine use.
