# Writing and documentation

Write for the maintainer who must decide, operate, or review the change. State
the current behavior, the evidence for a claim, and the remaining limit. Keep
examples runnable and label future or experimental behavior as such.

## Required inputs

Documentation work uses the repository-owned writing guide and the
`writing-quality` playbook. An approved task that changes prose must freeze both
files in its context selection. The builder and reviewer receive the same bytes.
The guide helps write and review; it cannot define acceptance, change command
controls, or approve delivery.

Keep `AGENTS.md` for authority and navigation. Put procedures, examples, and
editorial detail here or in a selected playbook.

## Editorial review

The reviewer checks that a changed document:

- says who needs the information and what they can do with it;
- distinguishes observed behavior from a plan, experiment, or release claim;
- links a technical claim to its owning source where a link exists;
- preserves quoted material, code, identifiers, licenses, and evidence records;
- uses direct sentences and concrete verbs; and
- keeps the repository's authority and safety boundaries intact.

`npm run docs:check` catches a small set of mechanical failures: broken local
links and a few recurring empty phrases in changed Markdown. It does not judge
voice, factual support, or whether a document was written by a person or model.
The command reports each file and line. It uses an explicit base when CI
supplies one; local work compares the working tree with `origin/main` when
available.

The checker resolves `git` from `MILL_GIT_PATH` when set, then from `PATH`. That
keeps the local documentation gate usable on hosts where the system Git is not
the active Git installation.

Do not change this guide, the selected writing playbook, the documentation
checker, or a task's acceptance inputs within an ordinary documentation task and
then use the change as its own proof. Prepare policy changes separately and run
the pre-existing checks against them.

## Scope

Apply this process to changed prose. Historical release records, canary
evidence, licenses, exact quotations, generated content, and code examples need
accuracy, but they are not targets for a stylistic rewrite. Live external-link
checks stay outside Mill's offline verifier.
