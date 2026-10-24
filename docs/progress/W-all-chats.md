# W All chats — status
Updated: 2026-10-24T16:58:55Z

## Scope
- ✅ Verified bundle ids (Homebrew cask API uninstall/zap stanzas, iTunes lookup API, mdls) and hosts (live titles/redirects), 2026-10-24
  - current ChatGPT app = com.openai.codex (cask chatgpt 26.x); com.openai.chat = "ChatGPT Classic"
  - Perplexity = ai.perplexity.macv3; Copilot = com.microsoft.copilot-mac; M365 Copilot = com.microsoft.m365copilot; Gemini = com.google.GeminiMacOS
  - notebooklm.google.com → notebook.google.com; lmarena.ai → arena.ai; tongyi.com → qianwen.com
  - dropped unverified ids (Le Chat, DeepSeek, Grok have no macOS app)
- ✅ Catalog: ai-chat/catalog-web.ts (33 web assistants, incl. Google AI Mode udm=50, GitHub Copilot, Duck.ai…) + catalog-apps.ts (25 desktop/local apps: LM Studio, Jan, Msty, BoltAI, Ollama, Ollamac, Enchanted, Raycast AI (AI Chat window only), Chatbox, Cherry Studio, GPT4All…)
- ✅ Unknown LLM UIs: ai-chat/composer.ts (focused composer + AI evidence score), non-chat.ts (email/messaging/docs/search/social vetoes); detector order bundle → url → named placeholder → text → unknown
- ✅ Tracker: observeFocus(FocusedElement) keeps a composer hint per window+host; service listens to 'helper:focus'
- ✅ Unknown chats exposed as { key: 'ai_chat', assistant: 'AI chat' } through aiChat()/perception:aiChat
- ✅ Coding sessions are not study chats: ai-chat/coding.ts (editor/terminal bundles, claude.ai/code, chatgpt.com/codex, screen evidence needing ≥1 agent-only kind); builder splits a window's episode when it flips chat ↔ coding
- ✅ Tests: all-chats.test.ts, coding.test.ts, focus.test.ts, fixture 08-claude-app-code-tab.json; vitest perception+privacy 15 files / 260 tests green; tsc 0 errors; biome clean

## Next
1. Live check by the coordinator (Open WebUI on localhost, Claude app Chat vs Code tab, Edge Copilot sidebar).

## Open issues / requests for the integrator
- Overlay docking on the FIRST focus of an unknown chat: OverlayController.onFocus reads perception.aiChat() on 'helper:focus'; if it runs before Perception's listener it sees null and docks only on the next focus event (typing). Fix: re-run onFocus with the last element on 'perception:aiChat' (src/main/overlay).
- src/main/chat/placeholders.ts and src/main/fakes/fake-perception.ts still list old ids (no com.openai.codex, ai.perplexity.macv3); use chatInputPlaceholders()/detectAssistant from @engine/perception instead.
- Helper request: report AXDescription (accessible name, e.g. aria-label "Write your prompt to Claude") and AXDOMIdentifier in FocusedElement; many contenteditable composers have no AXPlaceholderValue.
- Helper request: windowId on FocusedElement, so a composer hint can be tied to the exact window rather than the frontmost window of the pid.
