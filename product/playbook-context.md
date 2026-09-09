# Repository playbook context foundation

Status: approved implementation scope, 2026-09-09. Owner: David Ahmann.

## Authority

David Ahmann authorized this native-maintainer increment in the attended Codex
conversation on 2026-09-09: “Ok plan it all implement test validate push till
green no release yet.” It implements the bounded repository-first form discussed
in that conversation. It authorizes no package version change, tag, npm
publication, GitHub Release, deployment, customer-system action, MCP server,
centralized playbook service, automatic update or background process.

## Outcome

An approved Mill task can select small repository-owned playbooks from a compact
index. Mill validates and pins the exact selected files as context, records that
selection in the context manifest, and rejects stale, missing, inconsistent or
builder-writable playbook inputs. Read-only CLI commands let an operator search
metadata before retrieving one verified playbook.

## Scope

1. Define public schemas for an indexed playbook and its self-contained content:
   applicability, required inputs, procedure, verification, stop conditions and
   boundaries.
2. Add optional task selection that binds the index digest and selected IDs.
   Resolve and protect the selected files during admission and freeze them in
   the manifest and worker prompt.
3. Add read-only `playbooks list`, `search` and `show` commands. Search returns
   metadata; show verifies the indexed content bytes before returning a body.
4. Add one provider API adaptation playbook drawn from Mill's existing synthetic
   adaptation qualification, plus documentation and negative tests.
5. Define the post-run improvement path as a separate human-reviewed repository
   change. It cannot alter the candidate or acceptance oracle of the run that
   discovered the improvement.

## Boundaries

- A playbook is context, not product truth, acceptance, command control,
  verification evidence, delivery or merge authority.
- Shared migration knowledge can describe an upstream change and common
  procedure. Customer configurations, customer data and approved acceptance
  remain local to each application repository.
- Mill records selected playbooks, not every provider-visible filesystem read.
- No MCP interface is added. Any later integration must preserve the underlying
  command's authority and prove value against a concrete workflow.
- No centralized distribution, polling, telemetry, automatic instruction
  mutation, daemon, arbitrary stack support or support-matrix expansion is
  introduced.

## Acceptance

- PB-01 A valid selected playbook is index- and content-digest bound, enters the
  context manifest and cannot overlap builder output scope.
- PB-02 Missing IDs, changed index/content bytes and conflicting metadata block
  admission or retrieval.
- PB-03 List/search/show are read-only, search only metadata and show verifies
  one selected file.
- PB-04 Shared versus repository-local knowledge is documented without allowing
  either form to replace task-owned acceptance or checks.
- PB-05 Native checks, packed-package checks, schema generation, exact-candidate
  audit, complete-diff review and PR CI pass. No release is made.
