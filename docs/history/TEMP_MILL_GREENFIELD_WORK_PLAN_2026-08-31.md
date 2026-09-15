# Mill Greenfield System and Work Plan

Status: temporary, untracked, planning and roadmap reconciliation
Date: 2026-09-03
Repository: `https://github.com/davidahmann/mill` (public, default branch `main`)
Local planning path: `/Users/davidahmann/Projects/mill`
Visibility: public OSS
Initial maintainer and final human authority: David Ahmann (`@davidahmann`)
Current landed baseline: `dce4f1b3048c2f0ffe80954a672ca24960c7e827`; Waves 1–4B and the attended Wave 3 external canary are landed
Implementation authorization: David authorized Wave 5 implementation and GitHub landing on 2026-09-03. Tag creation, npm publication, GitHub Release creation, deployment, and the post-alpha feedback/improvement layer remain separate effects and are not authorized by this planning record.

## 1. Executive decision

Mill should be a local-first, repo-native software-delivery system for one founder before it becomes a general platform.

Its enduring product is continuity across agent-authored changes. Coding agents may
produce a useful patch in one session; Mill must preserve approved product intent,
system invariants, and operational correctness across a sequence of changes. Agent
sessions and intermediate reasoning may be ephemeral. Approved contracts, current
source, interfaces, schemas, scenarios, decisions, history, and promotion evidence
remain durable and reviewable.

Its first honest public-alpha promise is:

> After one-time local authentication and repository setup, Mill turns one approved customer-visible outcome from a PRD, disclosed source manifest, and operator-supplied structured proposal into a reviewed draft PR and proves both the new behavior and affected prior obligations on the exact candidate, using the operator's Codex account.

The public-alpha system assesses and challenges that structured proposal against the
PRD and disclosed sources, freezes approved product and architecture truth, prepares
or adopts the repository, compiles the outcome into a bounded delivery slice, runs
deterministic and realistic checks, obtains an isolated-context review, and records
truthful closure and audit evidence. “Start with only a PRD” remains the north-star
experience, not a public-alpha claim. It requires a later bounded research/planning
coordinator and still cannot infer credentials, destination policy, or product
authority from prose.

Mill must not claim that planning or generated code is deterministic. Model output, web research, registries, and framework recommendations change. Mill's defensible guarantee is that inputs, authority, planning snapshots, candidate identity, validation, review, external effects, and promotion decisions are versioned, bounded, reproducible where possible, and auditable. Different runs may produce different code; no run may publish or promote code that has not satisfied the same approved outcomes and gates.

The unit of value is therefore a verified product change that preserves prior
obligations, not a generated patch or PR by itself. A PR is the interoperable review
and promotion envelope for that change.

The eventual UX may begin with only a PRD, but a PRD is narrative input rather than execution authority. Public alpha requires an operator-supplied structured proposal, which Mill assesses and a human promotes into approved product truth before code execution. A later autonomous planner must still ask only about consequential ambiguity, externally visible behavior, irreversible choices, or expanded authority.

Mill v1 ends at a reviewed draft PR plus post-merge observation after the human merges. Automatic merge, production deployment, parallel writers, hosted control planes, and self-modification are later capabilities that must be earned independently. Public-alpha qualification must also show that Mill preserves accepted behavior across a small sequence of dependent changes; one successful PR proves delivery mechanics, not continuous evolution.

Mill does not need to become another coding-agent harness. A worker such as Codex,
OpenCode, or Pi owns its inner model/tool loop; Mill owns the approved invocation,
repo context, capability ceiling, candidate identity, validation, review, remote
effects, and continuity evidence around that loop. Codex CLI remains the only v1
worker implementation. A versioned worker boundary keeps the harness replaceable
without importing a provider marketplace, interactive session system, plugin
runtime, or agent server into Mill.

## 2. Current project state and naming

- `/Users/davidahmann/Projects/mill` is an implemented Git repository. Local `main`, `origin/main`, and the remote `main` ref are aligned at `dce4f1b3048c2f0ffe80954a672ca24960c7e827` as of 2026-09-03.
- `davidahmann/mill` exists as a public GitHub repository with `main` as its default branch.
- Waves 1–3 are landed. The attended disposable-repository Wave 3 canary opened a draft PR, exercised local review and the configured human merge boundary, verified the resulting main checks, and was truthfully finalized; its durable record is `docs/canaries/wave-3-real-github.md`.
- Wave 4A is landed: source-backed product-continuity contracts, exact impact and semantic-evidence binding, immutable worker admission, and the selected Node.js 24/Next.js 16 recipe decision.
- Wave 4B is landed and its post-merge `main` CI and CodeQL are green. The exact recipe assets, transactional greenfield and compatible-adoption integration, lock-bound dependency preparation, read-only offline recipe verification, task compilation, manual detach planning, and founder coordinator are present on `main`.
- Wave 5 implementation is complete on the candidate branch: bounded `audit`, longitudinal qualification and seeded-fault enforcement, an experimental support-tuple record, exact-artifact comparison, packed greenfield/adoption qualification, two-phase genesis release automation, and harmonized operator/agent/release docs are present. The deterministic package gate is green. The live exact-profile longitudinal canary, qualified support tuple, annotated tag, two clean hosted builds, npm publication, registry requalification, GitHub Release, and final public support claim remain unperformed external gates; code presence is not release qualification.
- No feedback signal store, diagnostic-case workflow, model scorer, or controlled-improvement engine exists. Those remain post-alpha and evidence-triggered.
- Mill does not track a Factory profile, worker-pack verifier, pack, sibling checkout, or runtime dependency. Maintainers may use external tools, but Mill's native checks and ordinary Git/GitHub interfaces are the sufficient shipping path and no external-tool evidence certifies Mill behavior.
- The project name remains `Mill`. Because the established JVM build tool and unscoped npm package already use `mill`, the CLI is `millctl` and the planned package is `@davidahmann/mill`. A bare `mill` executable or package remains prohibited; namespace availability must be rechecked immediately before first publication.
- Apache-2.0 is the selected project license. This plan is not legal advice.
- Only Wave 5 GitHub landing followed by the separately authorized live qualification, tag, genesis publication/readback, and support-claim gates remain on the current v1 critical path. Feedback intake and controlled self-improvement remain post-alpha and evidence-triggered.

## 3. Target user, job, and initial operating boundary

### 3.1 Primary persona

The primary v1 user is David Ahmann acting as product owner, architect, maintainer, reviewer of consequential decisions, and release authority across his own repositories.

### 3.2 Job to be done

When starting or extending a software product, the founder wants to supply product intent and evidence, receive a well-supported and challengeable delivery proposal, and have the repetitive path from approved intent to a reviewed candidate handled without having to manually orchestrate agents, reconstruct state, chase CI, or personally rediscover every system invariant and downstream regression risk on each change. Public alpha requires the founder to supply the structured proposal; evidence-led autonomous research and drafting are later improvements.

### 3.3 Secondary future persona

Another founder or maintainer may clone a Mill-managed repository and operate it with their own local Codex, GitHub, and provider identities. Mill must not share David's credentials, billing identity, local state, or approvals. Multi-user coordination and organization policy are not v1 requirements.

Each v1 managed repository names exactly one final human promotion authority. That
role is repo configuration, not a globally hard-coded David identity; changing it
requires explicit repository rebind/approval.

### 3.4 v1 trust ceiling

v1 supports three explicit trust modes:

1. `inspect`: static repository/PRD/source/proposal assessment and future separately approved research/planning; no repository command execution, writes, or remote mutation.
2. `build`: bounded write access inside a disposable worktree plus approved build/test commands; no GitHub mutation.
3. `propose`: publish the exact verified candidate as a branch and draft PR through the operator's local GitHub identity; human merge and release remain required.

Future `deliver` and `operate` modes are excluded from v1. Effective authority is always the minimum of the repository trust ceiling, the exact-run grant, and the capability available to the adapter. Credential availability is never permission.

These modes describe worker and product-code authority. A deterministic
control-plane integration effect is separate: after Gate A0/A1 approval,
`new --apply` or `adopt --apply` may write only the exact approved file plan and
ownership classes while the worker remains at `inspect`. That effect cannot execute
repository code, invent product behavior, or authorize a later build/proposal.

### 3.5 Solution composition and mechanism boundary

Mill is developer infrastructure, so no business-flow pattern, industry vertical, or
existing horizontal FDE foundation is adopted as Mill product taxonomy merely to
fill a template. Its product-specific boundary is governed software delivery and
change assurance: admit, execute, verify, promote, reconcile, and recover one
software change as a durable workflow. The architecture is deterministic trusted
software around one bounded coding worker, not a multi-agent topology. Models
propose product structure, stack choices, code, and review findings; deterministic
software owns state, identity, capability, Git, command execution, evidence, and
provider reconciliation; the repository-configured human maintainer owns product
promotion, consequential architecture decisions, new authority, draft readiness,
merge, release, and exceptions. David is that maintainer for Mill. External
frameworks are design references, not product fields or release evidence.

The future learning layer has a narrower composition: the **signal-to-investigation**
business flow, no industry vertical, the **deployment-and-operations** foundation,
and the **controlled-improvement-agent** blueprint. A review correction, CI failure,
escaped defect, incident, cost regression, or operator report becomes an
evidence-backed case disposition before it can propose a replay case or system
change. This composition is post-alpha guidance, not a reason to add a daemon,
tracker dependency, multi-agent topology, or self-modifying runtime to v1.

## 4. Product goals and non-goals

### 4.1 Goals

Across public alpha and evidence-led later stages, Mill should provide the following
capabilities. Items explicitly marked `later` or `future` are not part of the
public-alpha support claim:

- for public alpha, accept a PRD, disclosed source manifest, operator-supplied structured proposal, optional constraints/designs, and existing code;
- distinguish stated, observed, inferred, system-enforced, and human-authorized facts;
- later, research stack and dependency choices from primary sources and registries only when the decision is open, stale, or materially affected;
- later, draft two or three scored blueprint candidates rather than silently choosing fashionable technology;
- validate and freeze an approved product contract, architecture blueprint, realistic scenario set, quality profile, and outcome-level plan; a future planner may draft these inputs but cannot approve them;
- assign stable IDs to approved product invariants and connect them to acceptance outcomes, scenarios, interfaces, and verification methods;
- bootstrap a new repository or safely retrofit an existing one;
- keep downstream repositories independently buildable and understandable without Mill;
- plan just in time by customer-visible outcome instead of pre-expanding an entire PRD into microtasks;
- compile a human-approved per-change impact manifest that names affected and uncertain invariants, surfaces, scenarios, commands, and design obligations;
- execute one writer in one isolated worktree at a time;
- run deterministic repo-native checks and realistic delivered-surface scenarios, reporting new-behavior completion separately from preservation of prior accepted behavior;
- bind review and shipping to an exact base and candidate SHA;
- batch a complete review generation into one systemic repair wave;
- open a draft PR, monitor CI, reconcile uncertain remote effects, and observe the merge selected by the human;
- keep knowable code, tests, docs, migrations, durable decisions, and closure in the same delivery PR;
- orchestrate risk- and recipe-applicable product, code, architecture, security, dependency, UX, accessibility, operations, and release audits for supported shapes; broader audit packs remain evidence-led;
- preserve only durable product truth and lessons in Git while keeping raw execution evidence outside the repository;
- measure accepted outcomes, escaped defects, human interventions, review churn, latency, CI use, and model cost;
- qualify Mill, model, harness, and recipe changes on dependent change sequences rather than relying only on isolated-task success;
- freeze a versioned worker profile and invocation-envelope digest before each model execution so harness configuration, tools, context loading, budgets, and authority cannot drift invisibly;
- later convert verified operator feedback, review corrections, incidents, and run failures into deduplicated diagnostic cases, replayable regressions, and human-reviewed improvement proposals;
- propose improvements to Mill through ordinary reviewed changes, never apply them autonomously.

### 4.2 Non-goals for v1

v1 will not include:

- automatic merge or production deployment;
- a hosted SaaS account, web control room, or cloud runner;
- distributed queues, multi-process scheduling, leases, fencing, or parallel writers;
- cross-repository atomic missions;
- multi-model routing or a model marketplace;
- plugin or third-party skill execution;
- a built-in coding-agent loop, TUI, IDE, model/provider marketplace, generic MCP surface, or headless agent server;
- interactive worker steering that can change scope, acceptance, invariants, or authority inside an active run;
- a graph database, knowledge graph service, or generic artifact registry;
- an agent-as-production-runtime or discard-the-repository operating model for ordinary software products;
- bidirectional tracker synchronization;
- a custom workflow language or custom shell parser;
- a second standards repository or copied standards bundle;
- one committed evidence artifact per transition, review, or command;
- automatic factory self-modification;
- automated feedback ingestion, model-scored policy changes, and unattended improvement-candidate generation;
- broad enterprise RBAC, compliance, or attestation machinery;
- native Windows support; WSL2 may be experimental after Linux and macOS qualify;
- a promise to build safely from hostile repositories before containment is independently qualified.

## 5. Important aspects that must not be missed

The following are first-class design requirements, not cleanup work:

1. **Product-truth promotion.** The PRD is a hypothesis and source, not executable truth. Contradictions, unsupported assumptions, and missing disposition authority must be surfaced before planning.
2. **Question and approval budgets.** Mill should decide reversible, low-cost choices within approved policy and ask only when risk, external visibility, or irreversibility warrants it. Approval cards must be concise and evidence-backed.
3. **Plan invalidation.** Product, scenario, architecture, recipe, dependency, base-SHA, permission, or deployment-policy changes must invalidate only affected slices and approvals rather than silently drifting or regenerating everything.
4. **Untrusted inputs.** PRDs, READMEs, issues, comments, web pages, tool output, package metadata, screenshots, and model output can contain prompt injection or hostile instructions. None can grant capability.
5. **Oracle ownership.** The builder cannot unilaterally redefine critical outcomes, visual baselines, hidden scenarios, promotion graders, or release policy and then certify itself.
6. **Delivered-surface testing.** Source-level green tests are insufficient. Installable packages, deployed previews, migrations, APIs, browser flows, and rollback paths must be tested where relevant.
7. **Recovery and external-effect reconciliation.** A timeout after push, PR creation, comment, or another externally readable mutation is an unknown outcome requiring authoritative provider readback, not blind retry. An uncertain model invocation has no equivalent business-state readback: Mill reconciles its process lease, attempt record, worktree, and candidate state, records provider result/cost as unknown where necessary, and permits another attempt only from a proven safe checkpoint.
8. **Bootstrap trust.** After the genesis exception, trusted Mill release N qualifies candidate N+1. A candidate must not certify its own release path.
9. **Downstream adoption and exit.** Bootstrap, retrofit, exact-version pinning, restoration to the pre-Mill integration snapshot, detach, and clean-clone operability are product features. Cross-version upgrade or rollback planning becomes a feature only when a real released migration provides evidence to design it.
10. **OSS distribution security.** Mill's installer, update channel, dependencies, releases, and GitHub workflows are part of the threat model.
11. **Privacy and billing.** Source, prompts, diffs, credentials, filenames, and stable machine identifiers are never telemetry. Telemetry is off by default. Each operator owns their own model and forge costs.
12. **Portability honesty.** Provider-neutral interfaces do not equal proven provider support. Every supported stack, OS, worker profile, model, forge, and container runtime needs an end-to-end qualified tuple.
13. **Design and product acceptance.** A technically correct product can still be unusable or commercially wrong. Product, UX, accessibility, and outcome review must remain distinct from code review.
14. **Data and operational lifecycle.** Migrations, retention, backup/restore, observability, incident response, rollback, deletion, support, and maintenance cadence belong in the blueprint when applicable.
15. **Naming and namespace discipline.** The project uses `millctl`; a bare `mill` executable/package remains prohibited, and the scoped package namespace must be rechecked before public release.
16. **Context and provider disclosure.** Every model/research call needs a frozen context manifest, allowed/forbidden paths and data classes, redaction, provider identity and observable retention posture. Telemetry being off does not mean source was not sent to a model provider.
17. **Genesis release trust.** `N qualifies N+1` cannot apply before N exists. The first release needs an external bootstrap qualification protocol.
18. **Continuity across changes.** Every task must identify the prior obligations it may affect, preserve unresolved uncertainty, and prove the relevant accepted behavior on the exact candidate. One green PR is not evidence of sustained evolution.
19. **Item-level semantic evidence.** A required acceptance, invariant, or scenario ID must map to an executed oracle result, explicit human attestation, or blocking unsupported state. Merely hashing or presenting a scenario file is not execution evidence.
20. **Design-consequence visibility.** Boundary-changing work must record compatibility, migration, reversibility, dependency, security, and operating obligations without collapsing judgment into an invented architecture score.
21. **Worker admission and identity.** Mill must durably admit an immutable, privacy-preserving invocation envelope before starting a worker, persisting both its canonical redacted record and digest. Re-observing the same identity may return the existing admission and may start it only when durable state proves Mill never began the worker-subprocess launch; Mill cannot infer whether an internal model-provider request occurred once the worker started. Reuse with different task, context, capability, budget, or output contract fails closed. An unknown mutating worker outcome is never blindly replayed. Mill first reconciles the lease, process, worktree, and candidate state; any new execution uses a new invocation ID and begins only from a proven safe checkpoint.
22. **Harness state is not delivery authority.** Worker sessions, conversation branches, compacted summaries, progress events, todos, and tool claims may aid execution or diagnosis, but only Mill state, exact Git content, native runner evidence, explicit human decisions, and provider readback can advance lifecycle authority.
23. **Executable resource restraint.** Repository-local worker extensions, plugins, worker extension packages, skills, prompt templates, and MCP servers are outside the v1 worker contract and may not be trusted or installed as part of execution. Ordinary approved application dependencies remain permitted under the repository's native dependency policy. The profile disables worker-resource auto-discovery and startup update/catalog/telemetry behavior where the chosen harness exposes enforceable controls. Unobservable or non-disableable behavior is disclosed and blocks the corresponding no-network or deterministic-profile claim. Static repo guidance may be selected as disclosed untrusted context; executable worker resources require a future separately approved and qualified capability.
24. **Feedback is evidence, not policy.** Review comments, issue text, Slack messages, scores, incidents, and user corrections can open a diagnostic case but cannot directly rewrite prompts, skills, recipes, tests, thresholds, or authority. The case must preserve source, revision, classification, counterevidence, disposition, and accountable owner.
25. **Scorers are governed evaluators.** Every scorer needs an eligible population, sampling/exclusion rule, rubric and version, label authority, threshold, calibration and disagreement path, cost/privacy budget, invalid-result behavior, and named use. A score cannot hide a deterministic failure or consequential regression.
26. **Learning must preserve judge separation.** An improvement author cannot edit the evaluator, fixture, holdout, threshold, CI result, approval, protected branch, release, or rollback evidence that judges its candidate. Accepted failures become replayable cases only through normal human-reviewed promotion.

## 6. Design principles and complexity policy

1. Agent proposes; humans authorize consequential effects.
2. Narrative is context; typed structures carry authority.
3. One source of truth per concept; projections never override their source.
4. Git stores durable product truth; the local database stores operational truth; providers remain authoritative for their own external state.
5. Exact candidate identity is mandatory for validation, review, push, PR, and release evidence.
6. Deterministic evidence plus explicitly authorized human attestations own promotion decisions; model judgments are secondary evidence unless a separately approved calibrated evaluator contract says otherwise.
7. Use the smallest relevant test set during iteration and the complete required set on the frozen candidate.
8. One outcome per delivery PR; no task-per-acceptance or bookkeeping PR churn.
9. One writer and serial execution until measured demand justifies concurrency.
10. Default to local, reversible, inspectable behavior.
11. No ambient secrets, no implicit network, no capability inferred from repository text.
12. Fail closed on ambiguous high-risk outcomes; degrade explicitly with evidence where safe.
13. Raw signals become policy only after verification and promotion through a normal reviewed change.
14. Measure accepted outcomes and total cost, not activity, lines changed, or automation percentage.
15. Preserve a complexity ceiling. Prefer, in order: existing repo-native capability, operating-system/runtime capability, standard library, small dependency, then custom implementation. Every material exception records the observed need, simpler alternative, owner, measurable benefit, and deletion or upgrade trigger.
16. Agent sessions may be ephemeral; approved intent, invariants, current code, history, scenarios, decisions, and evidence remain repo-owned and durable.
17. Fresh exact-base repository evidence outranks conversational memory. Embeddings, summaries, or derived graphs may aid retrieval but never become authority.
18. Evaluate the factory over sequences of dependent changes. Autonomy expands only when preservation quality, strict completion, and recovery remain acceptable as history accumulates.
19. Keep the worker replaceable but support claims concrete. A small adapter contract and fake conformance worker are justified now; a second real harness is not justified until a measured limitation of Codex appears.
20. Persist authoritative state, not UI exhaust. Streaming/progress events may be dropped or replayed without changing the run result; a required terminal result, exact candidate, or evidence record may not.

## 7. System context and authority model

### 7.1 Architecture overview

```text
PRD + source manifest + operator proposal + existing repository
                 |
                 v
       public-alpha specification assessor
       - source classification
       - contradiction and ambiguity detection
       - proposal/blueprint/scenario validation
                 |
          product approval card
                 v
       product contract + stable invariants + scenarios
                 |
                 v
       approved blueprint and recipe binder
       - supplied architecture/data/security/deploy
       - quality capability matrix
       - one qualified recipe
                 |
       architecture approval if material
                 v
       new-repo bootstrap or retrofit proposal
                 |
                 v
       outcome DAG + approved impact manifest
       + one JIT delivery slice
                 |
                 v
       local control plane and event journal
                 |
                 v
       versioned worker adapter in a worktree
       - Codex CLI is the sole v1 implementation
       - immutable invocation envelope and worker profile
                 |
                 v
       deterministic gates + realistic scenarios
       + new-behavior/preservation evidence
                 |
                 v
       frozen exact candidate + read-only review
                 |
       one systemic repair wave if required
                 v
       shipper: branch + draft PR + CI observation
                 |
              human merge
                 v
       post-merge/readback/release and app audit
                 |
                 v
       longitudinal metrics + durable scenario corpus
                 |
                 v
       post-alpha feedback case + replay diagnosis
       + independently evaluated improvement proposal
                 |
              human promotion

future inspect-only planning path, not public alpha:
       PRD + approved evidence
                 |
       bounded research/specification planner
       - disclosed primary-source research
       - 2-3 scored blueprint candidates
       - draft proposal/scenarios only
                 |
       human review before assessor/promotion
```

### 7.2 Authority matrix

| Role | Reads | Writes/executes | Credentials | Explicitly cannot do |
|---|---|---|---|---|
| Current specification assessor | PRD, disclosed sources, and operator-supplied structured proposal | Read-only blockers, semantic diff, canonical bytes, and approval digest | None | Invoke a model/network, mutate repo, or grant authority |
| Future research/specification planner | PRD, approved sources, static repo content, web research | Draft typed proposals in staging only | Model/research adapter session only | Receive repository/forge/deploy credentials, run repo code, mutate repo, or grant authority |
| Bootstrapper/retrofit compiler | Approved proposals and static repo inventory | Apply an approved file plan transactionally in a branch/worktree | None | Provision remote without a separate grant |
| Builder worker | Frozen task packet, exact invocation envelope, worker profile, and scoped repo context | Allowed paths in disposable worktree; approved commands | Operator-owned model session only | Push, merge, deploy, load unapproved executable project resources, steer its own authority, or activate current-run policy changes; prevention of unrelated host access is claimed only in a separately qualified isolated mode |
| Test runner | Frozen candidate and declared commands | Containerized build/test side effects inside disposable environment | No ambient secrets | Host mutation, undeclared egress, release |
| Reviewer | Exact candidate diff, product contract, scenarios, checks | Review report only | Model session only | Modify candidate, acceptance oracle, or policy |
| Shipper | Exact verified candidate and provider state | Push already committed candidate/open draft PR; observe CI | Local `gh` initially | Create or amend candidate commit, change candidate after verification, merge, deploy |
| Human maintainer | Decision packet and underlying evidence | Approve/edit/reject/defer/cancel; merge/release | Personal accounts | None beyond external provider policy |
| Future feedback investigator | Redacted eligible signals, exact run/release identities, approved evidence sources | Diagnostic case, disposition proposal, and replay-case proposal only | Read-only connector/model session when separately approved | Treat reporter diagnosis or score as fact, mutate product truth, start code work, or access unrestricted payloads |
| Future improvement author | Approved diagnostic and replay cases plus a frozen current effective-system manifest | Isolated candidate branch and change packet | Candidate-write identity only | Edit its evaluator/fixtures/thresholds, approve, merge, release, deploy, or suppress failures |
| Future deployer | Exact merged/release candidate | Preview/canary/rollback under a separate grant | Short-lived environment credential | Broaden production authority, edit source |

### 7.3 Source-of-truth and readback rules

| State | Authority |
|---|---|
| Approved product behavior, architecture, scenarios, code, native checks | Git repository at an exact revision |
| Attempts, transitions, budgets, approvals, candidate identities, retry state | Mill local operational database and append-only events |
| Branch, PR, checks, review threads, merge result | GitHub API/readback |
| Deployment status | Deployment provider API/readback |
| Business postcondition | Application or system of record |

A successful command is not sufficient proof of an external effect. Mill reads the authoritative provider before retrying or declaring completion.

Before the first Git repository exists, an approved staged proposal in Mill's local state is the temporary authority. Human approval binds its canonical digest and authorizes only the transactional initial commit containing those exact bytes. After that commit, the configured canonical Git branch becomes authority; the staged record is historical evidence and cannot supersede Git.

## 8. Proposed implementation architecture

### 8.1 Form

- One TypeScript modular monolith on the repository-pinned Node 24 LTS runtime.
- One CLI/control-plane process; no daemon is required in v1. Long waits end in a resumable state rather than requiring a background process.
- A small internal TypeScript `WorkerAdapter` contract with Codex CLI as the sole v1 implementation. Mill's control plane owns durable admission; the adapter normalizes launch, progress, cancellation, terminal settlement, and source-qualified usage while keeping provider-specific conversational concepts out of lifecycle authority. Wave 4 does not introduce a generic network, JSONL, or RPC transport.
- The frozen role-specific worker profile records `observed_at`, the observable adapter/harness version, model identity or mutability, configuration-profile digest, declared tool/capability set, context/resource loading posture, isolation label, startup network/update/telemetry posture, deadline/cancellation semantics, and terminal-output contract. Unobservable fields are labeled `unavailable`; executable paths and raw credentials remain private.
- No resident agent server, client/server split, worker session manager, generic extension API, or second real harness is required in v1. A future local UI remains a projection over Mill's own API and state rather than a reason to adopt a harness control plane.
- SQLite for operational state, with ordinary relational tables and an append-only run-event table. Do not implement full event sourcing.
- Git worktrees for candidate isolation.
- OCI containers for build/test commands where available. Attended host Codex execution may be supported only as `attended-trusted-host`, not described as hostile-code containment. Worktree isolation protects candidate integrity but does not imply host containment.
- GitHub as the first forge adapter, using the operator's local `gh` authentication for attended draft-PR delivery.
- JSON Schema or an equivalently small typed validation layer for the compact repo contracts. Avoid a universal artifact registry.
- Human-readable output by default and stable `--json` output with typed error/reason codes for automation.
- Exact per-repository invocation is mandatory. A global `millctl` must compare itself with `mill.lock` and refuse a mismatch with an exact invocation instruction; it must never silently run a different version. v1 should prefer the package manager's exact-version invocation over inventing a self-updating launcher.
- Optional local UI only after the CLI lifecycle is proven; it must be a projection over the same API and state.

### 8.2 Core modules

1. **Intake and source classifier**: imports PRDs and references, records origin, revision, freshness, authority class, and untrusted-content status.
2. **Current specification assessor and future discovery compiler**: public alpha validates source-anchored, operator-supplied product-contract proposals, assumptions, contradictions, unknowns, non-goals, JTBD, metrics, grouped outcomes, and stable system invariants. A later planner may draft the same shape but cannot promote it.
3. **Current recipe binder and future stack intelligence**: public alpha binds an approved proposal to the one qualified recipe. A later inspect-only advisor may research official sources, registries, advisories, licenses, maintenance, deployment fit, and ecosystem constraints and propose scored blueprints.
4. **Future scenario compiler**: may draft representative visible scenarios, cross-link acceptance and invariant IDs, and identify cases requiring human oracle approval or a separately qualified protected holdout. Public alpha validates and freezes operator-supplied scenarios instead of claiming autonomous generation.
5. **Repository bootstrap/retrofit engine**: statically scans, previews a file plan, applies approved changes transactionally, and establishes native CI and commands.
6. **Context compiler**: freezes a source-addressed, redacted supplied-context epoch plus the broader provider-visible repository scope for each model call. Every required or explicitly supplied source has a stable key, class, authority, freshness/revision, exact digest, inclusion reason, and outcome/invariant references; every effective repo-local instruction file, including auto-loaded `AGENTS.md`, is frozen and cannot broaden authority. The manifest records included/excluded paths and data classes, provider disclosure, large-diff coverage, required missing context, and relevant repo-owned invariants and decisions. Token bounds apply to supplied context rather than pretending to bound autonomous reads. Observed worker reads are recorded only when the adapter exposes them and otherwise labeled `unavailable`; private chat and harness summaries never become authority. `contextEpoch` is the canonical digest identity of this immutable per-invocation context manifest, not a mutable counter, session, context registry, or conversation branch.
7. **JIT planner**: creates an outcome DAG and compiles one execution slice plus an impact manifest with scope, commands, risk, decisions, budget, stop conditions, acceptance/invariant/scenario references, affected surfaces, and unresolved impact.
8. **Control plane**: owns state transitions, approvals, cancellation, deadlines, retries, event receipts, invalidation, and reconciliation.
9. **Workspace and execution manager**: fetches exact base, creates disposable worktrees, enforces paths, persists each canonical redacted invocation-envelope and worker-profile record plus digest before wake, launches the worker, and runs declared commands under the qualified trust mode. Raw prompt/context payloads are excluded from the durable envelope record.
10. **Validation and scenario engine**: invokes native commands, selects risk-applicable tiers, maps trusted results to required IDs, distinguishes new-behavior completion from prior-behavior preservation, and blocks non-executed or unresolved required cases.
11. **Review and repair coordinator**: freezes the committed candidate, obtains isolated-context review, preserves all findings, groups causal families, and permits one systemic repair batch before escalation.
12. **GitHub delivery adapter**: pushes the already committed exact candidate, opens a draft PR, monitors checks/reviews, reconciles ambiguity, and observes human merge.
13. **Audit and qualification engine**: runs bounded code/app/operations audits and longitudinal qualification, captures durable scenarios and source-qualified metrics, and emits findings without changing current policy.
14. **Future feedback and improvement engine**: after its post-alpha trigger, deduplicates eligible signals into persistent diagnostic cases, identifies the first divergent step and violated invariant, proposes replay cases, and may prepare an isolated improvement candidate for independent evaluation and human promotion. It is not part of the v1 runtime or public-alpha gate.

### 8.3 Minimal durable object model

Mill should keep seven conceptual objects:

1. `ManagedRepository`: repository identity, commands, required worker capabilities, quality posture, trust ceiling, and sensitive exclusions. It expresses capability and trust requirements without pinning an internal adapter name or version.
2. `ProductContract`: source digest, users/JTBD, outcomes, non-goals, constraints, success metrics, assumptions, acceptance groups, and stable invariant IDs with source, owner, criticality, affected surfaces, and verification method.
3. `Blueprint`: architecture, stack/recipe, data, security, deployment, quality capabilities, and decision records.
4. `ScenarioSet`: approved representative scenarios, oracle ownership, execution refs, and acceptance/invariant links.
5. `OutcomePlan`: dependency DAG and JIT delivery slices without mutable run status. Each JIT slice contains an immutable approved impact manifest rather than creating another top-level authority.
6. `Run`: operational states, ordered append-only role- and attempt-specific `WorkerInvocation` admissions with the phase, canonical redacted envelope/profile records and digests, worker-launch intent/start markers, terminal settlement, external lifecycle/readback state, and append-only events. Build, review, retry, and repair may use different profiles; drift before the next invocation blocks or stales it rather than rewriting earlier records.
7. `Candidate`: immutable base commit, candidate commit/tree, policy/product/scenario digests, impact-manifest digest, scope, and stable item-level evidence references. Review, PR, merge, release, and audit transitions belong to `Run`, not Candidate.

Schemas should evolve additively. Unknown major versions fail with a migration instruction; unsupported newer data must never be interpreted permissively.

`WorkerProfile` and `InvocationEnvelope` are nested, per-invocation versioned
operational contracts, not new top-level product-truth objects. Delivery invocations
nest under `Run`. This preserves the seven-object model and prevents harness
configuration from becoming a parallel plan or session authority.

If the future read-only specification/research planner is implemented, calls made
before a product proposal is promoted use the same immutable invocation-admission
shape under the transient staged-proposal record already held in local operational
state. Public alpha makes no such call: it assesses supplied files deterministically.
Future planner calls are not forced into the delivery `Run` state machine, and their
output grants no later run authority. Once approved product truth and a delivery
slice exist, builder, reviewer, retry, and repair invocations are ordered under
`Run`. A staged proposal is an approval buffer, not an eighth durable product-truth
object.

Stable IDs and relationships form a derived dependency view over these repo-owned objects. v1 does not add a graph database, vector-memory authority, or separately editable system map. Any generated graph is a projection and must identify its exact sources.

## 9. Downstream repository integration contract

Mill is consumed as an exact released package selected by each repository. A convenience global CLI may exist, but it is not authority and must refuse a version mismatch while printing the exact package-manager invocation for the locked release; v1 does not transparently delegate. A downstream repository must not require:

- a sibling Factory or Mill checkout;
- a Git submodule;
- copied skills, schema catalogs, standards bundles, daemon configs, or reference runtimes;
- committed raw run evidence, prompts, logs, claims, leases, review exhaust, or journals;
- Mill as its native build system.

### 9.1 Proposed compact downstream footprint

```text
AGENTS.md
mill.yaml
mill.lock
product/PRD.md
product/contract.yaml
product/plan.yaml
architecture/blueprint.yaml
architecture/decisions/*.md          # only when an ADR trigger occurs
quality/scenarios.yaml
README.md
docs/development.md
.github/workflows/ci.yml              # or native provider equivalent
```

Rules:

- `mill.yaml`, the approved contract/blueprint/plan, and the native repo commands are authoritative.
- `product/PRD.md` remains the narrative source, not runtime authority.
- Stable invariant IDs live inside the product contract or a mapped repo-native equivalent; scenario and plan references use those IDs instead of duplicating invariant prose.
- `AGENTS.md` is concise, repo-owned guidance and command routing. It cannot grant capabilities. It points workers to typed truth rather than duplicating it.
- `mill.lock` binds the exact Mill, project-schema, and recipe versions used to generate or qualify the pack. Per-invocation observable adapter/harness/model/configuration identity and role-specific profile remain operational evidence because operator installations and mutable provider models are not repo-owned product truth.
- Existing repositories may map these concepts to repo-native equivalent paths through `mill.yaml`; adoption must not create duplicate authorities merely to match the preferred layout.
- Templates are one-time starting points. `mill.lock` distinguishes Mill-only removable files, generated-once downstream-owned files, and narrowly managed adapters. It records recipe instance, generation input digest, original template identity/digest, and expected managed digest.
- Mill-generated projections declare their source and generator identity. Future upgrade uses an origin-aware three-way proposal and never silently overwrites human changes.
- Run SQLite, raw logs, prompts when explicitly retained, screenshots, worktrees, and grants live in user-only OS application-state/cache directories keyed by repository UUID, canonical Git common-directory/checkout identity, and run UUID. Credentials never live there; only opaque provider/keychain references may be stored.
- Durable decisions, product scenarios, regression tests, and native CI remain in Git. Compact result summaries live in PRs/checks/releases rather than a committed evidence tree.
- A repository remains installable, buildable, testable, and understandable after Mill is uninstalled.

### 9.2 Authority precedence

| Concept | Authority | Projections/consumers |
|---|---|---|
| Product behavior, acceptance, and stable invariants | `product/contract.yaml` or mapped equivalent on canonical Git base | PRD, docs, impact manifests, task packets |
| Architecture boundaries and costly decisions | blueprint plus triggered ADRs | generated architecture view, review packet |
| Outcome ordering/scope and approved impact | approved outcome plan and JIT impact manifest | optional tracker projection, task packet |
| Scenarios/oracles | approved scenario set and native tests | item-level validation/review reports |
| Native command implementation | package manager, Make/Task target, or exact repo script | CI and Mill runner |
| Mill command mapping/capability | stable command ID to argv/cwd/capability in `mill.yaml` | plans select IDs and never redefine argv |
| Operational state | Mill state DB plus external-provider readback | status UI/JSON |

Drift between a mapped command and its native implementation blocks qualification. Docs explain these authorities but do not override them.

### 9.3 Repository and forge identity

- `ManagedRepository` configuration binds a repository UUID, normalized forge host, owner/repository identity, canonical base branch, and allowed remote name/URL.
- A copied fork does not inherit `propose` authority. Host/owner/remote changes invalidate remote capability and require explicit rebind/adoption approval.
- Normalize and validate SSH/HTTPS URLs, user-info, redirects, and lookalike hosts before any remote effect.
- Local run state does not follow a clone automatically. A second clone starts with Git-authoritative product truth and its own run state/credentials; in-flight runs are not portable in v1.

### 9.4 Greenfield flow

1. `millctl new <dir> --prd <file> --sources <file> --proposal <file> --github <owner>/<repo> --dry-run`
   - read the PRD, disclosed source manifest, operator-supplied structured proposal, and optional existing target inventory;
   - classify supplied sources and validate proposal, product contract, scenarios, approved blueprint, selected recipe, native commands, quality tiers, trust ceiling, and file plan;
   - make no repository, process, or remote mutations.
2. Present product and architecture approval cards with sources, freshness, confidence, unknowns, tradeoffs, and requested decisions.
3. `millctl new ... --apply`
   - after approval, create the local repository transactionally;
   - write the exact approved staged product/blueprint/plan bytes, repo-owned provider/data policy, and file plan, then generate the compact repo footprint, native stack, CI, smoke scenario, and initial outcome plan;
   - run static and deterministic bootstrap checks;
   - initialize Git and create the initial canonical commit that binds the approved staged bytes and generated file plan; if the transaction or required bootstrap check fails, create no authoritative partial commit;
   - do not create or configure a remote in v1; GitHub repository creation and protection remain an explicit manual maintainer step through public alpha.
4. `millctl doctor` reports local readiness without executing repository code.
5. `millctl qualify` proves clean install/build/test/package/scenario behavior in a disposable environment.
6. Start the first low-risk attended slice with `millctl run next --attended`.

A future inspect-only planner may research and draft the structured proposal,
scenario set, and two or three blueprint candidates before step 1. That path is
not implemented or included in the public-alpha claim, and its draft still requires
human review plus the same exact assessor/promotion gate.

### 9.5 Existing repository retrofit

1. `millctl adopt --scan-only` performs a static inventory of code, manifests, declared commands, CI, docs, likely boundaries, secret references, historically observable provider failures, and ambiguity. It does not run repo commands and cannot claim an executable baseline.
2. The report classifies every conclusion as observed, inferred, missing, or conflicting and includes confidence/source refs.
3. Preserve the current stack, style, commands, and authoritative documentation unless the product decision explicitly changes them.
4. If two existing files claim the same authority, stop for disposition rather than adding a third.
5. `millctl adopt --apply` creates one reviewable adoption branch in an isolated transactional worktree with the smallest useful contract/lock and links native commands.
6. Record the executable baseline as `unverified` until `millctl qualify --baseline` runs declared native checks in an isolated environment before the first Mill-authored product change. Do not relabel pre-existing failures as Mill regressions or silently approve them.
7. An integration-only adoption starts at `inspect`. `build` requires an approved product/scenario/blueprint gate; `propose` requires separate remote qualification.

### 9.6 Ongoing use

- `millctl plan <prd-or-change>` drafts or updates product truth, invariants, the outcome DAG, and the next impact manifest.
- `millctl approve` records a scoped human decision against exact artifact digests.
- `millctl run next --attended` selects one ready outcome and drives its local lifecycle.
- `millctl status` reports run, candidate, blockers, owner needed, cost, and next action.
- `millctl verify` runs the applicable frozen-candidate gates and reports new-behavior and preservation evidence by required ID.
- `millctl review` obtains isolated-context review of the exact candidate.
- `millctl ship --draft` publishes only the verified candidate.
- `millctl audit` runs a selected code/app/release/operations audit and emits proposed findings.
- `millctl resume` and `millctl cancel` are explicit recovery controls.
- `millctl qualify [--baseline]` runs clean-environment repo/readiness qualification; it is distinct from static `doctor` and candidate-specific `verify`.
- `millctl auth status` reports only adapter-observable readiness plus clearly labeled operator declarations and never prints credentials.
- `millctl doctor` is truthful and non-mutating unless a separate qualification command is invoked.

The public CLI should remain near these verbs; internal artifacts and workers do not receive their own top-level commands. Every command supports stable JSON output.

### 9.7 Versioning, upgrade, rollback, and detach

- Version the CLI/runtime, project schema, and recipes separately. An internal worker contract version is recorded per invocation only when its structure actually changes; it is not a downstream package dependency.
- `mill.yaml` declares supported Mill/schema/recipe ranges; `mill.lock` records exact resolved versions and digests.
- During initial `0.x`, support the current stable release and exact-version refusal. Immutable historical releases and checksums remain discoverable so an old lock can invoke its compatible tool. Do not promise a prior-schema migration until a real released schema transition and fixtures exist.
- Public alpha provides exact-version pinning, release withdrawal/reinstall guidance, and restoration to the pre-Mill integration snapshot; it does not claim cross-version rollback or expose speculative `upgrade --check`, `upgrade --plan`, or `upgrade --apply` commands. The first real post-alpha migration supplies the compatibility metadata, three-way generated-file behavior, state backup/downgrade evidence, and concrete UX needed to design a truthful read-only upgrade plan.
- When later justified, upgrade planning displays release notes, recipe/config/generated-file diffs, compatibility effects, state migration, and required validation. Any future apply requires an exclusive repository-state lock, all runs terminal/cancelled, a versioned database backup, downgrade proof, and an isolated local migration branch. Publishing uses the normal `ship --draft` path rather than an upgrade side channel.
- Once a real migration path exists, cross-version rollback restores Git config/lock, uses the external package manager to invoke the pinned compatible release, and restores the compatible database snapshot. Mill does not reinstall itself and performs no irreversible background migrations.
- `millctl detach --plan` inventories Mill-integrated files, native files to retain, local state, provider hooks, app installations, and credentials to revoke. It deletes nothing.
- Public alpha proves manual detachment, native operability, local-state purge, and static exports. Automated `detach --apply` is deferred until ownership metadata has survived a real upgrade; when added it creates only an isolated local branch and publishing uses `ship --draft`. It removes Mill-only surfaces by default, retains downstream-owned files, and exports simple documented/static forms when retained contracts would otherwise require Mill to understand.
- Detach acceptance requires a fresh clone to install, build, test, package/deploy, and remain understandable without Mill.

### 9.8 CI integration and cost control

- Native repo commands remain authoritative; Mill invokes them rather than replacing the build system.
- CI runs the same selected required-candidate command definitions used locally. Slow risk/milestone tiers remain separately activated.
- A Mill conformance check may be installed as a pinned release/action, but product build/test/release must not depend on a sibling checkout.
- Mill should push at most once per candidate and use concurrency cancellation for controllable superseded heads, least-privilege permissions, explicit timeouts, dependency caching, and path-aware risk lanes where trustworthy. Provider/maintainer/merge-queue reruns are reported, not falsely prevented.
- Slow performance, soak, broad browser, and supply-chain audits run only on applicable release/milestone/scheduled triggers.
- CI on fork PRs receives no secrets and cannot publish.
- Local fast/targeted gates run during agent iteration; complete required local validation runs once on the frozen pre-push candidate.

### 9.9 Authentication and billing

- Mill has no account or SaaS login in v1.
- Each operator authenticates separately with Codex and `gh`; credentials remain in those tools or the OS keychain and never enter Git, prompts, or run evidence.
- `millctl auth status` reports only observable provider readiness plus labeled operator declarations such as billing owner. Account class or cost is `unavailable` unless the adapter can prove it.
- The operator's own Codex and GitHub account bears the initial costs.
- A second founder cloning a managed repository uses and pays through their own identities.
- Attended v1 may use local `gh` credentials only in the shipper boundary.
- Unattended work later requires short-lived GitHub App installation tokens and an explicit model/service billing identity. Long-lived PATs are not the default path.
- Deployment/provider secrets use named references to OS or CI secret stores and are minted just in time where possible.
- Before any model call, Mill shows/freezes provider identity, endpoint/account class when observable, files/data classes to be sent, sensitive exclusions, redaction, request purpose or summary, and observable retention posture. Public-alpha proposal assessment, greenfield planning, and adoption planning use no model or network call. Builder and reviewer calls receive only their exact `build`/review task grants. A future web-research planner requires a separate inspect-only network grant; research is never an implicit consequence of supplying a PRD.
- A repository-level provider/data policy plus the attended invocation grants only the preflight-disclosed model calls within that frozen policy and budget. Before a greenfield repository exists, a target-bound staged bootstrap provider/data policy in local state supplies the same narrow future-planner boundary; the approved initial canonical commit installs the repo-owned policy, which supersedes the staged record. Showing the frozen disclosure is preflight, not a third product decision card. A new provider, data class, egress destination, retention posture, or broader provider-visible repository scope is new authority and causes a stop for explicit approval.
- Record the exact observable adapter, internal worker-contract, and harness version, model alias/version, prompt-template/configuration-profile digest, declared tool/resource-loading posture, startup network/update/telemetry posture, and recipe identity for each invocation. Raw prompts and executable paths stay out of public evidence. If a provider does not expose an immutable model version or a harness posture cannot be observed, label it mutable or unavailable rather than pretending it is pinned; a detected material profile change triggers matched canary requalification before widening trust.

### 9.10 Tracker integration

- The approved `product/plan.yaml` is canonical for scope and dependency ordering.
- GitHub Issues/Projects are explicitly deferred beyond public alpha. Their future form is a one-way projection after plan approval.
- Issue edits, comments, and labels become intake proposals; they do not silently change product truth or task authority.
- Runtime status comes from Mill state plus GitHub readback, not committed status files or closure-only PRs.
- Bidirectional synchronization is deferred until real use proves it necessary.
- Post-alpha feedback connectors are optional adapters into one Mill-native signal/case contract. Slack, GitHub Issues, Linear, email, or another source does not own classification, deduplication, product truth, task authority, or lifecycle state.
- The first feedback slice starts with explicit local import or one read-only source. It proves `answer`, `duplicate`, `route`, `fix_candidate`, and `planning_required` dispositions before any write-back or automatic PR-author handoff is considered.

### 9.11 Multi-repository seam

v1 operates on one managed repository serially. Use `ManagedRepository` for that authority unit, `Product` for a possible future group, and `Workspace` for one local checkout. The future seam is:

- repository is the unit of authority, checkout, candidate, PR, merge, and rollback;
- a product may reference stable repository IDs in an external coordination manifest;
- cross-repo work compiles into per-repo slices with independent policies and PRs;
- no atomic cross-repo delivery claim;
- producer output is validated/released as an exact artifact digest, then consumed and pinned by the downstream repository;
- Tier 12 scenarios prove compatibility at that boundary;
- multi-repo implementation begins only after a real producer/consumer case demonstrates the need.

### 9.12 Founder golden path, CI, and merge experience

The normal managed-repository experience must not require manually orchestrating
every internal worker. Wave 4B's primary attended entrypoint is:

```sh
millctl start --prd product/PRD.md --attended [--draft-pr]
```

Initial greenfield and adoption onboarding remain explicit public-alpha flows. The
operator supplies a PRD, disclosed source manifest, and structured proposal; Mill
assesses that proposal without a model or network call. The human first approves
the exact product proposal and then the exact integration plan. `new --apply` or
`adopt --apply` performs only that approved transactional integration. Greenfield
bootstrap, initial adoption, and later managed delivery are not silently conflated
inside `start`.

For an already managed repository, `start` is a resumable coordinator over the same
typed state and narrow commands, not a second workflow. It:

1. verifies exact Mill/schema/recipe compatibility, PRD/source/product/plan/impact/task authority, every nonterminal run, repository/base/worktree state, required OCI/Codex readiness, expected authority, and destination/`gh` readiness only when draft-PR delivery is requested, before dependency or model spend;
2. reports one exact setup or resume action when a required runtime, credential, destination, authority, or input is missing;
3. selects exactly one already approved ready outcome and rechecks the no-conflicting-run condition under the writer lease rather than generating or reinterpreting product truth;
4. resumes or performs the existing build, candidate commit, item-level new/preservation verification, isolated-context review, remote readback, and closure lifecycle;
5. pauses for a stop condition, P0/P1 finding, new authority, consequential ambiguity, exhausted budget, or unresolved external effect;
6. when requested, returns the exact draft-PR plan and requires the separate attended approval before mutation; `ship --draft` remains the explicit alternative;
7. opens or observes the reviewed draft PR and returns `awaiting_human` with its URL and one next action; and
8. after the configured human marks ready and merges, reads GitHub and native main checks before truthful closure.

The founder does not select or manage conversational sessions. Normal status keeps
worker internals out of the primary path; it reveals the frozen profile, drift, or a
diagnostic provider session identifier only when risk, incompatibility, settlement,
or support diagnosis makes that information actionable. Resume reconstructs
authority from Mill state and exact repository inputs. Harness branches, summaries,
queues, or todos are never presented as the delivery plan or as proof that an
outcome is complete.

The intended public-alpha journeys are therefore:

- **initial repository:** PRD + source manifest + structured proposal -> product approval -> integration approval/apply -> approved ready outcome; and
- **managed delivery:** `start` -> reviewed draft PR -> one final human promotion step (mark ready and merge).

The eventual PRD-only planner may compress initial onboarding only after it is
implemented and qualified. `plan`, `new`, `adopt`, `run`, `verify`, `review`,
`ship`, `status`, `resume`, and `cancel` remain expert, inspection, and recovery
commands. Because v1 has no daemon, a long wait exits durably and the next
invocation resumes it.

`--draft-pr` requires an already configured and explicitly approved GitHub repository, remote binding, and branch policy. When that flag or another `propose` grant is requested, the golden path preflights the setup before model work and, if it is absent, reports the exact manual GitHub/repository-protection steps plus the resume command. Local inspect/build is not blocked by absent `gh`. Mill does not provision or reconfigure the remote in v1.

The default human status names the outcome, lifecycle state, plain-language
preservation summary/count, risk, expected or consumed time/cost with provenance,
granted authority, one current blocker and owner, and one next action. An expanded
inspect view adds exact base/candidate/PR head, affected and uncertain invariant and
scenario IDs, required checks, item-level evidence, review generation, and worker
profile diagnostics. `--json` remains the complete stable projection. The user
should not need to inspect raw events or artifact directories to know what to do.

Generated repositories keep their native package/build/test commands authoritative. Mill proposes a compact required PR gate from those commands, adds only risk-applicable delivered-surface/scenario lanes, pins actions and tools, grants least privilege, cancels superseded controllable runs, applies explicit timeouts, and keeps release workflows isolated from fork artifacts and secrets. Fast targeted checks run during iteration; the complete required set runs once on the frozen local candidate and CI independently verifies the pushed head. CodeQL, dependency/secret checks, accessibility/browser/visual lanes, packaging, migrations, and deployment checks are required only when the repository's supported shape and risk profile make them applicable.

For the sole-maintainer v1, the repository-configured human maintainer, David for the Mill repository, may author, mark ready, and merge after all required machine gates and the exact-head review policy settle. `CODEOWNERS` routes ownership but must not create a fictional second-human approval. Automatic merge is excluded. Emergency bypass is explicitly logged and opens repair/audit intake; it is never reported as a normally qualified delivery.

## 10. Product-contract assessment and future stack-intelligence pipeline

### 10.1 Input handling

Public alpha accepts one PRD, a disclosed source manifest, an operator-supplied
structured proposal, and an optional existing repository. The manifest records
source, timestamp/revision, authority class, freshness, and claims. Supporting
documents, screenshots/designs, interviews, constraints, and web research may be
referenced as disclosed evidence, but Mill does not yet autonomously acquire or
compile them. Web and repository content are always untrusted data.

### 10.2 Product-contract output

The public-alpha assessor validates and freezes an operator-supplied proposal with:

- target users, buyer/operator roles, and JTBD;
- current workflow/status quo and pain;
- desired outcome and measurable success;
- grouped functional and non-functional acceptance outcomes;
- stable system invariants, each with source, owner, criticality, affected surfaces, verification method, and explicit unknowns;
- exclusions and non-goals;
- assumptions, contradictions, unknowns, and decisions required;
- security, privacy, data, compliance, accessibility, localization, performance, and operational constraints;
- for user-facing products: information architecture, critical flows, design-system choice, responsive states, accessibility baseline, and which visual decisions require human approval before implementation;
- evidence sources and confidence;
- question budget and recommended defaults for reversible choices.

Human approval promotes the exact canonical bytes and digest of the structured contract. Before Git exists, this is a staged seed approval for the initial commit only; after bootstrap, accepted canonical-branch commits provide portable product/blueprint/plan authority, while local approvals remain run-scoped receipts. The assessor cannot approve authority. A future planning worker may draft the same shape but cannot promote it. Invariants are intentionally compact and behavioral; they are not a generated restatement of every file, symbol, or implementation detail. Wave 4 begins with only the highest-consequence invariants and expands only when observed gaps justify it.

### 10.3 Stack and dependency research

This is the target behavior of a later bounded inspect-only planner; it is not part
of the public-alpha support claim or Wave 5 scope. When implemented, the stack
advisor runs at greenfield bootstrap, adoption when the existing stack is
materially in question, or an explicitly scoped stack/dependency change. Ordinary
delivery slices reuse the approved frozen blueprint and lock; they do not repeat
open-ended framework research on every change. When research is triggered, it must:

1. Extract constraints: product shape, runtime, deployment, latency, data, security/privacy, integration, accessibility, team, support, and cost.
2. Search primary framework documentation, official package registries, security advisories, licensing sources, release/maintenance history, and deployment-provider compatibility.
3. Treat search content as untrusted evidence and retain source URL/revision/freshness.
4. Produce two or three viable candidates with explicit scores and tradeoffs.
5. Prefer stable supported releases over novelty or raw recency.
6. Identify lockfile, update policy, SBOM, license, and rollback behavior.
7. Present costly-to-reverse or publicly visible choices for approval.
8. Freeze the chosen blueprint and recipe version before implementation.
9. Handle later upgrades as ordinary reviewed outcomes, never mutate the stack mid-run.

The system should say “best current fit under these constraints,” not “latest optimal stack.”

Research may recommend a stack that Mill cannot yet instantiate safely. `new --apply` must block until a matching recipe and qualified support tuple has a clean canary, or produce a planning item to add that recipe. Research evidence alone cannot authorize generated infrastructure.

### 10.4 Plan invalidation

Every task and approval records dependencies on product sections, stable invariants, scenarios, blueprint decisions, recipe/toolchain versions, lockfile, base SHA, required checks, permissions, and deployment policy. When one changes:

- mark only dependent slices `stale`;
- explain the invalidation cause;
- recalculate the affected impact closure and preserve unresolved impact rather than guessing it away;
- preserve unrelated approved decisions;
- require reapproval only where authority or externally observable behavior changed;
- never keep executing a task against a silently changed plan.

## 11. Development and architecture standards

### 11.1 Generated repository development profile

Every bootstrapped or adopted repository declares:

- exact runtime/toolchain pins and lockfiles;
- canonical bootstrap, format, lint, typecheck, build, test, package, and audit commands;
- native CI lanes and required checks;
- numeric coverage posture appropriate to the stack;
- dependency, license, security, and release-integrity checks;
- docs/quickstart parity requirements;
- machine-readable API/CLI/schema contract expectations;
- test of the packaged/deployed artifact where relevant;
- explicit, expiring exceptions for applicable missing controls.

### 11.2 Architecture questions

For a material design or change, the blueprint or review must answer:

- Which previously accepted behaviors, interfaces, data properties, and operating obligations must remain true?
- Where is authoritative state?
- What are the module/system boundaries and public contracts?
- Where do side effects occur and who authorizes them?
- What is the behavior on partial failure, ambiguity, timeout, retry, and cancellation?
- What trust, security, privacy, and data boundaries apply?
- What are latency, capacity, resource, and cost budgets?
- How are schemas, data, dependencies, and public contracts migrated?
- How is the change rolled back or the component deleted?
- How will runtime behavior and business outcome be observed?

For a boundary-changing task, the approved impact manifest also records new
dependencies, public-contract or schema changes, migration/compatibility posture,
rollback or deletion path, security and operational obligations, accepted debt, and
the trigger for revisiting that debt. Mill does not reduce these consequences to a
single automated maintainability score.

Require an ADR only for costly-to-reverse public contracts, state/persistence, trust boundaries, major dependencies, deployment topology, and consequential failure semantics.

## 12. Quality system and realistic scenario testing

### 12.1 Twelve-tier capability matrix

Mill preserves this taxonomy:

1. Unit
2. Integration
3. End-to-end
4. Acceptance
5. Hardening
6. Chaos/fault injection
7. Performance
8. Soak
9. Contract
10. UAT/installability
11. Realistic scenario
12. Cross-system integration

Every tier is declared `required`, `risk_triggered`, `milestone`, or `not_applicable` with a reason. The plan activates relevant tiers; it never turns all twelve into mandatory jobs on every edit.

v1 keeps the twelve tiers as planning guidance rather than implementing a universal twelve-tier runtime policy. Its executable kernel recognizes a small set of native, delivered-surface/acceptance, fault/security, and package/install gates. A recipe adds named tier mappings only when its supported behavior needs them.

Typical activation:

- ordinary logic: unit, integration, contract;
- user-visible behavior: acceptance, E2E, realistic scenarios, accessibility, visual/responsive checks;
- persistence, filesystem, concurrency, retry: hardening and fault injection;
- hot paths: performance and possibly soak;
- packages/releases: UAT against the packed or installed artifact;
- external dependencies: contract, degraded/recovery scenario, and cross-system checks.

### 12.2 Scenario contract

Representative scenarios are approved before task execution and include:

- stable ID and acceptance refs;
- invariant refs and whether the scenario proves new behavior, preservation, or both;
- actor/role and authority;
- starting state and material data;
- trigger/action;
- external systems and environment;
- expected observable outcome;
- forbidden outcomes;
- degraded and recovery behavior;
- privacy/security/accessibility/performance expectations where relevant;
- execution entrypoint and test/digital-twin reference;
- oracle owner and visibility (`builder_visible`, `reviewer_owned`, or `human_acceptance`).

Required classes include:

- common/happy journey;
- boundary and exception;
- dependency degradation;
- failure, retry, recovery, cancellation, and resume;
- permissions and cross-role behavior;
- migration/backward compatibility;
- adversarial/abusive input;
- operational and post-deployment behavior.

Medium/high-risk work requires at least one delivered-surface scenario and one
relevant exception, degradation, adversarial, recovery, or novel-input scenario.
When a meaningful semantic property can be expressed more directly than examples,
the scenario may use property-based, metamorphic, differential, model-based, or
mutation-backed verification. These are risk-selected techniques, not universal
mandatory jobs.

Scenarios should come from observed workflows, user evidence, support incidents, API contracts, threat models, status-quo systems, and escaped defects—not merely an LLM paraphrase of the PRD.

### 12.3 Scenario execution and oracle rules

- Prefer real entrypoints: browser against preview, public API, installed CLI/package, actual migrations in an isolated database, or a deterministic provider twin.
- Mocks may isolate narrow units but cannot prove integration outcomes they replace.
- Every required acceptance, invariant, and scenario ID maps to a specific executed command/test result, explicit human attestation, or blocking unsupported state. A digest match, prompt mention, reviewer assertion, or generic green suite cannot by itself close an item.
- Candidate evidence reports feature/new-behavior completion separately from preservation of affected previously accepted behavior. Unknown or uncovered impact blocks or requires an explicit expiring exception; it never becomes an implicit pass.
- Visual acceptance requires an approved design baseline; the builder cannot generate and approve its own snapshot.
- Visible deterministic cases plus isolated-context review and human acceptance are the v1 baseline. Protected hidden holdouts are added only after their storage and isolation are proven; when used, their expected outcomes and promotion graders live outside builder write scope.
- A builder may propose oracle changes only as explicit scope; those changes take effect in a later run after independent approval.
- Required scenarios marked skipped, flaky, unsupported, or `pending_executable` block promotion unless an explicit expiring human exception exists.
- Retrying a flaky required test until green is not a pass.
- Every machine-executable promotion evaluator change includes a negative control showing a known-bad implementation fails. Subjective human/visual or advisory scenarios use documented oracle calibration; property, fuzz, metamorphic, differential, and mutation techniques are risk-triggered rather than new mandatory tiers.
- Visible scenarios and hidden holdouts remain distinct.

### 12.4 Validation schedule

1. Before code: approve representative scenarios, impact manifest, and validation contract.
2. During iteration: run fast and directly affected checks.
3. Frozen candidate: run every required applicable tier once locally and emit item-level new-behavior and preservation evidence.
4. Before push: run isolated-context review on the exact candidate.
5. PR: run independent required CI once per current head.
6. Preview/canary: run critical user and operational scenarios where applicable.
7. Post-merge: observe required checks and smoke/readback.
8. Milestone: run full product, architecture, security, UX, operations, and release audit.

Worker-adapter conformance is a contract lane, not another product test tier. A
deterministic fake worker must cover strict event framing, partial/truncated and
malformed records, missing or conflicting terminal results, duplicate exact
admission versus conflicting identity reuse, capability/profile mismatch,
cancellation, deadline/output exhaustion, context drift before wake, and
harness/config-version drift. Unknown advisory progress events may be ignored;
unknown required terminal contracts fail closed. Concurrent tests wait on
published readiness signals rather than fixed sleeps except when elapsed time is
the behavior under test.

The selected public-alpha recipe also has a longitudinal schedule: replay a small
dependency-ordered change sequence from the agent's own prior accepted output and
measure preservation after every step. This is qualification of Mill plus its
model/harness/recipe combination, not a normal per-PR CI lane.

## 13. Execution, state, containment, and recovery

### 13.1 Runtime state machine

Common delivery progression:

```text
approved -> ready -> running -> committed -> verified -> reviewed
-> proposing -> awaiting_ci -> awaiting_human -> merged
-> post_merge_verified -> closed
```

Product proposals exist before a `Run` and are promoted separately; `Candidate` is
an object bound when the run commits, not a lifecycle status. Release, deployment,
and audit are optional capability-specific branches observed after the common
delivery path; they are not mandatory states for every change. The public contract
also uses typed `blocked`, `cancelled`, `failed`, and `stale` states. `effect_unknown`
is the recoverable state for an external effect whose result requires readback.
Derived status is never authoritative over Git/provider readback.

### 13.2 Required runtime properties

- One active writer per repository/worktree.
- Exact fetched base, candidate, and policy digest binding.
- Before each worker spawn, atomically persist an immutable invocation admission covering the owning operation/phase/attempt identity, applicable authority-root and input-set digests, exact base/candidate/task/impact manifest when that phase has them, supplied-context epoch and provider-visible scope, role-specific worker profile, allowed scope, budgets, and required output contract. Persist its canonical redacted record and digest, then durable worker-launch intent/start markers around subprocess spawn. Re-observing the same identity returns the existing admission and may launch it only when durable state proves Mill never began worker launch; a conflicting envelope fails closed. Once launch began, the attempt is conservatively possibly started because Mill cannot observe Codex CLI's internal provider request. A possibly started mutating attempt is reconciled, never replayed. Any later execution uses a new invocation ID and a proven safe checkpoint.
- Atomic state transition plus evidence/reference update.
- Cancellation and kill control.
- Absolute deadline plus token, output, process, network, CI, and retry budgets.
- Resume only from a completed safe checkpoint.
- Use at-least-once only for idempotent state transitions and external effects that have authoritative provider readback and duplicate-safety semantics; do not apply it to model-authored workspace mutations or claim exactly-once execution.
- Base or candidate drift invalidates affected validation/review/approval.
- Cleanup never modifies the user's dirty checkout or destroys the only recovery evidence.
- Unknown push/PR/comment outcomes enter provider-readback reconciliation rather than retry. Unknown model outcomes use Mill's process/workspace reconciliation and retain provider settlement or cost as unknown when it cannot be proven.
- Auth expiration, GitHub outage, CI cancellation, dependency outage, disk full, worker crash, timeout, and base movement have explicit failure behavior and scenario tests.
- The builder creates a lifecycle-owned local candidate commit before promotion validation. Validation and review bind the exact base commit, candidate commit/tree, product/policy/scenario digests, and a clean post-commit worktree. The shipper may push that commit but cannot create, amend, or replace it. Any repair creates a new commit and invalidates prior candidate evidence.
- State writes use transactional schema-versioned storage, crash recovery, restrictive user-only file permissions, backup/restore, and a minimal redacted event schema before remote effects are enabled.
- For every external mutation: persist a durable intent before the call; embed an immutable delivery key in branch/PR identity where possible; persist provider response before publishing local success; block the call if intent persistence fails; and require readback/attended reconciliation when the outcome is unknown. Fault tests cover crash before call, after effect/before receipt, after receipt/before response, and restart.
- Worker progress, partial messages, provider reasoning, session trees, compaction summaries, and todo state are diagnostic only. Builder settlement requires process completion plus independent inspection of the exact repository state; its final prose is advisory. Reviewer settlement additionally requires the declared structured result bound to the exact candidate. Neither may advance from progress events alone. The adapter normalizes spawn, progress, cancellation, and terminal results; Mill's control plane alone admits invocations and advances lifecycle authority.
- v1 has no authority-changing steering channel. A human message that changes scope, acceptance, invariant disposition, capability, destination, or oracle creates a new proposal and stales affected approval; it is never inserted as an invisible in-session override.

### 13.3 Workspace and containment tiers

- Static inspection never executes repo code.
- Builder uses a fresh worktree with canonical path checks, symlink-escape protection, allowed-path enforcement, and no ambient forge/deploy credentials.
- Build and test commands run in disposable OCI where available, with bounded mounts, resources, output, and network.
- The landed Wave 2 isolation/auth feasibility spike established which worker subprocesses pass through the controlled runner and whether a sanitized environment/isolated home preserves model auth without pretending to remove host authority. Any material worker/harness/profile change requalifies that conclusion.
- If those controls cannot be enforced, personal Codex execution on the host is offered only in `attended-trusted-host` mode. Mill may detect repo-scope violations and block promotion but must not claim it prevented unrelated host filesystem access, command execution, keychain discovery, or `gh` access.
- Before Mill claims hostile-repository or unattended execution, qualify the entire worker boundary in a container/VM with controlled egress and a safe short-lived credential design. Mounting a Docker socket, host home, or persistent Codex/GitHub credential invalidates that claim.
- New dependencies, workflow changes, migrations, destructive commands, new egress destinations, or access beyond the worktree require explicit capability approval.

### 13.4 Command policy

- Commands are declared by the repository as exact entrypoints or argv arrays and executed through normal process APIs.
- Mill does not implement a general shell parser.
- Structured formats use real parsers and schemas; prose scraping cannot grant execution authority.
- The repo remains capable of running the same commands without Mill.
- Worker startup uses the frozen minimal profile: no repository worker-plugin/extension-package auto-install, no generic skill or prompt-template discovery, and no MCP auto-discovery. Startup update/catalog/telemetry network behavior is disabled where the harness exposes enforceable controls; otherwise record it as unknown or active and withhold the stronger no-network/deterministic-profile claim. This does not prohibit ordinary approved downstream application dependencies.
- Every effective repo-local instruction file is frozen with the invocation context. Such guidance may narrow execution or add compatible implementation constraints, but it cannot broaden typed authority or override the task, impact manifest, allowed paths, command/oracle closure, or trust ceiling; a contradiction blocks before worker wake.
- Tool permissions and allowlists are defense-in-depth declarations, not containment. Filesystem, process, network, and credential prevention claims require an independently qualified operating-system, container, or VM boundary.

## 14. Review, repair, shipping, and closure

### 14.1 Review packet

Every human checkpoint displays:

- decision requested and why now;
- exact outcome, candidate, and risk;
- approved impact manifest, affected invariants, and unresolved impact;
- sources, freshness, confidence, and assumptions;
- proposed diff/artifact;
- passed, failed, skipped, unsupported, and uncertain checks;
- expected external effect and readback method;
- cost/time consumed and remaining budget;
- approve, edit, reject, defer, cancel, and inspect actions.

### 14.2 Review convergence

- Freeze the complete candidate before review.
- Use a fresh read-only reviewer context and the complete relevant diff plus the approved impact manifest and product/invariant/scenario/architecture context.
- Rebuild reviewer context from the exact candidate and selected repo-owned sources. A builder session continuation, branch summary, or compacted conversation may be disclosed as untrusted diagnostic material but cannot replace this reconstruction.
- Collect one complete review generation before changing code.
- Preserve findings losslessly and deduplicate by semantic/causal family.
- Rank and compress the human presentation rather than discarding evidence. P0/P1 and protected correctness, security, authority, data-loss, provenance, or compatibility findings are never hidden by a comment cap. A configurable display cap may apply only to deduplicated P2/P3 findings, with the complete machine-readable inventory retained and inspectable.
- Require concrete changed-file/line evidence where the finding is local. Do not require an arbitrary short quote for cross-file architectural, lifecycle, or omission findings; those must instead name the exact violated contract and supporting locations.
- Maintain one shared normal systemic-repair budget across local and remote review. A local repair consumes it; later remote findings do not create a second normal repair allowance. After the one repair, rerun affected validation and one exact-head review.
- If a P0/P1 recurs in the same subsystem, return to design rather than adding special cases.
- During pre-push review, a standalone low-risk P2 may receive only provisional human disposition based on complete local gates. Final acceptance as debt requires the remote current head, required CI green, and explicit human authorization. Correctness, security, data loss, provenance, compatibility, or authority findings are protected regardless of label.
- Isolated-context agent review is not described as organizationally independent human review when David remains the sole maintainer.

### 14.3 Draft-PR shipping

- The shipper verifies that the already committed candidate SHA equals the reviewed and validated SHA before push/PR. It never creates or amends the candidate commit.
- It uses the local operator's `gh` identity only for the approved repository and action.
- Commit authorship/signing is operator-selected and never forged; the PR discloses Mill/Codex assistance and binds the run/model/harness identity without pretending the agent is a human signer.
- PR creation is draft-only in v1.
- PR description summarizes outcomes, scenarios, checks, risks, and run identity without embedding raw sensitive logs.
- Required CI/review settlement is observed against the latest head.
- New latest-head remote findings are collected as one complete generation, grouped with existing causal families, and may trigger the one attended systemic repair on the same PR only if the shared local/remote budget is still unused. The new local commit repeats validation/review and exact-head binding. Recurring P0/P1 or exhausted repair budget returns to planning rather than generating endless commits.
- Human merge remains explicit.
- With no daemon, `ship --draft` may poll only for a bounded interval and then enters `awaiting_human`; later `status`, `resume`, or an explicit observe operation reconciles GitHub state.
- Mill reads back the actual merge SHA and post-merge checks before recording closure.
- Code, tests, known docs/migrations, durable decision changes, and pre-merge closure stay in the same PR. Separate closure PRs are recovery only for genuinely unknowable post-merge facts.

## 15. Audit, release, operations, and maintenance

### 15.1 Audit layers

Applicable audits include:

- product-outcome and acceptance audit;
- invariant continuity, cross-change regression, and unresolved-impact audit;
- code quality and maintainability;
- architecture boundaries and data lifecycle;
- security, privacy, permissions, secrets, supply chain, and threat model;
- dependency freshness, license, SBOM, and provenance;
- browser/user flows, visual fidelity, responsive behavior, accessibility, localization, and performance;
- API/CLI/package contracts and backward compatibility;
- deployment, observability, alerting, rollback, backup/restore, migration, incident response, and deletion;
- documentation, onboarding, support, known limitations, and accepted debt;
- clean-clone install/build/test/package/deploy reconstruction;
- analytics and product-success readback.

Audits produce findings and proposed outcome slices; they do not silently mutate code or policy.

v1 may audit a declared local or already-existing preview endpoint without holding deployment authority. Creating, promoting, rolling back, or mutating a production deployment requires the future separately qualified `operate` capability.

### 15.2 Project completion

“Complete” is a milestone, not the end of responsibility. A completion audit must establish:

- accepted outcomes and exclusions;
- known limitations and debt owners/expiry;
- maintainability and clean-clone onboarding;
- release reconstruction, rollback, backup/restore, and deletion where relevant;
- observability and incident runbooks;
- security/dependency update cadence;
- support/maintenance owner;
- product analytics and outcome review;
- archive/handoff posture if development pauses.

Mill later needs scheduled intake for security advisories, API/dependency deprecations, scenario regressions, flaky tests, cost drift, incidents, and customer feedback.

## 16. Metrics, evaluations, and controlled improvement

### 16.1 Metrics

Track:

- accepted and landed outcomes;
- strict resolved-change rate across dependent sequences;
- new-behavior completion and affected-prior-behavior preservation as separate measures;
- required invariant/scenario coverage, unresolved impact, cumulative regressions, and rejection or recovery in a separate seeded-fault branch;
- lead time by lifecycle stage;
- human questions, approvals, overrides, and interventions;
- first-pass validation rate;
- review generations and repair families;
- latest-head review findings by severity, protected class, causal family, recurrence, disposition, and human-visible compression;
- escaped defects and incident severity;
- senior-review time and repair effort per accepted outcome;
- cancellation, retry, reconciliation, and stale-plan rates;
- local and CI runtime/minutes;
- model usage/cost and provider owner with provenance `measured`, `operator_declared`, or `unavailable`; never infer subscription dollar cost from tokens;
- exact worker-profile identity, profile drift, adapter failures, and unavailable capability/provenance fields;
- dependency/install/build/audit cost;
- post-merge and deployment failures;
- once the post-alpha feedback layer exists: eligible signals, deduplicated cases, evidence sufficiency, unsupported-claim rate, disposition latency, human correction/override, accepted downstream outcomes, and cost per accepted disposition.

Do not claim saved time or ROI without a comparable baseline. Lines changed, PR count, agent activity, and automation percentage are diagnostics, not success metrics.

Do not reuse the SWE-Milestone/EvoClaw headline score as a Mill target. Mill's
qualification uses its own declared fixtures, exact model/harness/recipe identity,
strict item closure, preservation evidence, cost, and human-intervention measures.

### 16.2 Mill qualification corpus

Before public alpha, run pinned clean-room canaries for one explicitly selected greenfield recipe and one existing-Node/TypeScript adoption case. At least one case must include a small dependency-ordered sequence of five or more changes, with every step starting from Mill's prior accepted output rather than a canonical reset. A matched reset or canonical-reference arm should be retained where practical to distinguish local task difficulty from cumulative degradation. The broader corpus remains a roadmap and support is withheld until each case earns a canary. Required public-alpha cases are:

- one greenfield product recipe selected before Wave 4B implementation, with its delivered-surface and security checks;
- one existing Node/TypeScript repository retrofit with custom commands and known baseline failures;
- one longitudinal evolution sequence covering feature work, boundary change, and regression pressure, plus a separate seeded-fault branch proving rejection or recovery before the next accepted base;
- invalid, ambiguous, and contradictory PRDs;
- malicious PRD/repo instructions and poisoned tool output;
- path/symlink and network escape attempts;
- missing credentials/container runtime/network;
- dirty worktree and base drift;
- worker crash, cancellation, timeout, output/cost exhaustion, and disk pressure;
- malformed/truncated worker events, missing terminal settlement, duplicate exact admission, conflicting identity reuse, and declared-versus-active capability drift;
- harness compaction, continuation, or prior session state attempting to replace fresh exact-base context;
- crash immediately before and after push or PR creation;
- GitHub/CI outage and reconciliation without duplicate mutation;
- candidate review drift and recurring review finding;
- required scenario marked non-executable;
- dependency outage and malicious dependency/update metadata;
- exact-version pinning, restoration to the pre-Mill integration snapshot where applicable, state purge/export, and manual detach without a prior-release migration claim;
- clean-machine install, release verification, release withdrawal/reinstall, and pre-integration restore.

The longitudinal result reports strict fully resolved steps, new-behavior completion,
prior-behavior preservation, cumulative regressions, repair rounds, human
interventions, elapsed time, and source-qualified model/CI cost. A later step cannot
hide an unresolved earlier failure by passing only its local acceptance tests.

Frontend/SaaS, backend/API, CLI/package, Python, Go, and additional operating-system combinations remain experimental fixtures or unsupported unless they are the selected recipe or independently pass the same clean-room qualification. The plan deliberately does not claim arbitrary-stack support in the `v0.1.0` public alpha.

Support claims are explicit: `supported`, `experimental`, or `unsupported` by OS, stack recipe, worker harness/profile, model, forge, and container runtime. A provider-neutral interface or passing fake-adapter suite alone does not justify real-harness support.

Every qualified tuple records `tested_at`, the exact observable profile, whether its
model identity is mutable, and a declared freshness/expiry and requalification
policy. Profile drift invalidates the claim immediately. A mutable or partly
unobservable profile cannot carry an indefinite support claim: it requires a fresh
canary within the declared window and a release-time canary for every published Mill
release.

### 16.3 Feedback intake and diagnostic admission (post-alpha)

The first learning loop is **signal to evidence-backed disposition**, not signal to
code. Eligible sources may include explicit operator reports, review corrections,
CI failures, lifecycle terminal reasons, escaped defects, incidents, support cases,
and measured cost or latency regressions. Connectors are adapters; the Mill-native
case record owns the investigation workflow.

Each signal records its source, revision or time window, affected repository/run/
candidate/release identity, data classification, reporter claim, and deduplication
key. Deterministic triage handles exact duplicates, known terminal codes, invariant
links, and policy routing before any model judgment. A bounded investigator may
gather only approved redacted evidence and must label conclusions `confirmed`,
`tentative`, or `missing_evidence`.

Signals and diagnostic cases remain scoped to the repository that owns the
affected product or delivery system. Downstream product feedback cannot silently
change Mill, and Mill runtime feedback cannot silently change a downstream
product. Cross-repository aggregation requires explicit privacy, minimization,
retention, and authority approval; shared identifiers or model-readable payloads
must not be assumed safe merely because both repositories use Mill.

Every diagnostic case records:

- stable case and signal identities plus links to duplicates;
- affected release/profile/recipe/task/outcome/invariant and exact candidate when applicable;
- first divergent lifecycle or product step and violated invariant, if reproduced;
- failure class: `context`, `planning`, `data_quality`, `model_behavior`, `tool_contract`, `authorization`, `state`, `effect_unknown`, `postcondition`, `evaluation`, `runtime`, `capacity`, `cost`, `human_interface`, `adoption`, or `unknown`;
- supporting evidence, counterevidence, source revisions, uncertainty, and missing work;
- disposition: `answer`, `duplicate`, `route`, `monitor`, `fix_candidate`, `planning_required`, `rejected`, or `unresolved`;
- proposed replay-case IDs, owner, severity, review date, downstream obligation, and final human disposition.

The best outcome may be no ticket and no code. A `fix_candidate` disposition does
not authorize implementation; it enters the ordinary product-impact, task, build,
verification, review, and draft-PR lifecycle. Open-ended feature requests and
unresolved diagnoses return to product planning. External write-back, automatic
ticket creation, and automatic PR-author dispatch remain separately gated effects.
`monitor` is a parked human-owned disposition only; it does not schedule polling,
wake a worker, or acquire background authority unless scheduling is independently
approved and qualified later.

### 16.4 Scoring and controlled improvement (post-alpha)

- Start with deterministic measures already emitted by the lifecycle: terminal reason, gate status, retries, review generations, repair families, elapsed time, CI minutes, cancellation/reconciliation, exact profile drift, item-level completion/preservation, and provider-qualified usage. Do not pay a model to rediscover known state.
- Admit a model-based scorer only for a named judgment gap such as maintainability, unnecessary orchestration, procedure compliance, or reviewer burden. Its contract binds the eligible denominator, sampled fraction and randomization method, exclusions, trace/context fields, minimization/redaction, rubric and labels, pass threshold, scorer/model/prompt version, label/reference authority, trial count, uncertainty, calibration, cost ceiling, disagreement/adjudication path, retention, and invalid/unavailable behavior.
- Scorer output is an observation and routing signal, never product truth, authorization, or a release gate by itself. Deterministic safety, contract, authority, and acceptance failures remain hard failures regardless of aggregate score.
- Preserve a pinned baseline arm, fixed repo fixtures, exact observable worker/model/config/recipe identity, budgets, and evidence.
- Cluster recurring failures by exact task/trajectory and violated invariant; require a reproducible diagnostic or explicitly unresolved alternatives before claiming root cause.
- Separate observer, candidate author, evaluator, fixtures/holdouts, approval, release, and deployment authority.
- A learning agent may propose a Mill configuration/code PR. It cannot edit the evaluator, hidden cases, thresholds, permissions, update channel, CI result, protected branch, approval, deployment authority, or rollback evidence for its own candidate.
- Every candidate change packet binds the before/after canonical effective-system manifest: workflow, worker profile, model route/mutability, prompt/configuration, context policy, admitted capabilities, verifier/evaluator, runtime, permissions, budgets, recipe, source/data revisions, policy, and schemas. This is a canonical manifest, not a graph platform. Partial prompt-only comparison cannot support a causal improvement claim.
- Compare current and candidate against the same representative tasks, dependent sequences, frozen worlds/policies, budgets, scorer versions when applicable, trial/aggregation rules, unchanged regression suite, and protected safety slices. Use an independently controlled holdout only after its storage, authority, contamination controls, and evaluator isolation are separately qualified; otherwise retain an unchanged, uncontaminated regression corpus. Preserve per-case results and uncertainty; an aggregate score cannot hide a consequential regression.
- Use stable harness names and matched input identities. Native worker traces may be attached to private local evaluation records but remain outside Git and support bundles by default.
- Human approval and canary/rollback remain required. An improvement candidate receives exact-candidate review, independent matched evaluation, and a disposable or pre-merge bounded canary with explicit success and rollback criteria before human merge. Post-merge observation then verifies the landed identity and records any regression as new diagnostic intake. The authoring principal cannot approve, merge, release, deploy, alter rollback evidence, or mark its own result successful.
- Genesis exception: because the repository uses squash merge, the first public artifact binds the exact reviewed candidate tree to an equal resulting-main tree, the tag commit, one preserved tarball digest/npm integrity value, and registry readback. Two clean fresh-checkout builders outside candidate control compare canonical package contents before the selected `.tgz` is published explicitly. Prepublication qualification, separately approved tag/publication effects, and postpublication registry/provenance/install verification are distinct. Beginning with the next release, trusted N qualifies N+1.
- Escaped defects, incidents, and recurring review families may propose additions to the invariant/scenario corpus; a human approves them through an ordinary change before they become authority.
- Self-improvement begins only after enough real, labeled runs exist; it is not a v1 feature and may never rewrite its own evaluator, authority, or promotion policy in the candidate run.

## 17. OSS project and maintainer policy

Wave 1 established:

- Apache-2.0 `LICENSE`;
- concise README with the honest current pre-alpha boundary;
- single-maintainer governance: David is final decision maker; roadmap is nonbinding; maintenance, archive, and succession states are documented;
- `.github/CODEOWNERS` with `* @davidahmann`, without a branch rule that requires an impossible second human approval;
- initial required PR checks, no force-push/default-branch deletion, conversation-resolution policy, and explicit bypass posture, configured as soon as the default branch exists;
- `SECURITY.md`, GitHub private vulnerability reporting, and coordinated-disclosure instructions;
- `CONTRIBUTING.md`, issue/PR templates, code of conduct decision, and DCO sign-off enforcement for outside code contributions from the first public alpha; no CLA unless future relicensing/dual licensing is intentionally required;
- initial privacy posture stating telemetry off by default, credentials are never stored, and model/provider disclosure is required; operational state paths, retention, purge, and support-bundle behavior close before Wave 2;
- support policy: best effort, no SLA; issues for reproducible bugs, discussions for help, private security channel for vulnerabilities;
- initial SemVer, changelog, deprecation, and compatibility policy;
- pinned GitHub Actions, least privilege, exact lockfile, package lifecycle-script policy, and appropriate Wave 1 dependency/static/security checks; and
- Node 24 LTS as an explicit install prerequisite; standalone binaries are deferred and must not be implied.

Before public alpha, complete and qualify:

- the ten-minute runnable disposable onboarding/smoke canary, explicitly distinct from the full longitudinal Gate D qualification;
- the operational privacy policy: source/provider disclosure, user-only application-state permissions, prompts/logs disabled or short-retention by default, explicit purge, and support-bundle preview/redaction behavior;
- the supported-version, release, advisory, release-withdrawal, pre-integration restore, and recovery policies;
- Dependabot/Renovate policy, CodeQL or equivalent, secret scanning, dependency review, SBOM, checksums, and provenance/attestation as applicable;
- scoped npm publishing through trusted OIDC with provenance, no long-lived npm token, maintainer passkey/2FA plus recovery procedure, protected release environment, exact direct dependency pins and lockfile, explicit dependency lifecycle-script allowlist, install and CI use of `--ignore-scripts` where supported, isolated packed-package installation, and no reuse of untrusted fork artifacts/caches in release builds;
- evaluate and, if compatible with the chosen npm release shape, qualify a generated published-CLI shrinkwrap and minimum dependency-release-age policy; adopt them only when clean-install, rollback, and update behavior prove they reduce risk without creating an unmaintainable freeze;
- scheduled dependency vulnerability and registry-signature checks, plus a versioned release-source archive and checksums when the public distribution format makes them applicable;
- immutable release/tag policy and clean-machine install verification;
- qualified platform tuples: macOS client plus Linux OCI Tier 1, WSL2 experimental, native Windows deferred;
- architecture/trust diagram, threat model, credential flow, restart/reconciliation guide, limitations, maintainer release/advisory/release-withdrawal/reinstall/pre-integration-restore runbook, and runnable disposable example.

External fork CI receives no secrets and cannot publish. Releases run only from an approved immutable tag through narrowly permissioned trusted workflows. Do not claim byte-reproducible artifacts until independent clean rebuilds prove it.

## 18. Threat model and mandatory negative scenarios

Protected assets:

- source and Git history;
- model, GitHub, cloud, deploy, and package credentials;
- local filesystem and unrelated repositories;
- Mill policy/configuration/update channel;
- operational state and evidence;
- CI/model budget and user privacy;
- downstream production/data systems.

Minimum threats and controls:

| Threat | Required control and scenario |
|---|---|
| Prompt/goal injection in PRD, repo, issue, web, screenshot, or tool output | Trusted instructions distinctly supplied to the model; runtime authority enforced outside the model; source labels; hostile-instruction fixtures; no capability from text |
| Harness/project resource injection | Disable project worker plugins, extensions, worker extension packages, skills, prompts, MCP and auto-discovery in the v1 worker profile without prohibiting ordinary approved application dependencies; classify static guidance as untrusted context; fixture proves repo worker resources cannot change the active profile |
| Arbitrary repo code | Static scan before execution; disposable worktree/container; no ambient credentials; explicit host-mode limitation |
| Hostile Git configuration | Static Git operations disable repo hooks, textconv/external diff, clean/smudge filters, filesystem monitors, and other executable repo configuration; hostile-config fixtures |
| Path/symlink escape | Canonical-path and mount revalidation; negative filesystem fixtures |
| Secret exfiltration | Keep forge/deploy credentials out of the builder boundary; prompt/log redaction and secret scanning; deny-by-default egress only inside a qualified OCI/VM isolation mode. `attended-trusted-host` discloses that unrelated host filesystem, keychain, and worker-network access are not prevented. |
| Confused deputy/tool misuse | Exact task/mode capability grants; new-effect approval |
| Duplicate/ambiguous remote effect | Idempotency keys where available; durable receipts; provider readback; `effect_unknown` |
| Base/candidate/config drift | Exact SHA/digest binding; invalidation before publish |
| Dependency/action poisoning | Locks, registries, license/advisory checks, full-SHA Actions, provenance |
| Cost/resource denial | Absolute deadline, concurrency one, token/output/process/network/CI budgets, cancellation |
| Worker protocol confusion or false settlement | Persist exact invocation identity; strict adapter schemas/framing; valid terminal result required; conflicting retries and capability drift block; progress events never advance authority |
| Fake or self-authored evidence | Trusted runner results; protected evaluator/oracle; negative controls |
| Update-channel compromise | Signed/attested releases, checksums, pinned installs, N qualifies N+1 |
| Support-bundle leakage | Recursive redaction, preview, bounded retention, no source/prompts by default |
| Model/research disclosure | Frozen context/query manifest, allowed data classes, provider disclosure, exclusions/redaction, and explicit network grant |

The threat model must be refreshed when tools, network, credentials, authority, deployment, or external effects expand.

## 19. Failure and recovery matrix

| Condition | Required behavior |
|---|---|
| PRD contradiction or missing authority | Draft proposal; block promotion; ask bounded decision |
| Unsupported or stale recipe/provider | Report degraded/incompatible; do not infer support |
| Dirty user checkout | Never mutate it; use independent worktree or stop |
| Policy/contract changes during run | Current grant remains frozen; affected future state becomes stale |
| Base branch moves | Invalidate candidate-dependent checks; rebase/replan explicitly |
| Worker crash/timeout/cancel | Terminate descendants, preserve state/log refs, resume safe boundary |
| Worker event malformed/truncated or terminal result missing | Reject settlement, preserve bounded diagnostics, reconcile the process/worktree, and start a new invocation ID only from a proven safe checkpoint under the remaining attempt budget; never replay a possibly started mutation |
| Worker profile/harness version changes | Mark affected qualification stale; require matched canary before restoring the prior support claim |
| Required context source unavailable or changed before wake | Block or create a newly approved context epoch; never silently omit or reuse a stale summary |
| Required test skipped/pending/flaky | Block or explicit expiring human exception; never count as pass |
| Review recurrence | Stop repair loop; return to architecture/plan |
| GitHub/CI unavailable | Preserve candidate and enter blocked/wait state; avoid repeated CI churn |
| Push/PR/comment outcome unknown | Query provider; reconcile; never blind retry |
| Auth expired | Block and request reauthentication; do not substitute credentials |
| Dependency/network outage | Bounded retry/circuit breaker; preserve exact error |
| Disk full/state write failure | Fail closed, preserve user checkout and prior committed state |
| Merge conflict | Produce conflict/intent report; no mechanical semantic resolution without approval |
| Post-merge check failure | Open repair intake tied to merge SHA; do not rewrite closure history |
| Local database corruption | Backup/restore or reconstruct from Git/provider where possible; do not fabricate events |

## 20. Delivery plan: five vertical waves to public alpha

This section reconciles landed implementation with the remaining roadmap. Waves
1–4B and the Wave 3 external canary are landed at the baseline named above. The
public-alpha critical path therefore has one remaining implementation unit: Wave
5 as one coherent implementation PR followed by its separately authorized
post-merge genesis release/tag operation. Documentation-only,
artifact-only, checklist, review-comment, and bookkeeping splits remain
prohibited. Same-delivery code, tests, docs, migrations, and knowable pre-merge
closure remain together.

### Wave 1 — Constitution, exact-version trust, and static inspection (landed)

Outcome: a public-ready repository foundation and a non-mutating, typed inspection/adoption surface that can be installed and invoked at an exact version.

Scope:

- create `davidahmann/mill` only after explicit implementation approval and after resolving whether the project name itself is defensible;
- approve Apache-2.0, DCO, single-maintainer governance, security/privacy/support/versioning, architecture, threat model, contribution boundary, and genesis-release protocol;
- establish Node 24 LTS/TypeScript, scoped npm identity, exact lockfile, strict format/lint/types/unit/contract/package gates, native CI, pinned Actions, CodeQL/dependency checks, OIDC/provenance release design, and fork/release separation;
- implement exact-version invocation/refusal against `mill.lock`; no transparent self-update;
- define only compact ManagedRepository/ProductContract/Blueprint/ScenarioSet/OutcomePlan and lock/config schemas plus canonical serialization/digests;
- implement structured error/JSON contracts, static PRD/source intake, source classification, hostile-safe Git/repository scan, and `doctor`;
- implement `adopt --scan-only`; defer full `new --dry-run` until the product compiler exists;
- the Wave 1 Mill product exposes no downstream-repository command execution, writes, remote provisioning, Codex execution, or GitHub mutation; operator-side bootstrap development and shipping remain governed by Section 24.

Acceptance:

- malicious PRD/README/Git config cannot invoke commands, filters, hooks, textconv, network, or grant authority;
- static scan reports observed/inferred/missing/conflicting items and declared commands with sources/confidence, never an executable baseline;
- unknown schema major or Mill version mismatch fails with an exact compatible invocation/migration instruction;
- canonical serialization deterministically hashes a given exact object;
- CLI output/exit contracts and packed-package clean install are tested;
- fork CI has no secrets/publish authority and release design requires OIDC/provenance, maintainer 2FA, protected environment, and clean artifacts;
- sole-maintainer repository settings require the named machine gates without an impossible second-human approval; `CODEOWNERS` is ownership routing, and any emergency bypass is logged as repair/audit intake;
- fresh-clone reconstruction and repository-settings inventory are documented; no destructive repository-deletion test exists.

### Wave 2 — One manual slice to a reviewed local commit (landed)

Outcome: one manually approved typed slice in a disposable fixture can become an exact locally committed, validated, isolated-context-reviewed candidate with no remote mutation.

Scope:

- begin with the isolation/auth/process-routing feasibility spike and select an honest support mode;
- implement read-only/build Codex adapter, frozen context manifest/provider disclosure, local auth readiness, and sensitive-path exclusions;
- implement transactional schema-versioned SQLite state/events, backup/recovery, user-only permissions, redacted retention/purge, small state machine, cancellation/deadlines/retry budgets;
- implement exact-base isolated worktree, dirty-checkout protection, one-writer lock, hostile Git/path/symlink controls, and transactional local apply;
- implement a manually authored approved task fixture, JIT task packet, stable command IDs, controlled process runner, and OCI native/delivered-surface/fault/package checks;
- create the lifecycle-owned local candidate commit before validation;
- implement `qualify --baseline`, `run`, `status`, `verify`, `resume`, `cancel`, and exact-commit isolated-context review;
- implement complete finding preservation, protected classes, one systemic repair, re-commit/revalidate/review, and non-convergence escalation;
- no push, PR, merge, deploy, generalized PRD compiler, or recipe catalog.

Acceptance:

- fixture reaches a clean exact local commit from a fresh checkout and validation/review bind that commit/tree plus product/policy/scenario digests;
- shipper capability and forge/deploy credentials are absent; host mode makes no prevention claim it cannot fault-test;
- every worker subprocess follows the selected qualified path, or the mode is explicitly attended/trusted and promotion relies on detected repo-scope integrity rather than claimed containment;
- required non-executable/flaky case blocks and machine evaluator negative control catches a known-bad candidate;
- candidate/policy drift invalidates evidence;
- cancellation terminates descendants and preserves resumable state;
- crash, timeout, state-write failure, disk pressure, dependency outage, base drift, and dirty checkout produce truthful typed outcomes;
- usage/cost values are source-qualified as measured, operator-declared, or unavailable.

### Wave 3 — Exact commit to draft PR, reconciliation, and closure (landed and canary-qualified)

Outcome: the already reviewed local commit can be pushed as a draft PR, observed, repaired once if remote findings require it, reconciled after ambiguous effects, and truthfully closed after David merges.

Scope:

- extend auth readiness with local `gh`, normalized forge/repository binding, fork/rebind rules, and repository allowlist;
- implement durable intent-before-call, immutable delivery key, receipt-before-success, authoritative readback, and blocking reconciliation protocol;
- shipper pushes only the reviewed commit, opens draft PR, reports assistance/run identity, and never commits/amends;
- make isolated local frozen-head review the portable required baseline; treat GitHub Codex or another forge reviewer as an optional repository policy unless separately selected and qualified;
- when a remote reviewer is required, preflight its installation/authentication/billing owner, trigger it only as an explicit `propose` effect, bind findings to PR head and review generation, and cap settle/retrigger attempts;
- observe the configured required CI and review policy on the latest head with bounded polling and resumable `awaiting_human` state;
- aggregate remote findings into one attended systemic repair on the same PR, then re-commit/revalidate/review/rebind; repeated P0/P1 returns to planning;
- report locally ready without marking a draft ready or merging it; David marks ready and performs the allowed merge method;
- observe the PR head, human merge method/result SHA/tree, default-branch checks, and `post_merge_verified -> closed`;
- handle GitHub/auth/CI outage, ambiguous push/PR response, base movement, merge conflict, and post-merge failure;
- defer issue/tracker projection, auto-merge, remote provisioning, and deployment.

Acceptance:

- fault tests cover crash before remote call, after effect/before receipt, after receipt/before response, and restart without duplicate mutation;
- state-store failure blocks external call and unknown outcome blocks further shipping until readback/attended reconciliation;
- shipper cannot publish a different commit and builder never receives forge/deploy authority through the Mill process boundary;
- remote/host/lookalike/fork rebinding cannot inherit `propose`;
- one attended disposable GitHub canary pushes the already reviewed commit, runs the actual named required check contexts, settles the configured latest-head review policy, and is marked ready and merged by David without bypass;
- current-head CI/review, configured P2 debt disposition, remote-review cost owner, and optional-versus-required reviewer status are truthful;
- closure binds the reviewed candidate commit/tree to the PR head and records the allowed merge method/result SHA/tree; unexpected tree divergence blocks or requires post-merge revalidation rather than being silently accepted;
- human merge is read back from GitHub, default-branch checks are observed, and post-merge failure becomes repair intake rather than false closure;
- a controlled fake-provider or fault-injection case exercises an unknown remote outcome and proves authoritative readback without duplicate branch/PR effects; a second real disposable PR is not required unless the first canary cannot exercise the relevant provider state safely;
- no normal closure-only PR or unbounded review loop is produced;
- Mill pushes at most once per candidate and truthfully reports external reruns.

### Wave 4 — Product continuity and the founder path (Wave 4A landed; Wave 4B pending promotion)

Outcome: after the delivery implementation works, Mill can assess and promote product truth from a PRD, disclosed source manifest, and operator-supplied structured proposal, compile one continuity-aware delivery slice, and use one Node/TypeScript recipe to bootstrap a greenfield repository or map compatibly into an existing repository without creating parallel authority.

The split is deliberate. Wave 4A changes what Mill treats as product, context, and
worker-execution authority. Wave 4B consumes those contracts to mutate downstream
repositories and expose the founder path. Neither PR is an artifact-only or closure
tail.

#### Wave 4A — Product truth, continuity, and worker admission (landed)

Scope:

- consumed the completed Wave 3 canary evidence and reconciled the affected committed status surfaces;
- implemented a read-only assessor that validates and freezes an operator-supplied PRD, disclosed source manifest, structured proposal, compact stable invariant IDs, decisions, assumptions, contradictions, unknowns, and question budget; it does not perform live research or autonomously draft the proposal;
- defined future stack-research triggers, provider/query disclosure, and primary-source/registry/advisory/license evidence requirements without implementing network acquisition or stack recommendation;
- validated and froze operator-supplied blueprint and product/design/flow/accessibility approval inputs for the selected recipe; it did not generate or rank two or three live blueprint candidates;
- validated and froze an operator-supplied visible scenario set and oracle ownership, cross-linked to acceptance and invariant IDs; autonomous scenario generation and hidden holdouts remain deferred;
- compile one human-approved impact manifest per JIT slice covering affected and uncertain invariants, user/system surfaces, interfaces, data, scenarios, commands, and material design consequences;
- extend verification so every required acceptance/invariant/scenario ID maps to executed evidence, human attestation, or a blocking unsupported state, with new-behavior completion and prior-behavior preservation reported separately;
- freeze supplied context, provider-visible repository scope, effective instruction files, `contextEpoch`, and role-specific worker profile/invocation records before each worker wake; no worker memory, compaction, or session state may replace exact-base context;
- implement the internal `WorkerAdapter` and Codex event decoder contract only to the extent needed for admission and settlement; Codex CLI remains the sole real v1 implementation and no generic RPC, server, second harness, or plugin surface is introduced;
- add deterministic fake-worker/Codex-decoder conformance for malformed/truncated events, missing/conflicting settlement, duplicate exact admission, conflicting identity reuse, capability/profile drift, cancellation, deadline/output exhaustion, context drift, and uncertain-attempt recovery; and
- dogfood one manually selected continuity-aware slice through the existing local lifecycle, without treating the candidate as its own release authority.

Acceptance:

- operator-supplied proposal wording may vary, but approval freezes canonical bytes/digest and a later supplied revision creates a semantic diff without overwriting the approved snapshot;
- stable invariants are behavioral, source-linked, non-duplicative, and referenced consistently by outcomes, scenarios, impact manifests, validation, and review;
- unresolved impact is visible and blocking unless the repository-configured human maintainer records an explicit scoped, expiring exception;
- a required scenario digest, prompt mention, progress event, final prose, or harness memory cannot count as execution evidence or lifecycle settlement;
- every invocation has a canonical redacted envelope/profile record and digest, role-specific capability/output contract, durable worker-launch intent/start boundary, and safe uncertain-outcome disposition;
- a possibly started model mutation is never blindly replayed; a new execution receives a new invocation ID and safe checkpoint;
- medium/high-risk tasks prove at least one delivered-surface scenario and one relevant exception, degradation, adversarial, recovery, or novel-input scenario;
- current-run config/oracle edits cannot self-activate; builder-authored oracle changes cannot certify the same candidate, and a known-bad negative control proves each new machine promotion evaluator; and
- conformance passes without adding a second real harness or claiming containment/profile controls that Codex cannot expose or enforce.

#### Wave 4B — Qualified recipe, adoption, and founder golden path (landed)

Scope:

- implement the compact repo footprint, repo-native path equivalents, command/authority precedence, staged pre-Git approval, canonical-branch authority, selective invalidation, exact Mill/schema/recipe lock, and generated ownership classes;
- implement one Node/TypeScript recipe capable of greenfield bootstrap plus one compatible existing-repository adoption mapping;
- implement `new --dry-run/--apply` and `adopt --apply` using Wave 2's isolated transactional worktree;
- implement `run next --attended` as the approved-next-outcome selector and ergonomic wrapper over the landed bounded `run` lifecycle; it introduces no separate task authority or execution engine;
- implement `start --prd ... [--draft-pr]` as the resumable golden-path coordinator over the same approvals and lifecycle, with non-mutating readiness/destination preflight before billable calls and at most two scheduled decision cards;
- implement `ship --draft` as an ergonomic wrapper over the landed `pr plan`/`pr open` intent, approval, receipt, and readback path; preserve the landed expert verbs and introduce no second shipping state machine or side-effect channel;
- mark retrofit baseline unverified until `qualify --baseline`; preserve existing stack/style/docs/commands and stop on conflicting authorities;
- implement `detach --plan` plus manual pre-integration rollback, state purge/export, exact-version pin, and downstream Mill-absent guidance; do not implement upgrade planning or automated apply before a real released migration exists;
- keep GitHub repository creation and protection setup manual; and
- synchronize the current development guide's install command with the already authoritative `npm ci --ignore-scripts` workflow/README practice while updating the coupled product, architecture, workflow, schemas, examples, and task contracts.

Acceptance:

- unsupported or stale supplied evidence is labeled and an unsupported recipe cannot apply;
- the selected recipe is pinned, licensed, advisory-checked, and may exercise the existing execution/review/draft-PR loop because Wave 3 Gate C evidence is already landed; material provider or profile drift still requires requalification;
- deterministic transactional greenfield/adoption tests currently use a fake OCI runner, while one real digest-pinned offline OCI verifier exercises the recipe itself. These are implementation results, not public support canaries. Wave 5 must run both greenfield and adoption through the packed, installed release candidate in clean environments before either support claim is published;
- adoption maps repo-native equivalents, preserves existing truth, separates later executable baseline failures, and stops rather than adding a third source of truth;
- greenfield apply creates one initial canonical Git commit from the exact approved staged bytes and approved file plan, with no authoritative partial commit on failure;
- `run next --attended` selects only a ready approved slice and preserves the landed run/candidate/validation/review state machine;
- founder preflight catches missing required auth/runtime/destination before model spend, reports time/cost as a measured estimate, bounded range, operator declaration, or `unavailable` plus the requested authority, and returns one exact resume path;
- `ship --draft` produces the same candidate binding, intent, approval, receipt, provider readback, and recovery behavior as the landed `pr` verbs;
- absent stop conditions or new authority, the founder sees no more than two scheduled decision cards before the reviewed draft PR and one final human mark-ready/merge step;
- clone/fork/state namespace and canonical forge identity do not collide; and
- downstream native install/build/test remains operable with Mill absent and optional conformance manually removed.

### Wave 5 — Longitudinal qualification, audits, genesis distribution, and public alpha (planned)

Outcome: Mill can preserve accepted behavior across a small dependency-ordered change sequence, be released through a one-time genesis trust path, installed and verified from a clean machine, used on one greenfield recipe and one adoption canary, audited, withdrawn/reinstalled or restored to the pre-Mill integration snapshot, manually detached, and described honestly as public alpha.

Scope:

- adapt and qualify the existing `.github/workflows/release.yml` and `scripts/verify-release-tag.mjs` foundations rather than create a parallel release path. The workflow must stop relying on implicit `npm publish` directory repacking and must publish an explicitly preserved qualified `.tgz`;
- implement only the bounded product/code/UX/accessibility/security/dependency/architecture/operations/release audit capabilities required by the selected recipe and genesis release; they emit proposals rather than mutations and do not form a generic audit platform;
- implement a small longitudinal qualification harness that starts every dependent step from Mill's prior accepted output, records item-level preservation and strict completion, and supports a matched canonical-reset arm where practical;
- qualify at least one sequence of five or more changes for the selected recipe or adoption case, plus a separate seeded-fault branch that must be rejected or recovered before it becomes the next accepted base;
- complete the narrow public-alpha corpus: packed-installed greenfield creation, packed-installed existing Node/TypeScript adoption, malicious inputs/Git config, worker/recovery faults, worker-profile/harness-configuration drift, external-effect ambiguity, required-case gaps, clean install, manual pin/pre-integration rollback/detach, and downstream Mill-absent operation;
- because squash merge changes commit identity, require `reviewed candidate tree == resulting main tree`, require the approved release tag to point to that resulting main commit, and bind both to the release-source digest;
- from the exact tag commit, use two independent clean builders outside candidate control to build and compare canonical package contents. Select and preserve one `.tgz`, record its digest and npm integrity, run the prepublication packed-artifact qualification against that file, and never rebuild or repack it for publication;
- publish the preserved `.tgz` explicitly through a separately approved trusted-OIDC effect, then create the immutable GitHub release with the same artifact/checksum/SBOM/attestation as applicable. Read back the npm name/version/tarball/integrity/provenance and tag/GitHub release identity, download from the registry, and run clean-machine installed-package UAT plus greenfield/adoption canaries before declaring public-alpha support. On mismatch or failure, block the claim and execute the documented withdrawal/advisory path;
- qualify the installed CLI's transitive dependency closure, packed install with lifecycle scripts disabled, exact direct pins, and a documented cooling-off or explicit-exception policy for routine new dependencies;
- publish only qualified support tuples binding host OS/architecture, Node, container engine/image, exact observed Codex adapter/harness/profile and model mutability, auth mode, Git/`gh`/GitHub, and selected recipe;
- record each tuple's `tested_at`, freshness/expiry, and requalification policy, and run a fresh release-time canary for mutable or partly unobservable worker profiles;
- publish limitations, privacy/provider disclosure, best-effort support, contribution/DCO, security reporting, and runnable canary docs;
- rewrite the main README as a world-class user guide organized around value, supported use cases, install and first-run paths, trust boundaries, recovery, troubleshooting, and honest limitations; keep deep implementation detail in linked reference docs rather than making the README a changelog;
- rewrite the root `AGENTS.md` primarily as the operating contract for coding agents using Mill in this repository: orientation, authority hierarchy, task selection, safe execution, validation/review/shipping boundaries, recovery, and stop conditions. Contribution mechanics remain present but secondary. Ensure the generated recipe `AGENTS.md`, development guide, workflow, architecture, release guide, and canary documentation use the same terms and commands;
- do not add upgrade planning or automate detach/apply until a real post-alpha migration validates the need, compatibility metadata, and rollback behavior.

Acceptance:

- every claimed supported tuple has a clean-room canary bound to its exact worker profile; a harness/configuration change triggers a matched canary, and all other combinations are experimental or unsupported;
- the longitudinal canary reports strict resolved steps, new-behavior completion, prior-behavior preservation, cumulative regressions, repair rounds, human intervention, elapsed time, and source-qualified cost;
- a later local success cannot close or conceal an unresolved prior invariant failure; cumulative degradation blocks the continuity and autonomy claim;
- prepublication packed-artifact greenfield and adoption canaries verify the exact preserved `.tgz`; postpublication clean-machine canaries repeat from the registry-downloaded artifact before support is declared;
- genesis artifact is qualified without circular self-certification; N qualifies N+1 begins after it;
- the reviewed candidate tree, equal resulting-main tree, tag commit, preserved `.tgz` digest/npm integrity, npm registry readback, and GitHub release all form one verified identity chain; no publication-time rebuild may silently replace it;
- exact-version pinning, pre-integration restore, local-state purge, static export, and detachment leave a clean clone independently operable with no required Mill check;
- required pending/skipped scenario cannot promote;
- public alpha docs execute and match actual limitations;
- a new maintainer or coding agent can use only the README and root `AGENTS.md` to locate authoritative product truth, choose the next approved task, run the correct native lifecycle, avoid forbidden authority, recover safely, and reach a reviewed draft PR without depending on Factory or private conversation history;
- no automated upgrade/detach, remote provisioning, issue sync, auto-merge, deployment, parallel worker, plugin, or self-modification path exists.

### Post-alpha evidence-led work

- after the first real migration supplies compatibility and rollback evidence, design a read-only upgrade plan; automate upgrade or detach apply only after that plan and a later migration prove the operation safe;
- qualify additional SaaS/API/CLI/Python/Go recipes one at a time before claiming support;
- add protected holdouts only after storage/isolation is proven;
- implement the learning layer only after enough real, privacy-eligible, labeled runs exist. Keep it to two authority-aligned delivery PRs rather than many worker-specific micro-PRs:
  1. **Feedback and evaluation foundation:** one Mill-native signal/diagnostic-case contract, deterministic lifecycle metrics, explicit local import or one read-only connector, deduplication, evidence-backed dispositions, replay-case proposals, redaction/retention, repository-scope isolation, and human review. It cannot create tickets, start code work, mutate external systems, or add a model scorer before the separate scoring trigger closes.
  2. **Controlled improvement proposals:** consume only approved diagnostic/replay cases, bind the full before/after canonical effective-system manifest, generate an isolated candidate/change packet, and request independently controlled regression evaluation plus a qualified holdout only when one exists. If the model-scoring trigger has separately closed, this PR may add the narrowly calibrated scorer required by the named judgment gap. Candidate review, evaluation, and a disposable/pre-merge canary precede human merge; post-merge observation follows. The candidate cannot alter its judge, approve, merge, release, deploy, or expand autonomy.
- feed escaped defects, incidents, operator corrections, and recurring review families into proposed invariant/scenario additions only through that diagnostic admission path and ordinary human-reviewed changes;
- add external write-back, automatic ticket creation, or automatic PR-author handoff only after the read-only feedback slice proves disposition quality, deduplication, reviewer capacity, privacy, and cost; each remains a separately approved effect class;
- add deployment/canary, scheduler, parallelism, multi-repo, a second model, a second worker harness, another forge, or stronger autonomy only through the independent triggers in Section 21.

## 21. Milestone gates and expansion triggers

### Gate A0 — Adoption integration trust

Before integration-only repository writes:

- static inventory and source-of-truth map reviewed;
- exact file plan and ownership classes approved;
- isolated transactional worktree available;
- repository remains at `inspect` trust;
- no product code, native command execution, or remote effect is authorized.

### Gate A1 — Product planning trust

Before promoting an operator-supplied or future planner-drafted product/blueprint proposal:

- sources, assumptions, contradictions, and unknowns are visible;
- the exact canonical proposal bytes and digest are frozen; and
- the configured human authority approves that proposal and only its stated scope.

Before applying repository integration, bootstrapping product code, or entering
`build`:

- the promoted product contract, stable invariants, and scenarios are authoritative;
- blueprint and recipe are approved where material;
- the next impact manifest identifies affected and uncertain surfaces without silently resolving unknowns;
- threat and authority boundaries are explicit; and
- the exact file plan, ownership classes, and destination binding are accepted.

### Gate B — Local execution trust

Before Codex writes:

- compact repo pack qualifies;
- native checks and scenario oracles exist, and every required ID has an executable, human, or explicitly blocking disposition;
- exact base and task packet frozen;
- impact manifest and affected-prior-behavior preservation set approved;
- the role-specific worker profile, canonical redacted invocation envelope and digest, effective instruction set, `contextEpoch`, provider-visible repository scope, disclosure/network posture, and required terminal contract are frozen and satisfy the repository's capability/trust requirements before Codex wakes;
- enforceable worktree/command/credential controls proven, with residual host filesystem, keychain, process, and network exposure disclosed for `attended-trusted-host`;
- selected execution mode labeled honestly; prevention claims have fault-injection evidence, otherwise the mode is `attended-trusted-host` with detection/promotion checks only;
- cancellation and budgets active.

### Gate C — Remote proposal trust

Before branch/PR mutation:

- exact candidate locally verified and reviewed;
- shipper separation proven;
- remote allowlist/readback/reconciliation fault-tested and the attended disposable real-GitHub canary remains within its declared support window; fake-provider tests alone cannot renew Gate C after material profile/provider drift;
- local account/billing owner clear;
- human accepts requested effect.

### Gate D — Genesis release and public alpha

Before the separately approved `v0.1.0` tag effect:

- the exact reviewed candidate tree equals the resulting squash-merged main tree, and the intended tag commit is that resulting main commit;
- the longitudinal canary is green on the selected qualified support tuple, with no concealed prior invariant failure;
- pre-integration restore, purge/export, detach, security/privacy/support/release policies, and the release-withdrawal/advisory path are proven; cross-version migration or rollback is not required or claimed;
- the existing release workflow and tag verifier are updated and tested to preserve and explicitly publish one qualified `.tgz`; and
- no known P0/P1 or unexpired protected-class debt remains.

After the tag exists but before npm or GitHub-release publication:

- two independent clean builders from the exact tag compare canonical package contents;
- one selected `.tgz` is preserved with digest and npm integrity, and checksum/SBOM/attestation inputs are bound to it;
- the packed artifact passes clean install, exact-version verification, the selected greenfield/adoption canaries, and the required security/recovery corpus; and
- every candidate support tuple has a green exact-profile canary, including a fresh canary for every mutable or partly unobservable worker profile.

After the separately approved publication effects, before declaring public alpha or
publishing a support claim:

- npm and GitHub readback bind the expected package name/version, registry tarball/integrity/provenance, tag commit, preserved artifact/checksum, and GitHub release;
- a fresh registry download passes clean-machine install/UAT and the greenfield/adoption smoke canaries; and
- any mismatch or postpublication failure blocks the support claim and invokes the documented withdrawal/advisory procedure.

### Gate E — Feedback and controlled improvement (post-alpha)

Before read-only feedback diagnosis:

- enough real, privacy-eligible signals exist to define an eligible denominator, source/revision contract, deduplication rule, retention, owner, baseline, and disposition-quality target;
- deterministic lifecycle metrics and exact run/release/profile identities are available before adding model scoring;
- the diagnostic-case schema, source access, redaction, uncertainty, counterevidence, human disposition, and no-ticket outcome are proven; and
- connector credentials and write-back are absent from the investigator boundary.

Before improvement-candidate generation:

- recurring diagnosed failures reproduce against approved replay cases;
- baseline and candidate canonical effective-system manifests, budgets, applicable scorer/evaluator versions, trial rules, regression suite, and safety slices are frozen; a holdout is included only when independently qualified;
- evidence reader, candidate author, evaluator, approver, release/deployment authority, and protected resources are separated;
- a candidate cannot edit its own evaluator, fixtures, thresholds, policy, CI result, approval, protected branch, release, deployment, or rollback evidence; and
- exact-candidate review, independent matched evaluation, a bounded disposable/pre-merge canary, human promotion, post-merge observation, kill switch, restored-digest readback, and rollback criteria are exercised.

### Evidence-led later triggers

Add a capability only after observed use proves the current ceiling is the constraint:

- daemon/scheduling: repeated need to continue after the attended process exits;
- parallelism: independent ready work dominates lead time and serial execution is measured bottleneck;
- remote/cloud runner: multiple machines/users or reliable scheduling cannot be satisfied locally;
- second model: a measured quality, cost, latency, or availability limitation cannot be resolved within the qualified Codex harness and the new model can be evaluated under the same authority and evidence contract;
- second worker harness: a measured Codex-harness limitation cannot be resolved by its current adapter/profile, and the candidate harness passes fake conformance plus a full real-worker canary before any support claim;
- second forge: a real repository or customer requirement cannot be served by GitHub and the new forge proves equivalent identity, least-privilege mutation, readback, reconciliation, review, and closure semantics;
- multi-repo: a real producer/consumer release requires coordinated slices;
- automatic merge: low-risk draft-PR outcomes show sustained quality, low intervention, reliable reconciliation, and explicit owner acceptance;
- deployment/canary: preview lifecycle and rollback are independently qualified;
- feedback connector or scheduled intake: the local/manual diagnostic workflow has enough recurring eligible signals to prove value, and explicit import cannot meet the measured triage burden;
- model scoring: deterministic lifecycle fields cannot answer a named judgment question, representative labels and calibration exist, and the expected benefit exceeds scoring/privacy/review cost;
- self-improvement: enough approved diagnostic and labeled dependent-sequence cases exist for uncontaminated baseline/candidate comparison, and evaluator/authority mutation remains outside the candidate run.

## 22. Work-plan operating rules

- Promote this temporary plan into compact authoritative Mill artifacts only after explicit implementation approval; do not commit this file by default.
- During remaining development, use the current Codex harness, Mill repo-local instructions, native commands, and the operator-side Factory skills identified in Section 24. They are implementation aids rather than Mill product dependencies or authority.
- Do not claim self-hosting because Mill code helped with a fixture or PR. A candidate cannot qualify or release itself; dogfood and genesis boundaries remain explicit.
- Begin each implementation PR with one outcome, exclusions, affected paths, exact checks, scenario coverage, risk, authority, and stop conditions.
- Include the approved impact manifest and item-level new-behavior/preservation expectations in every Wave 4+ implementation task.
- Use red-first behavior or a structured reason why no meaningful red state exists.
- Keep implementation, tests, native docs, migrations, and pre-merge closure in the same PR.
- Run one architecture/threat review before medium/high-risk implementation and one exact-candidate review after validation.
- Group review findings systemically; do not respond with serial micro-fixes.
- Stop after recurring high-severity findings and simplify the design.
- Commit only durable product truth, code, tests, scenarios, decisions, and compact config. Keep raw runtime evidence out of Git.
- Validate every claim with a clean checkout, delivered artifact, provider readback, or explicit limitation as applicable.
- Never broaden authority because a tool or credential happens to be available.

## 23. Decision register with latest responsible wave

Later-wave choices must not delay an earlier vertical proof. Before a planned wave
starts, its applicable decision inputs must be explicitly approved and frozen in the
implementation task packet. The decision row closes when its rationale and exact
value are promoted into the relevant committed Mill product, architecture, policy,
config, or task contract in that same coherent PR before merge; no prior
documentation-only PR is required. A row authorizes only its stated wave and cannot
broaden an active run.

| State / close before | Decisions to promote | Current or recommended position |
|---|---|---|
| Wave 1 closed | Product/repository name and collision-free CLI/package namespace; Apache-2.0; DCO and external-contribution boundary; exact Node 24 LTS/TypeScript/package-manager invocation; initial npm/OIDC/provenance and genesis trust design; Mill repository required checks, `CODEOWNERS`, sole-maintainer merge, conversation-resolution, bypass, and default-branch policy | `Mill`, `millctl`, Apache-2.0, Node 24 LTS/TypeScript, sole-maintainer human merge, and the public repository foundation are landed. `@davidahmann/mill` remains the planned package and must be rechecked before publication. |
| Wave 2 closed | Manual feasibility-spike fixture; first qualified host OS/architecture, Node, OCI engine/image; selected Codex CLI adapter, operator auth flow, data disclosure, and honest isolation label; SQLite library/packaging; application-state path, permissions, backup, retention, purge, and redacted support bundle | Codex CLI is the sole v1 worker. `attended-trusted-host` execution, pinned OCI verification, SQLite recovery, bounded process execution, and operator-owned authentication are landed with explicit containment limitations. |
| Wave 3 closed and canary-qualified | Git/`gh`/GitHub support tuple; canonical repository/rebind rules and allowlist; exact required CI context names; local-required versus remote-required review policy, trigger, settlement limit, account/cost owner; allowed merge method(s), candidate/PR-head/merge-tree binding; branch deletion and P2/conversation disposition; attended disposable canary evidence | Exact-candidate draft-PR delivery, local required review, optional configured GitHub review, authoritative readback/reconciliation, human merge, truthful closure, and the attended real-provider canary are landed. Material provider/profile drift still requires requalification before renewing the support claim. |
| Wave 4A closed | Product invariant shape/stable-ID policy; impact-manifest and item-level semantic-evidence contracts; future research-source/provider requirements; product/design/UX approval boundary; internal `WorkerAdapter`; role-specific invocation/profile schema; supplied context/provider-visible scope/effective-instruction freezing; first continuity dogfood | Compact behavioral invariants, per-slice impact, exact semantic evidence, derived graph posture, immutable worker admission, and Codex-only real-worker support are landed at `39ae11f`. Proposal, blueprint, and scenario inputs are operator-supplied; live research and autonomous drafting are not landed. |
| Wave 4B closed | One Node/TypeScript recipe usable for greenfield and compatible adoption; exact repo footprint/ownership; founder preflight/two-card UX; transactional integration verification and later packed-release canary requirements; manual remote setup; detach/pre-integration rollback/purge/export guidance | The exact Node.js 24/Next.js 16 recipe, transactional integration, lock-bound dependencies, real offline recipe verification, task compilation, detach planning, and founder coordinator are landed. Wave 5 packed-installed greenfield/adoption canaries remain. Other stacks remain unsupported. |
| Wave 5 | Longitudinal sequence/canonical-reset qualification design and thresholds; bounded audit commands; final public-alpha qualified support tuples; exact worker-profile change canary; package/repository namespace availability recheck; supported-version and best-effort support window; exact packed-installed greenfield/adoption/security/recovery/release canary set; exact-artifact release identity; installed CLI transitive-dependency policy | Activate and qualify the existing release workflow/tag-verifier foundations. Require at least one five-or-more-step dependent sequence starting from prior accepted Mill outputs, plus a separate seeded-fault branch proving rejection or recovery before the next accepted base. Publish the exact independently qualified artifact and only tuples proven in clean environments. Do not claim prior-schema migration support before the first real released migration. |
| Post-alpha Gate E | Eligible feedback sources and denominator; case identity/deduplication; disposition taxonomy; data minimization/retention; deterministic metrics; replay authority; candidate/evaluator/approval/release separation; canary and rollback. Model-scorer calibration, cost, and holdout authority apply only if their separate evidence triggers close. | Deliver the read-only feedback/evaluation foundation first, then controlled candidate proposals. No model scorer before the named judgment gap, labels, calibration, and value case exist. No connector write-back, automatic ticket/PR dispatch, evaluator mutation, auto-merge, release, or deployment without a later separately proven effect class. |

### 23.1 Next implementation start gate

Waves 1–4B and Gate C are landed. The next work is Wave 5:

1. freeze one Wave 5 task packet on the current `main`, binding the longitudinal corpus, bounded audit scope, documentation rewrite, genesis protocol, distribution identity, support tuples, clean-room environments, release actions, rollback/withdrawal, and stop conditions;
2. keep Wave 5 implementation, tests, schemas, release-workflow hardening, README/agent/development/reference documentation, and all knowable pre-merge closure in one coherent PR;
3. qualify the exact committed candidate locally and in PR CI, then merge through the configured human boundary and observe `main`;
4. only after merge, prove candidate-tree/resulting-main-tree equality and request separate authorization for the ordered tag, preserved-`.tgz` npm publication, GitHub release, registry readback, and postpublication canaries; do not declare public alpha until their final gate passes; and
5. do not implement the post-alpha feedback or controlled-improvement layers until Gate E's evidence triggers close. Preserve the distinction between external maintainer tooling and proof of Mill's product/runtime behavior.

## 24. Borrowed concepts and deliberate exclusions

### Borrow

- Factory: deterministic repo-native gates, architecture questions, twelve-tier taxonomy, exact candidate binding, same-delivery closure, fail-closed ambiguity, credential and provenance principles.
- factoryd: worktree isolation, bounded execution, checkpoint/recovery, remote-effect reconciliation, exact GitHub lifecycle observation, fault-injection thinking.
- Telryn Platform: focused PRD, grouped acceptance, one JIT slice, frozen review, one repair cap, applicable test subset.
- Telryn OSS: packed-artifact validation, offline install proof, dependency/license inventory, cross-platform release checks.
- Vetryn: typed outcome DAG and generated current-state projection, but not committed run/evidence volume.
- FDE Guide: PRD as hypothesis, source/authority separation, representative normal/exception/recovery cases, controlled improvement and accepted-outcome economics.
- Ponytail: complexity ceiling, explicit upgrade trigger, canonical source plus adapter-drift checks, uncontaminated baseline/candidate evaluation.
- OpenCode commit `69c172e8a7c0086887b1f93ed5a162f14b6aa0c5`: durable admission before worker wake, typed context snapshots, normalized provider/event boundaries, and readiness-signal testing.
- Pi commit `96317e50b8d6e7f6d0e47fd29122baf1461c00f5`: a small embedding boundary, explicit trust and containment limitations, durable history separated from lossy compaction, adapter/evaluation discipline, and release supply-chain hardening.
- If the second-worker-harness trigger is eventually earned, evaluate Pi first because its embedding seam is smaller; this is a future spike order, not a dependency, selection, compatibility claim, or support promise.
- Devin, Factory.ai, 8090, Warp, Foreman, Symphony, and OpenHands: disposable sessions, plan approval, intent traceability, factory-as-code, affected-app QA, replaceable workers, narrow orchestration boundaries, and human merge.
- Warp's published self-improvement pattern: explicit scorer axes, sampled evaluation, aggregation of failed observations, evidence-linked change proposals, and holistic configuration edits instead of prompt addendum accumulation. Treat the pattern as a design lead, not independent proof of quality or ROI.
- The supplied Cosmos feedback-triage case study: persistent signal ownership, evidence-first investigation, explicit `answer`/`route`/`duplicate`/`fix`/`plan` dispositions, one focused clarification, and human product judgment before downstream delivery. Treat its reported outcomes as vendor-authored evidence, not a Mill performance claim.

### Deliberately exclude

- Factory/factoryd dual-repository compatibility and bundle-promotion topology;
- regex or shallow Markdown parsing as trusted planning;
- Go-CLI-specific bootstrap assumptions;
- dozens of artifact types, acceptance ledgers/mappings/closure maps, and copied validators;
- committed claims, journals, review reports, state files, and trace exhaust;
- a reference runtime duplicating the production runtime;
- closure-only promotion tails and micro-PRs;
- keyword-only review-family classification as policy authority;
- OpenCode or Pi as a runtime, build, protocol, or distribution dependency;
- their TUI, provider marketplace/model picker, session sharing/history server, plugin/package/skill/MCP ecosystems, project-executable extensions, generic RPC package split, self-update channel, or harness-owned control plane;
- harness permission prompts, sessions, compaction, progress, or final prose as Mill authority, evidence, containment, or recovery state;
- cloud-first control plane, distributed scheduling, multi-model routing, or graph storage before evidence requires them;
- a hard global five-comment review limit that could conceal P0/P1 or protected-class findings;
- Slack, a tracker, a scorer dashboard, scheduled cloud agents, or automatic PR-author dispatch as mandatory Mill infrastructure; and
- direct signal-to-policy/code changes, prompt-addendum accumulation, or autonomous self-modification based only on aggregate model scores.

### Factory skill adoption boundary

Factory supplies useful operator workflows and design lessons during Mill's bootstrap, but it is not a Mill runtime, package, compatibility, or downstream-repository dependency.

During pre-self-host development, David/Codex may use the already installed `task-executor`, `validation-gate`, `code-review`, and `commit-push` skills to implement and ship Mill changes under Mill's own `AGENTS.md`, task brief, and native commands. Those skills run outside the product as maintainer tooling. They cannot grant Mill authority, by themselves certify a Mill runtime or release claim, or replace Mill's repo-native acceptance evidence.

| Factory role or lesson | Mill-owned product equivalent |
|---|---|
| `repo-bootstrap` / `repo-retrofit` | `millctl new` / `millctl adopt` transactional integration |
| `scout-context` | source classifier and frozen context compiler |
| `execution-compiler` | product-contract, outcome, and JIT slice compilers |
| `task-executor` | bounded Codex builder adapter |
| `validation-gate` | native command and realistic-scenario verifier |
| `code-review` | exact-candidate isolated-context reviewer |
| `repair-feedback` | one systemic repair wave |
| `commit-push` | already-committed candidate shipper and draft-PR adapter |
| `post-merge-monitor` | provider readback, main-check observation, and closure |
| holdout/trace/evidence roles | deferred evaluators added only when isolation and measured need justify them |

Mill runtime never shells out to Factory skills or factoryd. The Mill source
repository does not track a Factory profile, verifier, pack, or sibling checkout.
Downstream repositories likewise need no Factory checkout, bundle compatibility,
Factory evidence artifacts, or copied skills. A durable lesson learned while using
an external maintainer tool must be rewritten as a Mill contract, test, or
repo-native instruction before Mill claims it; inherited prompts are not product
architecture.

The bootstrap sequence is intentionally asymmetric:

1. Waves 1–2 were built with the current Codex harness, operator-side skills, and repo-native CI; incomplete Mill did not qualify itself.
2. Wave 2 dogfooded local execution on a disposable fixture.
3. Wave 3 implemented and fake-provider-tested draft-PR/readback behavior, then completed the attended disposable-repository canary through human merge and resulting-main readback.
4. Wave 4A landed the semantic continuity boundary. Wave 4B is locally implemented and qualified but still requires its exact-candidate promotion path.
5. Maintainers may ship Mill with its native checks and ordinary Git/GitHub interfaces; optional external tools do not certify Mill runtime claims.
6. Wave 5 must dogfood semantic evidence and continuous evolution without treating Mill's candidate behavior as its own release authority.
7. Mill's public artifact follows the independent genesis protocol in Wave 5. Only later evidence can justify replacing operator-side bootstrap tooling.

An optional thin Codex `mill-operator` skill may be added after the CLI is stable to improve conversational UX. It may translate user intent into `millctl` calls but owns no state, policy, credentials, or hidden lifecycle and must always have a documented direct-CLI fallback.

## 25. Final readiness criterion

Mill is ready for public alpha only when a clean-room operator or separately controlled verification environment, distinct from the builder context but not presented as a second governance maintainer, can use the genesis-qualified release candidate/artifact to:

1. inspect the release and verify its integrity;
2. create or adopt a disposable repository from a PRD, disclosed source manifest, and operator-supplied structured proposal, without claiming autonomous PRD-only planning;
3. approve structured product truth, stable invariants, scenarios, and blueprint;
4. approve the next outcome's impact manifest and see affected and uncertain invariant coverage;
5. run one attended Codex implementation in the declared trust mode;
6. observe item-level deterministic and realistic validation of new and affected prior behavior on the exact candidate;
7. obtain isolated-context review and one bounded repair cycle;
8. open a draft PR without passing forge/deploy credentials into the builder boundary, with any stronger non-access claim supported by qualified isolation;
9. survive cancellation and a simulated ambiguous remote effect without duplication;
10. merge manually and observe truthful post-merge closure;
11. reproduce a five-or-more-step dependent evolution sequence from prior accepted Mill outputs without concealing an unresolved earlier invariant failure; and
12. run the selected recipe/release audits, verify the exact Mill version, manually pin or restore the pre-Mill integration snapshot where applicable, purge/export state, and detach while the downstream repository remains operable. No prior-release upgrade claim is required before the first real migration exists.

If a required real-provider or delivered-surface step is replaced by a fake provider or synthetic stub, skipped, pending, or dependent on an untracked local assumption, the corresponding support or autonomy claim remains unproven. Deliberate fault injection remains valid evidence for the failure behavior it is designed to exercise.

## 26. Independent review disposition

Independent review passes challenged this draft through architecture/safety, downstream adoption/portability, single-maintainer OSS/release, pre-start operability, and continuous-software-evolution/product lenses. Their material findings were incorporated:

- local candidate commit now precedes validation/review; shipping only pushes the unchanged commit;
- host Codex is no longer described as contained unless process/filesystem/credential controls are fault-tested;
- remote effects now have an implementable intent/key/receipt/readback crash protocol;
- the first release has a genesis qualification exception before N-to-N+1 begins;
- the horizontal build was replaced with five vertical waves that prove one manual task through local review and draft PR before generalized PRD/stack intelligence;
- static adoption no longer claims runtime baseline failures, and safe worktree mechanics precede apply;
- exact proposal digest semantics now freeze approved canonical bytes rather than promise deterministic model output;
- credentials never live in Mill state; model/research disclosure, redaction, retention, purge, and source-qualified cost are explicit;
- exact per-repo Mill version invocation, authority precedence, clone/fork/forge rebinding, state namespacing, generated ownership, and Mill-absent operability are explicit;
- `doctor`, `qualify`, `verify`, detachment planning, and remote shipping have distinct mutation/authority boundaries; upgrade planning is explicitly deferred until a real released migration exists;
- public-alpha support and qualification were narrowed to one selected greenfield recipe plus one adoption canary;
- hidden holdouts, automated migration/detach, tracker projection, remote provisioning, broad recipe support, and stronger autonomy were deferred until evidence exists;
- Node/npm release trust, DCO, genesis, and single-maintainer branch-protection constraints were made concrete;
- Factory skills are now explicitly bootstrap-only, the founder has one resumable golden path, and the remote reviewer/account policy is explicit; Wave 3's disposable GitHub/CI/manual-merge/readback qualification is landed and remains subject to requalification only after material provider/profile drift or expiry;
- unresolved decisions now close at the latest responsible wave rather than all blocking the first implementation slice;
- Mill's durable value is now continuity and proof across changes rather than patch generation alone;
- stable behavioral invariants and per-change impact manifests extend the compact existing contract instead of introducing a graph platform;
- downstream semantic scenarios now require item-level executed evidence rather than digest binding or prompt visibility alone;
- Wave 5 now qualifies a dependent change sequence from prior accepted Mill outputs, separates new-behavior completion from preservation, and exercises seeded-fault containment; and
- chat memory, derived graphs, agent-authored oracles, and autonomous self-modification remain non-authoritative;
- Wave 4A is described as the assessor it actually implements: it freezes operator-supplied proposal, blueprint, and scenario inputs and does not claim live research or autonomous generation;
- Wave 4B's local fake-OCI integration tests and real offline recipe verification are separated from Wave 5's required packed-release greenfield/adoption canaries;
- feedback learning is now a post-alpha signal-to-investigation workflow with repository-scope isolation, deterministic-first metrics, scorer and judge separation, conditional holdouts, and pre-merge candidate evaluation; and
- Wave 5 activates the existing release foundations and requires the exact independently qualified package artifact to be the artifact later published.

No independent reviewer found a reason to abandon the core direction after these corrections. Waves 1–4B and the Wave 3 external qualification are landed. David authorized Wave 5 implementation and GitHub landing from the resulting `main` on 2026-09-03. Genesis tag creation, npm publication, GitHub Release creation, and post-alpha feedback or controlled-improvement work remain separately authorized effects.

## 27. Review basis

This plan synthesizes actual implementation and process evidence from:

- Factory's org development, architecture, evaluation/evidence, continuous-eval, repo-bootstrap, retrofit, agent-legibility, and parser policies;
- factoryd's PRD bootstrap, task lifecycle, Codex worker, worktree, containment, durable state, reconciliation, GitHub shipping, review, and closure implementations;
- Telryn Platform's attended JIT slice model and SaaS/browser quality lanes;
- Telryn OSS packed-artifact, dependency/license, CI, and release checks;
- Vetryn's typed plan/evidence model and observed review/evidence churn;
- the FDE Guide's reframing, authority separation, evaluation-corpus, production-governance, and controlled-improvement guidance;
- Ponytail commit `2ed6c52c9d7e5e56942508591085fd45dea277d3`, especially its complexity ladder, upgrade triggers, adapter-drift checks, and uncontaminated benchmark discipline;
- OpenCode commit `69c172e8a7c0086887b1f93ed5a162f14b6aa0c5`, especially durable admission, typed context snapshots, normalized provider/event boundaries, and readiness-based tests;
- Pi commit `96317e50b8d6e7f6d0e47fd29122baf1461c00f5`, especially its minimal embedding seam, explicit project-trust limitations, history/compaction separation, adapter tests, and release supply-chain practices;
- Zhenfeng Cao's `Agentic Software` preprint (`arXiv:2606.05608`), treated as a conceptual thesis rather than empirical proof;
- SWE-Milestone, formerly EvoClaw (`arXiv:2603.13428`), especially its distinction between feature recall and regression-preservation precision, dependency-ordered evaluation, accumulated-error analysis, and published benchmark limitations;
- official Codex SDK, App Server, and code-review documentation;
- official material for Devin, Factory.ai, 8090, Warp Factories, Vercel Foreman/Eve, OpenAI Symphony, and OpenHands, treated as architecture signals rather than independent proof of vendor outcome claims;
- the supplied Warp self-improvement/scoring essay, used only for scorer-versioning, sampled evaluation, and governed candidate-loop design leads; and
- the supplied Cosmos feedback-triage case study, used only for evidence-first signal handling, explicit disposition, and human product-judgment design leads. Its reported outcomes are not Mill evidence.

Implement and land Wave 5 as the final coherent public-alpha candidate, including the documentation and agent-operating-contract rewrite. Then stop at the separately authorized genesis effect boundary. The feedback and controlled-improvement layers remain post-alpha and evidence-triggered. The reviewed repositories, essays, and papers remain evidence sources, not runtime, build, compatibility, support, or authority dependencies.
