# X Ask bar chat — status
Updated: 2026-10-24T20:15 (done: all green, screenshots reviewed)

## Scope
- ✅ askHistory.ts, useAsk.ts (chat controller) written
- ✅ Read ask bar, ask-flow, ipc, chat lib, mocks, manager, docs
- ✅ Contract: `ask.submit` req gets `since?: string` (ISO time of the last "New chat")
- ✅ ask-flow: context = last 10 'ask' messages created after `since` (latest since remembered for `/d`);
     optional `emitDelta` dep streams the reply on thread 'ask' (needs shell.ts wiring — not my file)
- ✅ handlers.ts 'ask.submit' passes `since`
- ✅ src/main/flows/ask-flow.test.ts (9 tests green)
- ✅ Ask bar chat UI (AskBar, AskLog, useStickToBottom, useWindowAutoSize, askbar.css): log above composer (Notion-AI style), textarea composer (Enter/Shift+Enter/Esc/⌘N),
     markdown replies + chips per reply, streaming, stick-to-bottom, window grows to 600 then scrolls,
     re-push size on every open (main resets bounds to 52 on open)
- ✅ New chat: icon button in composer; since persisted in localStorage; history filtered; sent with submit
- ✅ Own browser mock (mock/askMock.ts, mock/askReplies.ts) for the ask bar in surfaces/askbar/mock (multi-turn, chat.history, ?seed=N),
     keeps `window.__ddMock.calls` so overlay-screens.spec askbar tests keep passing
- ✅ Tests: AskBar.test.tsx (17), AskChoose.test.tsx (8), ask-flow.test.ts (9) — (multi-turn, new chat, streaming), ask-flow.test.ts
- ✅ Screenshots light/dark (+ choose view): compact bar, 3-turn chat, long scrolled chat (tests/e2e-sim/askbar-chat.spec.ts)
- ✅ tsc web+node clean, biome clean (my files), vitest 34/34, playwright askbar-chat 11/11, overlay-screens ask interaction test passes
- ✅ ADDED (useChoose.ts, SubjectChoices.tsx, choose.css, AskChoose.test.tsx, askbar-choose-*.png) (Ilari via coordinator): choose view — main opens ask bar with route 'choose' (#/choose on first load,
     'navigate' event later). Subject rows above the input (session.picker, most recent first) + "New topic…";
     pick → session.start({subjectId, goal:null, question:null}) + close; New topic → typed text → session.start
     ({subjectId:null, goal:text}) + close. Esc closes. Tests + screenshots light/dark.

## Decisions
- `since` (renderer owns the reset marker) instead of `newChat: boolean`: main stays stateless across
  restarts; renderer filters visible history with the same marker.
- lib/mock's ask.submit keeps no history, so `since` needs no handling there (type flows through).
- The ask bar's browser mock was overlay/mock/mockApi.ts (not my lane); the ask bar now uses its own.

## Next
1. Nothing open in this lane; see requests below.

## Open issues / requests for the integrator
- overlay/mock/mockApi.ts createAskbarMock is now unused (ask bar has its own mock) — L7b owner can delete it.
- overlay-screens.spec 'ask bar: empty and answered' will regenerate overlay-askbar-*.png with the new look (not run by me).
- `/d` turns honour a New chat only after the ask bar sent `since` once in this app run (main keeps it in memory).
- shell.ts: add `emitDelta: hooks.onChatDelta` to `new AskFlow({...})` so Ask replies stream.
