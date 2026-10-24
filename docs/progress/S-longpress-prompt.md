# S-longpress-prompt — right ⌥ hold = "tell Dumbledore what you want, it writes the prompt"

Spec (Ilari 2026-10-24): short press = the prompt (unchanged); long press = small box, student types
context, Enter → Dumbledore writes a prompt and pastes it into the AI chat; double-tap = plain chat.

## Status: done (2026-10-24)
- [x] router: holdStart → `promptBox` (ask bar route 'prompt'); focusAskbar when open; quiz card ignores
- [x] IPC `prompt.write` {context} → {pasted, prompt}; handler → `core.promptWriter.write`
- [x] flow src/main/flows/prompt-writer.ts (PromptWriter, on ShellCore)
- [x] ask bar prompt mode (usePromptBox.ts + AskBar.tsx); subject-choice view REMOVED
      (useChoose.ts, SubjectChoices.tsx, choose.css, AskChoose.test.tsx, demoPicker, choose screenshots)
- [x] gesture copy: onboarding (KeyStep, useKeyLesson), settings Shortcuts, orb tooltip, PLAN §5.6/D8/F4
- [x] tests: prompt-writer.test.ts, ipc.test.ts, decide/router tests, AskPrompt.test.tsx; e2e-sim spec updated (not run)

## Notes
- Order: improve() runs while the ask bar is still open (it shows "Writing your prompt…" / an error
  line), then the bar closes, then ChatWriter pastes (target 'chat'; its default clipboard fallback
  + "copied — press ⌘V" toast). Closing before writing would hide the thinking/error state.
- Subject studied last (lastStudiedSubject) goes into ctx.pageContext as "Subject: X"; the running
  session is already in PromptService's context.
- PromptService.improve never throws (falls back to the student's text), so an LLM outage pastes the wish.
- renderer/lib/mock/handlers-core.ts: one additive 'prompt.write' handler (type-check required it).
