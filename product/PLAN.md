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
4. **Product intelligence:** PRD compiler, one qualified Node/TypeScript recipe,
   basic retrofit, scenarios, and one resumable `start` command.
5. **Public alpha:** audits, narrow clean-room canaries, genesis release,
   provenance, manual rollback/detach, limitations and support matrix.

Each item is one vertical delivery wave, not a bucket of microtasks. Later-wave
choices close only before their wave. The current detailed task is in
`product/tasks/`.
