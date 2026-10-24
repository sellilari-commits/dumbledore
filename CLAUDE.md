# Dumbledore

A floating Mac study coach: it reads the screen, extracts what the student is learning, and writes
prompts into AI chats (ChatGPT, Claude, Gemini…), with roadmaps, checkpoint quizzes and follow-ups.
Electron + React + TypeScript, with a Swift helper (`native/helper`) for Accessibility, OCR and the
right-⌥ key. Start with `docs/PLAN.md`; `docs/progress/` holds per-area notes and
`docs/progress/INTEGRATION.md` the wiring notes.

## Workboard: claim work before you start (required)

More than one person and agent work in this repo at the same time. `WORKBOARD.md` shows what is in
progress so nobody works on the same files twice. Every agent, every time:

1. **Before starting:** `git pull --rebase`, then read `WORKBOARD.md`. If the files or area you
   need are already claimed under "In progress", pick other work or coordinate with that person
   first; don't edit claimed files.
2. **Claim it:** add one row to "In progress" (UTC start time, who and which agent, the work in a
   few words, the files or folders you will change, your branch). Commit only `WORKBOARD.md` with
   the message `Workboard: start <work>` and push it straight away, before writing any code, so
   the others see it.
3. **Keep it true:** if your scope grows to more files, update your row and push again.
4. **When done:** move your row to "Done recently" with the commit hash, in the same push as the
   work itself (or right after it). If you stop without finishing, remove the row or mark it
   "paused" with what is left.
5. **Conflicts:** if the push of your claim is rejected, pull, re-read the board, and only then
   claim. Two rows must never claim the same files.

Subagents spawned by a coordinating agent don't need their own rows: the coordinator claims the
whole batch, listing each subagent's files.

## Working rules

- Commit small, finished pieces and push them to `origin/main` promptly; don't leave work only on
  your machine.
- Before pushing: `npx vitest run <the areas you touched>`, `npx tsc -p tsconfig.node.json --noEmit
  --composite false`, `npx tsc -p tsconfig.web.json --noEmit --composite false`, and
  `npx biome check <your files>` must be clean.
- Never commit secrets. API keys live outside the repo (`.env.local` only names key files and is
  git-ignored).
