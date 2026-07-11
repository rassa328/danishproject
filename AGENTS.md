# Shared Workspace Policy

This repository is edited concurrently by Claude instances, Codex instances, and other agents. Treat the workspace as shared unless the user explicitly says otherwise.

- Do not edit project files, refactor, or write new material without the user's permission. When permission is given, make only the scoped changes required by the current request.
- Inspect relevant files and the working tree before editing.
- Preserve all existing and concurrent work, including uncommitted changes.
- Never reset, revert, discard, overwrite, or clean up unrelated changes.
- Avoid broad formatting, generated-file churn, and mechanical rewrites unless requested.
- If another agent is changing the same file, coordinate or work around the overlap rather than replacing their work.
- Before patching, use lightweight checks such as status, diffs, timestamps, or targeted context to detect concurrent edits; re-read only the portions needed to merge safely.
- Do not create commits, branches, stashes, or external side effects unless requested.
- Stay within configured permissions; request approval before access or actions outside the authorized scope.
- Sub-agents may be spawned and delegated to freely when useful. Give them bounded tasks and the same shared-workspace constraints.
- Put temporary files and scratch work in a dedicated directory under `/tmp`, not in the repository.
- Store all project planning Markdown under `docs/plans/`. Do not create plan files elsewhere.

## Workflow

- Every task begins by running `npm run plans:check`.
- Approved plans are committed to `docs/plans/active/` before implementation starts.
- Finished plans move to `docs/plans/done/` with `status: done`.
- `docs/plans/active/` is the shared task-coordination source.

## Product invariants

- User-facing audio uses real human recordings only; never text-to-speech.

These rules are the default for future sessions in this repository until the user explicitly overrides them.
