# MREV synthetic maintenance replays

Status: active evidence record. This document records private, disposable
fixtures used to test Mill's maintenance flow. It does not establish provider
fidelity, customer acceptance, customer demand, or a productivity claim.

## Replay A

Replay A used a synthetic owner-lookup retirement in private repository
`davidahmann/mill-mrev-replay-owners-a`. The frozen task bound three
customer-like configurations, a preservation case, a synthetic provider notice,
and offline OCI commands. An initial reviewed candidate could not plan delivery
because the fixture had `trustCeiling: build`; that failed preflight was
preserved. The attended configuration was corrected, the prior reviewed run was
cancelled, and a fresh baseline/run was created.

The fresh run is `6046816e-2d1b-4cda-aca0-bb1cce71cf3f`, based on
`9c72779fe9b027cbacd20b6a40f812bf2ced3d34`, with candidate
`3380cb2e7db767b4ef9a923722449c42734b77d2`. Its preservation and three
configuration commands passed in the pinned offline OCI verifier. An independent
review completed and Mill opened draft
[PR #1](https://github.com/davidahmann/mill-mrev-replay-owners-a/pull/1). The PR
is intentionally unmerged. Tests, review, and draft delivery leave owner
acceptance `not_recorded`.

## Replay B

Replay B uses a separate private fixture repository,
`davidahmann/mill-mrev-replay-owners-b`, with the same synthetic contract and a
separately selected digest-pinned `provider-api-adaptation` playbook. The task
still owns its own acceptance and configuration matrix. The run is
`6952d171-e674-4a00-900c-d1d4c38ced5c`, based on
`1014434725c77e9c9d541a2aaa6533dbb58f5d0a`, with candidate
`c5425cf99e4d91f26f149029bb3e43944663448c`.

That initial candidate passed verification but the reviewer correctly blocked
it: the fixture's policy authorized only build authority while its committed
configuration enabled attended draft delivery. The run was cancelled. The
maintainer then committed an explicit policy allowance before a new baseline.
Fresh run `db6e8c60-815f-45d1-b173-91110094c631` started from
`24b552d44e1128b921541ba42652a7e21891a5ea`. Its first builder attempt produced
no candidate; its bounded resume produced candidate
`70c9c1a4ba74e97d6fea93b37b606cfe6b0709f4`. It passed all four offline checks, a
refreshed review, and the required stale-scope refresh before Mill opened draft
[PR #1](https://github.com/davidahmann/mill-mrev-replay-owners-b/pull/1). The PR
is intentionally unmerged and owner acceptance remains `not_recorded`.

The comparison is intentionally weak: the fixtures have the same source shape,
the maintainer had already seen the first replay, and there are only two trials.
Unknown human minutes remain null in the development-evidence ledger. The record
can show workflow behavior and measured provider usage; it cannot show that
playbook reuse reduced total maintenance work.

The repository's deterministic integration-adaptation replay suite also injects
an incorrect migration candidate and proves that the frozen checks reject it.
The two live MREV replays instead preserved an incompatible authorization, an
empty candidate attempt, and stale review scope. They did not inject a source
mutant into either disposable draft PR.
