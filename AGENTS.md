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

- User-facing audio ships as pre-generated committed clips (Azure da-DK neural
  TTS, `da-DK-ChristelNeural`) — never runtime synthesis as the primary path.
  The app is clip-first; the Web Speech fallback for a missing clip is a
  degraded state that must be disclosed in the UI ("talsyntes"), and the
  number drills play composed committed clips only (no fallback).

## Audio generation procedure (run after ANY new Danish words/sentences)

Whenever Danish text that users can hear is added or changed — new lessons
(`<span lang="da">` prose spans), starter-deck rows, examples, number atoms —
generate the missing clips before (or with) the push that ships the text:

1. `set -a; . ./.env; set +a; npm run tts` — idempotent: synthesizes only
   missing clips, rebuilds `src/data/lesson-audio.json`, rewrites deck CSV
   audio columns. (`npm run tts -- --numbers` for number atoms; praksis-deck
   clips are gated — see `scripts/generate-tts.ts` header.)
2. If the script rewrote a CSV with no content change (line-endings only),
   restore it: `git checkout -- src/data/vocab/*.csv`.
3. `npm run check:content` must pass; commit the new `public/audio/*.mp3`
   together with the manifest in the same commit as the text they voice.

A lesson/word PR or push without its clips leaves the new content silently on
the Web Speech fallback — treat missing clips as a broken build.

These rules are the default for future sessions in this repository until the user explicitly overrides them.
