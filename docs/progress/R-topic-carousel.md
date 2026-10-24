# R — Topic carousel in the ask bar (double-tap right ⌥ chat)
Updated: 2026-10-24 (done)

## Spec (Ilari)
Row of recent topics (session.picker, most recent first, ≤12) above the chat input; horizontal
carousel (trackpad/shift-scroll, ‹ › fade arrows). Click selects/deselects (no action). Enter with
text → ask.submit {text, subjectId}; Enter with empty input + topic → session.start + close.
←/→ move selection when input empty. Prompt mode unchanged.

## Plan / status
- [x] ipc: ask.submit req `subjectId?: string`
- [x] ask-flow: AskOptions.subjectId → "Topic: <name>" + subject context in coach context (+tests)
- [x] handlers.ts ask.submit passes subjectId
- [x] renderer: useTopics.ts + TopicCarousel.tsx + css; AskBar wiring; useAsk passes subjectId
- [x] askbar mock: session.picker with ~8 subjects, session.start
- [x] tests: AskTopics.test.tsx (11); e2e askbar-topics.spec.ts (12, port 5189) with screenshots
  askbar-topics-{row,selected,chat}-{light,dark}.png; askbar-chat "New chat" height check pinned to `?topics=0`
- [x] vitest askbar+main 214 green, tsc node/web 0 errors, biome clean (only the old ipc.ts `void` warning)

## Notes
- Fade under the ‹ › arrows is fully clear for 28 px, then ramps to 64 px, so an arrow never sits on
  chip text; `scroll-padding-inline: 64px` keeps a ←/→-selected chip clear of it.
- askbar-chat.spec.ts was also run (copy on port 5189): 11/11 green with the topic row on.
