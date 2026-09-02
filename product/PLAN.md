# Mill delivery plan

Status: active

Owner: David Ahmann

1. **Foundation:** repository constitution, exact-version CLI, compact schemas,
   static source/repository inspection, native CI, and security/release design.
2. **Local delivery:** durable state, disposable worktree, bounded Codex build,
   committed candidate, native verification, local review, cancellation and
   recovery.
3. **Draft PR:** intent/receipt/readback protocol, GitHub draft PR, exact-head
   CI/review observation, one repair wave, human merge, and truthful closure.
4. **Product intelligence:** source-backed product contracts, explicit
   continuity and worker admission, one qualified Node/TypeScript web recipe,
   basic retrofit, and one resumable `start` command.
5. **Public alpha:** audits, narrow clean-room canaries, genesis release,
   provenance, manual rollback/detach, limitations and support matrix.

Each item is one vertical delivery wave, not a bucket of microtasks. Later-wave
choices close only before their wave. The current detailed task is in
`product/tasks/`.

Waves 1 through 3 are landed. The attended Wave 3 disposable-repository canary
opened, reviewed, human-merged, and truthfully finalized the exact candidate;
its resulting-main check passed. Wave 4A is landed: source and product
continuity contracts, semantic impact evidence, immutable worker admission, and
the selected Node.js 24/Next.js 16 web-recipe decision. Wave 4B is delivered by
the current change: the exact recipe assets, transactional greenfield and
compatible-adoption integration, lock-bound dependency preparation, read-only
offline recipe verification, task compilation, manual detach planning, and the
resumable founder path. No public-alpha, autonomous-planner, or general
stack-support claim is made before Wave 5 qualification.
