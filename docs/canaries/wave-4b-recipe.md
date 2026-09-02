# Wave 4B recipe qualification

Status: pre-merge local qualification passed; exact-candidate repository gate
and CI remain required for promotion

Observed: 2026-09-02

## Bound inputs

- Recipe: `node-typescript-next-web` version `1.0.0`
- Recipe digest:
  `sha256:37fd49eea9c11ccb026006f0e93198a20d6e8b51da319690d7e5f97b1bcc8203`
- Package manifest SHA-256:
  `77e58b17cf2b2aa5e7ca28972398f63d86877f468d121e897d0467a3babd0a72`
- Package lock SHA-256:
  `7a7c7bc7baacb54150ef832107245c8e5274a1df193548422c90699edce1a3eb`
- Verifier image:
  `mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e`
- Runtime observed inside that image: Node.js `24.18.1`, npm `11.16.0`
- Writable mounts: `.next`, `.mill-output`
- Network during verification: none

The dependency snapshot was prepared separately through attended npm-registry
network with lifecycle scripts, audit, and funding calls disabled. The build
trust and attendance grants were rechecked at the runtime boundary. The runtime
copied lock inputs before deriving identity, required every installable entry to
carry a declared HTTPS npm source and SHA-512 integrity, rejected links and
workspaces, revalidated the frozen bytes after installation, and proved a
regular dependency tree. Snapshot identity binds the manager, registry, target,
exact image, and both frozen lock-input byte digests; its marker also binds the
installed tree digest, which is recomputed before reuse and verification.

## Executed path

Mill's production verifier mounted every source entry read-only, mounted the
prepared `node_modules` snapshot read-only, and provided the two declared output
trees as bounded tmpfs. The container used a read-only root, dropped all
capabilities, enabled no-new-privileges, bounded PID, memory, CPU, shared
memory, deadline, and output, and was removed before evidence was accepted.

The recipe's single required `check` executed:

1. Prettier check
2. ESLint
3. TypeScript
4. Unit test
5. Integration test
6. Chromium browser scenario against the production build
7. Standalone production build/package check

Result: passed in 16,344 ms (16,424 ms including verifier orchestration).
Captured stdout/stderr digest:
`sha256:b661a730c2307a405cc4e3f8a57b1f108856f8cd325321b292e71ac3cc52a211`.

Deterministic repository fixtures separately cover exact greenfield and adoption
planning, transactional apply, isolated adoption branches, failed-qualification
cleanup, ownership/detach reporting, approval mismatch, incompatible versions,
unsafe Git state, conflicting authority, dirty checkout, exact blueprint recipe
selection, named recipe-oracle selection, canonical no-symlink targets,
generator-bound plan-to-lock identity, exact adoption oracle and dependency-lock
bytes, frozen dependency inputs, packed dotfile delivery, context-safe product
titles, complete outcome/task/acceptance binding, all-run inventory, and
stage-scoped resume preflight. The full Mill gate and exact-candidate review
remain the promotion authority for the implementation that contains those
fixtures.

## Claim boundary

This proves the exact bundled recipe can execute its native delivered-surface
gate through Mill's offline verifier on this development host. It does not prove
public distribution, clean-machine installation, arbitrary Next.js adoption,
other stacks, another OCI engine, or autonomous PRD-to-proposal planning. Those
claims remain Wave 5 or later work.
