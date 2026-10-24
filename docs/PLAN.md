# Dumbledore — Build Plan v1

> Approved 2026-10-24 (from the summary) · Stack: TypeScript (Electron + React) + a small Swift helper · Target: macOS 26 on Apple Silicon (built and tested on this Mac first)

---

## 0. TL;DR

- **What:** a floating study coach for the Mac. It reads the screen with local OCR, works out what the student is learning and where they struggle, and — when an AI chat (ChatGPT, Claude, Gemini, Perplexity) is open — turns that into a roadmap plus well-written prompts that it pastes straight into the chat box. Short checkpoint quizzes sit between steps; spaced follow-up exams come later.
- **Three surfaces:** a tiny orb that lives on screen (Goldfish-style), a floating mini panel (context, progress, chat), and a full Notion-style app (subjects, roadmaps, exams, everything Dumbledore knows).
- **Tech:** Electron + TypeScript + React for the app and all logic. A ~1k-line Swift helper for the Apple-only APIs (Accessibility, Vision OCR, global right-⌥, paste, the on-device model). Local SQLite.
- **Free AI:** Apple's on-device model reads the screen text (free, stays on the Mac). Groq's free tier writes roadmaps, quizzes and prompts. A keyless EU service (OVHcloud) is the fallback.
- **Update 2026-10-24, AI provider:** Gemini 3.5 on the Hugo project's key is now primary for every tier (`gemini-3.5-flash-lite` for triage/extract, `gemini-3.5-flash` for reason/write/chat), with a hard €10 total spend cap. Apple on-device, OVHcloud, Groq and Mistral are fallbacks. Routes: `DEFAULT_ROUTES` in `src/shared/llm.ts`.
- **Screen text:** read through Accessibility first, as Goldfish does. Apple's built-in Vision OCR covers what is only pixels (slides, scanned PDFs, video): nothing to download or bundle, and it only runs when the screen changes.
- **Build:** in parallel waves. Up to six subagents build separate parts at the same time. Then come integration, hardening, and a dogfooding loop on this Mac with real ChatGPT until the Definition of Done (§9.4) is met.
- **Needed from you at approval:** a project folder, 1 free Groq API key, a one-time permission click once the packaged app is ready, an OK to use your ChatGPT for testing, and a choice on the right-⌥ clash with Goldfish (§12).

---

## 1. The product in one picture

```
 PERCEIVE ───────────────────────────────────────────────────────────────────────────────
 screen ─▶ capture when pixels change ─▶ Vision OCR (local) ─▶ episodes (same app/page)
        ─▶ local prefilter ─▶ cheap LLM extraction:  ① what was on screen
                                                     ② big picture (topic path + purpose)
                                                     ③ did they understand it? (+ evidence)
                                   │
                                   ▼
 REMEMBER ──────────────────  LEARNING MEMORY  (SQLite + readable .md "memory file")
                              subjects ▸ concepts ▸ encounters ▸ mastery ▸ deadlines
                                   │
 COACH (inside AI chats) ──────────▼──────────────────────────────────────────────────────
 AI chat open ─▶ "Study" pill ─▶ pick subject / study question ─▶ ROADMAP (starts where you are)
   ─▶ step prompt written + pasted into the chat box ─▶ you read the answer
   ─▶ ▸ Next (side button or right ⌥) ─▶ next prompt, adapted to what just happened ─▶ …
   ─▶ checkpoint quiz (MCQ) ─▶ misses carry into the next checkpoint ─▶ … ─▶ done
                                   │
 FOLLOW UP ────────────────────────▼──────────────────────────────────────────────────────
 spaced reviews & exams at natural breaks ─▶ gaps ─▶ "explore with ChatGPT" prompts ─▶ loop
```

The idea in one sentence: **Dumbledore does the quizzing and the remembering; the student's own AI does the teaching — through prompts Dumbledore writes, so the student learns how to prompt by example.**

---

## 2. Requirements traceability (your brief, step by step)

Every line of the brief maps to a feature, a module and a work package (WP, §8).

| # | Requirement (from the brief) | How the plan covers it | WP |
|---|---|---|---|
| R1 | Teach students how to learn; fix the "cold start" of using LLMs to learn | Roadmaps + prompts written for the student; a one-line coach tip with each prompt explaining the technique; prompt improver for the student's own prompts | 6, 8 |
| R2 | Knows the student's context: tasks, assignments, what they must learn | Screen perception → extraction of topics, struggles, assignments and deadlines; "About you" profile; learner profile summary | 4, 7, 8 |
| R3 | Coaches how to use ChatGPT/Claude etc. most effectively | Step prompts, improver, coach tips, prompt-habit insights from the student's own prompts | 6, 8 |
| R4 | Watches literally everything on screen | Always-on capture of the frontmost window (+ other large visible windows), OCR on change, with privacy guardrails | 3, 4 |
| R5 | Follows up at a suitable time with an exam; finds gaps; pushes to explore with LLMs | Spaced-review scheduler + natural-break detection, exams, gap diagnosis, "explore" prompts, next-topic suggestions | 8 |
| R6 | Mac-only, installed as a real app | Signed `Dumbledore.app` (agent app, menu-bar icon, launch at login) | 0, 9 |
| R7 | Lives on screen like Goldfish: minimal, seamless, low RAM, perfect context | Orb overlay, no Dock icon, measured RAM/CPU budgets (§6.10) | 5, 9 |
| R8 | Click it → progress, goals, context; interact | Mini panel: Right now · Session · Goals & due reviews · Subjects · Chat | 5 |
| R9 | Proactively recommends, encourages, suggests prompts | Nudge engine (rate-limited), suggestion chip at chat boxes, "Right now" suggestions | 5, 8 |
| R10 | User grants access to everything | Onboarding with live permission status: Accessibility (required), Screen Recording (optional, for OCR) | 0, 7 |
| R11 | User can move it around | Draggable orb, snaps to screen edges, remembers its home per display | 5 |
| R12 | Moves to a text box when the user types/clicks into it; suggests the perfect prompt | Docking: orb glides to the focused AI-chat input; suggestion chip (empty box) or "Improve prompt" (typed text) | 5, 6 |
| R13 | Click it → it starts working / writing a prompt | Context-aware click: in an AI chat with a session → next prompt; otherwise opens the panel | 5, 6 |
| R14 | Always catching the perfect context | Episodes + signals + live chat extraction between steps; "Now" context feeds every prompt | 4, 6 |
| R15 | Press "option" bottom right (right ⌥) → starts writing a prompt | Global right-⌥ tap = "do the smart thing"; hold = Ask bar | 3, 5 |
| R16 | App: progress, learnings, struggles, context; generate tests/exams; control focus | Full app: Home, Subjects, Subject page, Inbox ("what Dumbledore knows"), Exams, Settings; focus controls | 7 |
| R17 | Go into the different things they are studying | Sidebar of subjects → Subject pages (Roadmap / Concepts / Seen / Exams) | 7 |
| R18 | Logo click → nice floating screen with context, progress and a chat | Mini panel (§5.2) | 5 |
| R19 | Full-page app with all context, subjects, progress, very easy exam creation | Full app; "Generate exam" in two clicks from anywhere | 7 |
| R20 | Interface is a direct copy of Notion's style | Design system built from Notion's live 2026 tokens (§3.2), Notion layout patterns | 2 |
| R21 | Learn Goldfish's functionality and Notion's design first | §3.1 teardown of the installed Goldfish.app; §3.2 tokens pulled from a live Notion page | done |
| R22 | Strong, proper plan | This document | done |
| R23 | Build the Mac app per the technical details | Phases 0–9 | 0–9 |
| R24 | Test it yourself on this computer: ChatGPT, exams, subjects | E2E-real scenarios S1–S9 (§9.3) on this Mac | 10 |
| R25 | Iterate in a loop until it is perfect | WP10 loop with exit criteria (§9.4) | 10 |
| R26 | OCR: local, always on, with on/off switch | Vision OCR in the helper; switch in menu bar, panel and Settings, plus a shortcut | 3, 4, 5 |
| R27 | Cheap/free LLM: "is this something the user is trying to learn?" | Local prefilter, then the extractor prompt (P1) on a free fast model | 4 |
| R28 | If yes → write to a file in three parts (seen / big picture, hierarchical / understood?) | `encounters` records with exactly those three parts + a per-subject Markdown "memory file" mirror | 4 |
| R29 | Detect that an LLM chat is open | Detector: app bundle id, browser URL, OCR markers | 5 |
| R30 | A button appears on screen | "Study" pill next to the orb | 5 |
| R31 | It opens the list of study questions extracted earlier; user picks the subject | Picker: subjects with their open study questions + free-text "what do you want to learn?" | 6 |
| R32 | Cheap LLM goes through the subject and related items from the extraction file | Context assembly from memory (encounters, mastery, misses, deadlines) | 6 |
| R33 | Roadmap: optimal start, questions in the right spots, wrong answers carry over, ≥1 quiz scaled to size, short challenging multiple choice | Roadmapper (P3) + checkpoint quizmaster (P5) + carry-over logic (§6.6) | 6 |
| R34 | Write a prompt for the user's LLM starting at step 1; short answers, no small talk, structured | Step writer (P4) with brevity/structure rules | 6 |
| R35 | Detect where the chat box is and paste the prompt into it | Accessibility lookup → OCR-placeholder fallback → focus → paste → verify | 3, 6 |
| R36 | An arrow button under the main button pastes the next prompt, only while steps remain; plus a shortcut; copy Goldfish | Side stack under the orb: ▸ Next (k/n), Quiz; right-⌥ does the same | 5, 6 |
| R37 | The prompt-writing LLM has a tool to write to the memory file | `memory_updates` output channel on P4 + `remember()` tool for the coach | 6 |
| R38 | Long press → user can prompt the cheap LLM | Long-press orb/side button or hold right-⌥ → Ask bar | 5, 6 |
| R39 | Every time the user reads something or answers a quiz → extraction → update the file | Live extraction of the chat between steps; quiz answers update mastery and memory | 6 |
| R40 | "I want to understand X" → always start by creating the roadmap, even with no context | Coach rule + cold-start roadmap with optional 60-second placement check | 6 |
| R41 | "My prompts might be weak — make them great" | All prompts rewritten (Appendix A) and evaluated (§9.2) | 4, 6 |
| R42 | (follow-up message) TypeScript, app-based | Electron + TypeScript + React; Swift only where Apple APIs require it | all |
| M1 | Detailed, structured plan; codebase stays structured | §6.2 repo layout, interface-first contracts, living docs, review gates (§10) | all |
| M2 | Use subagents and parallelism; don't do things one after another when they don't depend on each other | §8.0 parallel waves (up to six builders at once) + §10.3 | all |
| M3 | Explicit focus on a simple, nice UI | §5 UX spec, wireframes, design system, UI review gate per phase | 2, 5, 7 |
| M4 | Review everything and test that all pieces work | §9 test pyramid, evals, E2E, perf, dogfooding | all |
| M5 | Free LLM APIs | §3.3 provider research and routing | 1 |
| M6 | OCR without having to run a model | Apple Vision (built into macOS), change-triggered | 3 |
| M7 | Plan first, then stop for approval | This document; building starts after your OK | — |
| M8 | (follow-up message) Shortcuts inspired by Goldfish | §5.6 shortcut map: one clean-tap key with tap/hold/double-tap, `/d` inline commands, selection + key, Esc cancels | 5 |

---

## 3. Research findings — what we copy

### 3.1 Goldfish (teardown of the installed Goldfish.app v0.1.66 + its docs)

**What it is.** `com.kaspi.goldfish` by Goldfish AI, Inc. (launched June 2026). A Tauri 2 (Rust) app with a SvelteKit UI in WKWebViews and native NSPanels. Three processes: UI, a daemon (SQLite + full-text search + local embeddings + vector index) and an MCP proxy. Its LLM is GPT on a private Azure deployment.

**How it sees.** No screenshots and no OCR. It reads window text through the Accessibility API, driven by focus/change notifications with a ~6 s fallback interval. It forces Chrome and Electron apps to expose their text. Secrets are masked at capture. It pauses when idle or locked. A large built-in blocklist covers sign-in pages, banks, brokers, crypto, health and adult sites, password managers and private windows.

**How it lives on screen.**
- "The drop": a small black pill latched to a screen edge, a corner or the notch. Drag it to re-latch. It can hide into the edge until the pointer comes near; optional push-to-open (press the pointer against the edge for 150 ms).
- Built as one transparent full-screen panel that never activates the app. The page reports its hit areas, so everything else is click-through. It is excluded from screen sharing.
- Status is shown as glyphs inside the pill (thinking dots, recording dot, unread orange dot, pause bars) instead of separate notifications.
- Nudges grow out of the pill as bubbles. Ignored ones collapse into an orange dot and expire after 1 h. Contextual tips are capped at one a day. There is a morning brief and an evening wrap.
- "Field fish": a tiny fish parks beside the focused text field; clicking it rewrites the text.

**The right-⌥ key ("Goldfish key").**
- Detected by *polling* the modifier state rather than hooking key events, which avoids the Input Monitoring permission. A key-press counter makes sure only a clean tap counts.
- Tap in a field: carries out a typed instruction, rewrites a selection, or drafts into an empty field from context. Tap elsewhere: opens chat. Hold or double-tap: a command bar over the field. Esc cancels. Password fields are refused.
- Writes into the field through Accessibility first (verified), with ⌘V as the fallback. It never touches the field until the result is ready, and aborts if the context changed.
- Remappable (any modifier or fn), with the fallback chord ⌘⇧G. Onboarding teaches the key by making you press it ("That's left Option…") and offers to switch off conflicting shortcuts (Claude Desktop's double-tap ⌥).

**Footprint on this Mac** (3.7 h uptime): ~194 MB resident, ~640 MB physical footprint (its web views dominate), about 2–4% of one core on average.

**No side "next" arrow exists in Goldfish.** We design that ourselves in its visual language.

**What we copy:**
- Clean-tap modifier trigger: tap / hold / double-tap, context routing, fallback chord, and onboarding that teaches the key by doing.
- The floating element: latched to an edge, never activating, click-through outside its shapes, hidden from screen sharing, able to hide into the edge.
- Status shown as glyphs on the orb.
- Nudges that grow out of the orb and decay to a dot, under strict caps; a morning plan and an evening wrap.
- An element docked beside the focused field.
- Writing into fields: Accessibility first, then ⌘V. The field is untouched until the result is ready, Esc cancels, password fields are refused.
- Accessibility-first text capture with secret masking and a large default blocklist.
- Permission grants detected automatically.

**What we do differently:**
- OCR fallback for content that only exists as pixels (slides, scanned PDFs, video, canvas-drawn apps), as your brief asks.
- Study-specific memory: concepts, mastery, quizzes.
- A visible Next button for step-by-step sessions.
- No telemetry.
- Free LLMs instead of a paid backend.

**Conflict on this Mac:** Goldfish already owns right ⌥ here and sits in the notch. Decision needed in §12.1. **Decided 2026-10-24:** Dumbledore takes right ⌥ and Goldfish's key is switched off.

### 3.2 Notion design (live tokens pulled from a public Notion page on 2026-10-24)

Notion's 2026 CSS uses semantic variables (`--c-texPri`, `--c-bacSec`, `--c-shaOutMd`, …). We copy these values one-to-one into `tokens.css`.

**Core tokens**

| Role | Light | Dark | Notion variable |
|---|---|---|---|
| Text primary | `#2C2C2B` | `#F0EFED` | `--c-texPri` |
| Text secondary | `#7D7A75` | `#ADA9A3` | `--c-texSec` |
| Text tertiary / placeholder | `#A19E99` | `#7D7A75` | `--c-texTer` |
| Text disabled | `#BCBAB6` | `#5F5E59` | `--c-texDis` |
| Background page | `#FFFFFF` | `#191919` | `--c-bacPri` |
| Background secondary (sidebar, headers) | `#F9F8F7` | `#202020` | `--c-bacSec` |
| Background tertiary (pressed, chips) | `#F0EFED` | `#383836` | `--c-bacTer` |
| Hover / interactive | `#F4F3F3` | `#262626` | `--c-bacInt` |
| Popover / menu | `#FFFFFF` | `#252525` | `--c-popBac` |
| Border primary (dividers, tables) | `#E6E5E3` | `#383836` | `--c-borPri` |
| Border strong (inputs) | `#D4D3CF` | `#5F5E59` | `--c-borStr` |
| Icon primary / secondary | `#383836` / `#8E8B86` | `#E6E5E3` / `#ADA9A3` | `--c-icoPri/Sec` |
| Accent (buttons, links, focus) | `#2383E2` · hover `#0077D4` · pressed `#006BC7` | same | `--c-palUiBlu600` |

**Shadows (light):** small `0 2px 4px #0000000A, 0 0 0 1px #2A1C0012` · medium `0 8px 12px #19191907, 0 2px 6px #19191907, 0 0 0 1px #2A1C0012` · large `0 20px 24px #1919190D, 0 5px 8px #19191907, 0 0 0 1px #2A1C0012` · button `inset 0 0 0 1px #0F0F0F1A, 0 1px 2px #0F0F0F1A` · focus ring `#2383E291 0 0 0 1px inset, #2383E259 0 0 0 2px`. Dark shadows swap the 1px outline for `#383836`.

**Colour pairs (text on tinted background) for tags, callouts and status**

| Colour | Text (light) | Bg (light) | Bg (dark) | Dumbledore meaning |
|---|---|---|---|---|
| Gray | `#7D7A75` | `#F0EFED` | `#383836` | New / not started |
| Brown | `#9F765A` | `#F5EDE9` | `#45362D` | — |
| Orange | `#D27B2D` | `#FBEBDE` | `#53361F` | Due for review |
| Yellow | `#CB9434` | `#F9F3DC` | `#504425` | Learning |
| Green | `#50946E` | `#E8F1EC` | `#263D30` | Mastered / correct |
| Blue | `#387DC9` | `#E5F2FC` | `#233850` | In progress / selected |
| Purple | `#9A6BB4` | `#F3EBF9` | `#3C2D47` | Exam |
| Pink | `#C14C8A` | `#FAE9F1` | `#4E2B3C` | — |
| Red | `#CF5148` | `#FCE9E7` | `#502C29` | Struggling / wrong |

**Typography:** `ui-sans-serif, -apple-system, system-ui, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif` (on a Mac this renders SF Pro, like Notion). Mono: `SFMono-Regular, Menlo, Consolas, monospace`. Scale: page title 40/48 bold · H1 30 semibold · H2 24 semibold · H3 20 semibold · body 16/24 (compact surfaces 14/21) · meta 12–13 · inline code 85% size, red text on a 4px-radius tint.

**Layout patterns we copy:** 240px sidebar on `--c-bacSec` with 28px rows · 44px top bar with breadcrumbs · page = emoji icon (78px) + title + property rows + blocks · ~708px reading column, full-width option · toggles, callouts (tinted background + emoji), to-do checkboxes, dividers · database table views with coloured select tags and view tabs · ⌘K search · controls that only appear on hover · soft menus with the large shadow · 150 ms transitions.

### 3.3 Free LLM APIs (verified 2026-10-24)

> **Update 2026-10-24:** for the provider choice this section is superseded: Gemini 3.5 is primary (see §0). The research below still describes the fallbacks.

Free tiers shrank a lot in 2026. What is left and fits:

| Provider | Free terms | Models we'd use | Structured output | Data | Role |
|---|---|---|---|---|---|
| **Apple on-device model** (called through our Swift helper) | Unlimited; runs on the Mac | System model, 4K-token context | Guided generation (typed schemas) | Never leaves the Mac | **Extraction, primary.** English content; needs Apple Intelligence switched on; not Finnish |
| **Groq** | Per model: 30 requests/min, 1K requests/day, 8K tokens/min, 200K tokens/day; no card | `openai/gpt-oss-120b`, `openai/gpt-oss-20b` (~1000 tokens/s), `qwen/qwen3.8-27b` (preview) | Strict JSON schema; tools (not combined with a schema) | Not retained by default; zero-retention option; US | **Reasoning + prompt writing, primary** |
| **OVHcloud AI Endpoints** | Anonymous, no key; 2 requests/min per IP per model | `gpt-oss-20b`, `gpt-oss-120b`, `Qwen3.8-27B` | Strict JSON schema | Never stored or trained on; EU | **Keyless fallback for everything** |
| Mistral (optional key) | "Free mode", no card | `mistral-small-2603`, `ministral-8b-2512` | Schema, tools | EU; opt out of training | Optional EU fallback |
| Cloudflare Workers AI (optional key) | 10K "neurons"/day | `@cf/openai/gpt-oss-20b`, `@cf/google/gemma-4-26b-a4b-it` | Best-effort schema | No retention or training | Optional extraction fallback |

**Ruled out:**
- **Gemini:** its terms forbid apps likely used by under-18s, and require paid services for apps serving the EEA.
- **Cerebras:** now a paid trial.
- **GitHub Models:** shut down July 2026.
- **Hugging Face:** $0 free credit.
- **SambaNova:** 20 requests a day.
- **NVIDIA:** trains on your data.
- **OpenRouter free models:** 50 requests a day, and providers may train on your data.
- **Local Ollama:** works, but a 9B model costs several GB of RAM. Optional only.

**Headroom.** A heavy study day needs roughly 0.2–1.1M tokens for extraction, 0.1–0.6M for reasoning and 0.05–0.45M for prompt writing.
- On-device extraction removes the biggest share.
- Groq covers a light-to-normal day of reasoning and prompts. On heavy days the router overflows to OVHcloud.
- Groq's 8K tokens/minute cap means big jobs such as exams are split into ~5-question calls and queued.
- Worst case, if everything were paid: ≈ $0.24 a day.

**Gotchas we design for:**
- Groq's preview models disappear fast. Model IDs live in config, with automatic fallback.
- Free quotas are per account. A future public version needs per-student keys or a small proxy, because API keys inside an Electron app can be extracted.
- Groq's terms require users to be 18+. Fine for you; it matters for a school launch.
- Everything is redacted before it leaves the Mac.

**SDK:** Vercel AI SDK `ai` v7 with `@ai-sdk/groq`, `@ai-sdk/mistral` and `@ai-sdk/openai-compatible` (for OVHcloud, with `supportsStructuredOutputs: true`). The Apple model is called through the Swift helper behind the same router interface.

### 3.4 Platform facts verified on this Mac

Machine: macOS 26.4.1, Apple M1 Pro, 16 GB · Node 24.20 / npm 11.19 · Swift 6.3.3 with Command Line Tools (no full Xcode) · Chrome, Safari, Claude, Notion and Goldfish installed.

**Electron** (spike on this Mac: Electron 45.0.0, Chromium 156, Node 24.22)
- The orb window (`type:'panel'`, `focusable:false`, shown with `showInactive()`) never took focus: the front app stayed the same in 14 of 14 runs.
- Memory, as physical footprint (what Activity Monitor shows):

  | Setup | Footprint |
  |---|---|
  | No windows | 41 MB |
  | Orb only | 74 MB |
  | Orb + panel sharing one renderer (`window.open`) | 89 MB |
  | Panel with its own renderer | 103 MB |
  | *Goldfish on this Mac, for comparison* | *~640 MB* |

- `better-sqlite3` 13 ships prebuilt binaries: no rebuild, loads in Electron 45, and FTS5 and WAL work.
- Playwright drives Electron 45 (launch in 380 ms; screenshots of the transparent orb work). Its clicks bypass the window server, so focus tests use `lsappinfo front` instead.
- `desktopCapturer` is unusable for us: it screenshots every window on each call and can trigger prompts. Capture stays in the Swift helper.
- **Open risk:** Electron has no supported "panel that takes typing without activating the app" yet (issue #52915; fix pending in PR #52914). Typing into Dumbledore's own panels therefore briefly activates the app, and we hand focus back afterwards (§4 D7). A native Swift panel in the helper is the fallback.
- A process started from a terminal gets the terminal's permissions, and macOS 26.1+ hides bare executables from the Privacy lists. So the Swift helper is its own small background app, signed with a stable local certificate, and its permissions survive rebuilds.
- Tooling: electron-vite 6 (Vite 8), electron-builder 26.18, Playwright 1.64, Vitest 5, zod 4.6.

**Swift helper** (spike on this Mac: Command Line Tools only, Swift 6.3.3)
- **Build.** Builds with Command Line Tools alone: AppKit, Vision, ScreenCaptureKit, ApplicationServices, CoreGraphics, Carbon. About 1,100 lines → a 310 KB binary, with 9 s rebuilds. The old `CGWindowListCreateImage` is unavailable when targeting macOS 15+; ScreenCaptureKit screenshots compile.
- **OCR.** Settings: Vision `.accurate`, `en-US`, language correction off, auto-detect off. ~390 ms per Retina window at 99.5% character accuracy; peak ~260 MB RSS for under a second. Cost follows the amount of text, not pixels, so we capture windows at native resolution, cropped to the window. Fast mode is unusable. Greek Δ is never recognised.
- **Finnish.** Vision has no Finnish model, but `en-US` accurate mode reads ä/ö almost perfectly. Å is the weak spot; a small post-correction fixes Ă→Å.
- **Accessibility.**
  - Field frame from AXPosition/AXSize; caret from AXBoundsForRange.
  - Electron apps need AXManualAccessibility. Chrome builds its tree lazily. Safari always exposes it.
  - The active tab URL comes from AXURL on the page element, so no Automation permission is needed.
- **Right ⌥.** keyCode 61. Any key or click while it is held cancels the tap (this covers ⌥2 = @). Secure input blocks it. We use Goldfish's polling approach, so no Input Monitoring permission is needed.
- **Paste.**
  1. Save the whole clipboard.
  2. Write our text marked as transient, so clipboard managers skip it.
  3. Post ⌘V with the layout's real key code, from a private event source with only ⌘ set (the user may still be holding ⌥).
  4. After ~400 ms, restore the clipboard if it is unchanged.

  Accessibility insertion is reliable in native fields but not in Chrome/Electron, so the method is chosen per app.
- **Permissions.**
  - A process launched as a child inherits its parent app's grants. In development the helper runs under this Claude app's existing grants; the packaged app asks once for its own.
  - macOS 15+ periodically re-asks about screen recording (monthly to ~90 days). That is another reason OCR is only the fallback. **Screen Recording becomes optional**: without it, Dumbledore runs on Accessibility text alone, like Goldfish.
- **Native orb fallback.** A helper-owned orb (NSPanel at screen-saver level, all Spaces, full-screen auxiliary, never key) compiles, so the F-ORB fallback is real.

---

## 4. Key decisions

| # | Decision | Why |
|---|---|---|
| D1 | **TypeScript everywhere: Electron 45 + React + Vite.** | Your call ("typescript, everything app based"). One language for app, logic and UI; the best tooling for a Notion-grade UI. Measured on this Mac: orb + panel cost ~89 MB, far below Goldfish's ~640 MB. You first said Python; this plan follows your later message. |
| D2 | **One small Swift helper app for Apple-only APIs** (Accessibility, Vision OCR, screen capture, global right-⌥, keystrokes/paste, the on-device model). It is its own background app and holds all the macOS permissions; the Electron app needs none. | No TypeScript library covers these reliably. With the permissions on the helper, Electron rebuilds never reset them. The helper is a simple, well-tested tool: all decisions stay in TypeScript. |
| D3 | **Screen text: Accessibility first, Apple Vision OCR as the fallback.** | Goldfish reads screen text only through Accessibility: exact text, no screenshots, cheap. We do the same first. When a window has little readable text (scanned PDFs, slides, video, canvas-drawn apps), we OCR it with Apple Vision. That matches your OCR note: no model to download or keep running. Vision ships with macOS, runs on the Neural Engine, and only runs when pixels change. |
| D4 | **Local-first storage:** one SQLite DB + a readable Markdown "memory file" per subject. | Matches your "write to a file" idea while staying queryable. Nothing leaves the Mac except redacted snippets sent to the LLM. |
| D5 | **Free AI in three layers:** Apple's on-device model for extraction; Groq's free tier for roadmaps, quizzes and prompts; keyless OVHcloud (EU) as the fallback. All sit behind one router with budgets and a local prefilter. | Free tiers shrank in 2026 (§3.3). On-device extraction removes the biggest token load and keeps most screen text on the Mac. |
| D6 | **Paste, never auto-send** (setting, off by default). | The student stays in control and reads every prompt before sending. |
| D7 | **The orb never takes keyboard focus** (verified in 14 of 14 runs). Surfaces you type into (Ask bar, panel chat, picker search) briefly activate Dumbledore. They then hand focus back to the exact chat box, checked, before anything is pasted. | Otherwise pasting into ChatGPT breaks. Electron can't yet take typing without activating the app. If the hand-back proves flaky, the Ask bar moves into the helper as a native panel. |
| D8 | **Right ⌥: tap = "do the smart thing", hold = rewrite the prompt in the AI chat box, double-tap = chat window** (changed 2026-10-24 at Ilari's request; it was hold or double-tap = Ask bar). Only a clean tap counts. Detected by polling the modifier state, as Goldfish does. | ⌥ is a character modifier on many layouts (Finnish: ⌥2 = @), so a press combined with another key is ignored. Polling avoids the extra Input Monitoring permission. The key is remappable and has a fallback chord. |
| D9 | **Dumbledore quizzes; the student's AI teaches.** Checkpoints run in Dumbledore's own quiz card. | Reliable scoring, instant feedback, clean carry-over. Teaching happens in the student's tool of choice, which is the skill we want to build. |
| D10 | **Own Notion-clone design system**: Radix primitives for behaviour, our CSS for looks. No UI kit. | A UI kit would fight the Notion look. |
| D11 | **Quizzes are generated just in time** (one step ahead), not when the roadmap is made. | Questions then match what the AI actually explained and include the latest misses. |

**Interpretations of ambiguous bits** (correct me if wrong):
- "Option on the bottom right" = the right-hand ⌥ key.
- "The button on the side of the screen" = the orb's side stack; the orb docks to a screen edge by default.
- "Short and multi-question" = 3–5 multiple-choice questions per checkpoint.
- "Write to a file" = the SQLite record is the source of truth and the Markdown file is its readable mirror.

---

## 5. User experience spec (the part that matters most)

### 5.1 Principles

1. **Quiet by default.** The orb is a 40 pt circle. It only shows a badge or speaks when it has something useful.
2. **One primary action per surface.**
3. **Notion's visual language.** Lots of white space, one font, grey hierarchy. Colour only carries meaning: status tags, progress, correct/wrong.
4. **Never steal focus, never interrupt typing.** No nudges while the student types, during full-screen video or in meetings.
5. **Fast, or honest about waiting.** Optimistic UI. Skeletons say what is happening ("Reading your notes on SN1…").
6. **Keyboard first.** Right ⌥ everywhere, Esc closes, ⌘K in the app.
7. **Teach by showing.** Every pasted prompt comes with a one-line "why this works" tip, so the student absorbs good prompting.
8. **Accessible.** WCAG AA contrast in both themes, honours "reduce motion".

### 5.2 Surfaces

| Surface | Size / place | Contents & behaviour |
|---|---|---|
| **Orb** | 40 pt circle. Default home: right screen edge, vertically centred (the notch is Goldfish's spot on this Mac). Drag to latch to any edge or corner; remembers its spot per display; can hide into the edge until the pointer comes near. Visible on all Spaces and over full-screen apps; hidden from screen sharing | Half-moon-spectacles glyph (Dumbledore's signature, monochrome). Status shows on the orb as glyphs, Goldfish-style: idle · capture paused (glyph at 40% + pause bars) · thinking (2 px blue arc rotating) · session (2 px progress ring k/n) · something waiting (8 px orange dot) · docked (shrinks to 28 pt beside the chat box). Click = context action (§5.3 F4). Long press = Ask bar. Hover = tooltip "Dumbledore · right ⌥". |
| **Side stack** | 28 pt rounded squares directly under the orb | Appears only during a study session: **▸ Next** (label "3/8" on hover) while steps remain, **Quiz** when a checkpoint is next. Long press = Ask bar. |
| **Study pill** | 28 pt pill beside the orb (toward the screen centre) | Appears when an AI chat is open and no session runs: "Study · 4" (4 = open study questions). Click → picker. |
| **Suggestion chip** | Small chip beside the docked orb | Empty chat box: first ~50 characters of the suggested prompt + "⌥". Typed text: "Improve prompt · ⌥". |
| **Toast** | 320 pt card that grows out of the orb | Title + one sentence + up to 2 buttons. Auto-hides after 15 s; hovering pauses it. Used for nudges, coach tips, errors. An ignored nudge collapses into the orb's orange dot and expires after 1 h. |
| **Quiz card** | 380 × auto pt panel beside the orb | One question at a time, 4 options, instant feedback + rationale, "n of 4" dots, finishes with a score and "Fix my gaps". |
| **Ask bar** | 560 × 52 pt, Spotlight-like, centred on the active display | "Ask Dumbledore — e.g. 'I don't get recursion'". Enter sends; the answer and action chips expand below. Esc closes and returns focus. |
| **Mini panel** | 380 × 580 pt, anchored to the orb | Header (logo, focus picker, capture switch, ⤢ open app) · **Right now** · **Session** (roadmap mini-list + Next/Quiz) · **Goals & due** (deadlines, due reviews, Quick exam) · **Subjects** (emoji, name, progress bar) · **Chat** (sticky input). |
| **Full app** | 1200 × 800 window, hidden title bar with traffic lights over the sidebar | Sidebar (Search ⌘K, Home, Inbox, Exams, Settings, Subjects list, + New subject) · pages (§5.3 F7). Shows in the Dock only while open; closing destroys its renderer to free RAM. |
| **Menu bar icon** | Spectacles template icon | Open Dumbledore · Pause capture ⌃⌥⌘P · Hide orb · Settings · Quit. |
| **Onboarding** | Full-app window, first run | 5 short pages (F10). |

### 5.3 Core flows

**F1 — Passive capture (always on)**
1. The helper captures the frontmost window (and other visible windows covering ≥25% of a screen) when its pixels change. It skips blocked apps/sites and private windows.
2. Vision OCR returns text lines with positions.
3. The engine groups frames into an *episode* (same app + page). It strips menus and repeated chrome, and measures dwell time, re-reads, scroll-backs, searches and questions typed into AI chats.
4. A local prefilter decides whether the episode deserves an LLM call.
5. The extractor (P1) returns learning items with the three parts, open questions and any assignment or deadline.
6. Memory updates. The Inbox shows new items; new topics appear as *suggested subjects*.
7. Nothing appears on screen unless it helps (for example, a gentle offer after repeated struggle).

**F2 — AI chat open → study session (the core loop)**
1. The student opens ChatGPT (web or app). The detector flags "AI chat open" within ~2 s.
2. The orb shows the **Study** pill.
3. Click the pill (or right-⌥ with an empty chat box and no session) → **picker**: subjects ranked by focus, recency, struggle and due reviews, each with 1–3 extracted study questions, plus "Or type anything you want to learn…".
4. Pick → the orb's thinking ring spins and the roadmap is built (≤ 8 s) from memory. If a roadmap already exists: "Resume at step 3 of 8?".
5. The step-1 prompt is written fresh and **pasted into the chat box, not sent**. A coach-tip toast explains why the prompt works.
6. The student presses Enter in ChatGPT and reads the answer.
7. **▸ Next** (side button or right-⌥) → the engine reads the chat (what the AI explained, any follow-ups the student asked), updates memory and writes step 2 adapted to that → pasted.
8. When the next item is a checkpoint, the side button becomes **Quiz** → quiz card with 3–5 MCQs and instant rationale. Misses are stored and re-tested with new questions at the next checkpoint. "Fix my gaps" pastes a targeted repair prompt into the chat.
9. Last step → "Roadmap complete" → a follow-up review is scheduled; offer a final exam now or later.
10. Sessions survive app switches and restarts, and resume from the panel or the app.

**F3 — Typing in an AI chat box (docking + suggest / improve)**
1. The student clicks into the chat input → the orb glides to the input's right edge (≤ 300 ms).
2. Empty box → chip with the best next prompt: next session step › an open question from the current page › a due review › a starter prompt. Right-⌥ or click inserts it.
3. Box has text → "Improve prompt" → right-⌥ rewrites the student's own prompt (same intent + context + structure + brevity) and replaces it. ⌘Z in the chat app undoes it. The tip says what changed.
4. Focus leaves → the orb returns home.

**F4 — Right-⌥ and orb-click routing**
- Tap = press + release in < 350 ms with no other key between. Hold (≥ 500 ms) or double-tap → Ask bar. ⌥ combined with any other key is ignored. A fallback chord (default ⌃⌥D) covers setups where right ⌥ is taken. The full map is in §5.6.
- While Dumbledore works, a small spinner sits by the caret. The field stays untouched until the text is ready. Esc cancels. If you switch app or field meanwhile, nothing is written. Password fields are refused.
- Tap / click resolves in this order:
  - (a) Active session in an AI chat → paste the next step, or open the quiz.
  - (b) A field line starting with `/d ` → run it as an instruction to Dumbledore.
  - (c) Focused AI chat box → insert the suggestion, or improve the typed prompt.
  - (d) Text selected → attach it (explain with ChatGPT / add to a roadmap / quiz me).
  - (e) AI chat open, no session → open the picker.
  - (f) Anywhere else → open the mini panel with "Right now" suggestions; tap again to close it.

**F5 — Ask bar (long-press / hold right-⌥) → prompt the cheap LLM directly**
"I don't get the Calvin cycle" → always starts with a roadmap, even with no record of the topic (cold start offers a 60-second placement check). Also: "make the next prompt simpler", "…in Finnish", "quiz me now", "skip this step", "what should I focus on?". Results appear inline with action chips; prompts are pasted where relevant.

**F6 — Mini panel (click orb outside a chat):** see §5.2. The chat answers "what should I focus on?" with a ranked list and action buttons.

**F7 — Full app pages**
- **Home:** greeting · Continue (active roadmaps) · Due for review (+ Start 5-min review) · Struggling with (red callout) · Upcoming deadlines · This week (study minutes per subject, questions answered, accuracy) · Prompting habits.
- **Subject page:** emoji + title · properties (Goal, Deadline, Status, Progress, Study time) · view tabs **Roadmap** (to-do blocks; checkpoints as callouts with scores; each step expands to show its prompt with Copy / Send to chat) · **Concepts** (table: name, status tag, mastery %, last seen, next review) · **Seen** (encounters with the three parts and the source) · **Exams** (table + New exam).
- **Inbox — "What Dumbledore knows":** new extractions to accept, reassign, merge or ignore · suggested subjects · captured-today stats · quick capture controls.
- **Exams:** list · **New exam** dialog (subjects, 5/10/20 questions, focus: weak spots / due / everything, difficulty) → exam page (one block per question, radio rows) → results (score, per-concept breakdown, gaps, "Explore with ChatGPT" prompts).
- **Settings:** Capture (switch, cadence, excluded apps/sites) · Orb (show, follow chat boxes, reset position) · Shortcut (right ⌥ / alternative) · AI providers (keys, test, model per tier, today's usage vs free limits) · Coaching (nudge frequency, quiet hours) · Privacy & data (retention, export, delete all) · About you.

**F8 — Follow-up at a suitable time**
The scheduler collects due concepts and recent sessions, waits for a natural break, then shows a toast ("3-min check on carbocations? You missed 2 yesterday.") → Start → quiz card or exam page → results → gaps → "Explore with ChatGPT" (pasted into an open chat, or copied) → next-topic suggestion.

**F9 — Controlling focus:** focus picker (panel header and app), per-subject Focus / Mute, "Ignore this app/site", pause capture (menu bar, panel, ⌃⌥⌘P), quiet hours.

**F10 — Onboarding (~3 min):** Welcome + privacy promise → Permissions (Accessibility required, Screen Recording optional for OCR; a live ✓ per item that flips by itself once granted; buttons open the right System Settings pane) → AI keys (paste, Test ✓) → What are you studying? (subjects, deadlines, About you) → Learn the key by pressing it ("Tap right ⌥ now"; it corrects you if you press left ⌥ or hold) and resolve shortcut conflicts (Goldfish, Claude Desktop's double-tap ⌥) → Try it ("Open ChatGPT and tap right ⌥").

### 5.4 Wireframes

Orb states and side stack (right screen edge):
```
  idle        thinking      session 3/8       AI chat open             docked at ChatGPT's input
  ╭────╮      ╭────╮ ◜      ╭────╮ ◔ ring     ┌────────┐ ╭────╮       ┌────────────────────────────────┐╭───╮
  │ ◡◡ │      │ ◡◡ │        │ ◡◡ │            │Study · 4│ │ ◡◡ │       │ Ask anything                   ││◡◡ │ ✨ Explain carbocation… ⌥
  ╰────╯      ╰────╯        ╰────╯            └────────┘ ╰────╯       └────────────────────────────────┘╰───╯
                            ┌──┐
                            │▸ │ 3/8
                            └──┘
```

Mini panel:
```
┌──────────────────────────────────────────────┐
│ ◡◡ Dumbledore    Focus: 🧪 Orgo ▾   ● On   ⤢ │
├──────────────────────────────────────────────┤
│ RIGHT NOW                                    │
│ Reading "SN1 reaction – Wikipedia" · 6 min   │
│ ┌──────────────────────────────────────────┐ │
│ │ ✨ Carbocation stability looks tricky     │ │
│ │ [ Make a roadmap ]   Insert prompt       │ │
│ └──────────────────────────────────────────┘ │
│ SESSION · SN1 vs SN2                  3 / 8  │
│ ✓ Nucleophiles   ✓ Leaving groups            │
│ ▸ Carbocation stability                      │
│ ○ Checkpoint 1 · 3 questions                 │
│ [ ▸ Next prompt   ⌥ ]                        │
│ GOALS & DUE                                  │
│ 🗓 Orgo midterm · Dec 12      2 reviews due   │
│ SUBJECTS                                     │
│ 🧪 Organic Chemistry  ▰▰▰▰▰▰▰▱▱▱  72%        │
│ 📐 Linear Algebra     ▰▰▰▱▱▱▱▱▱▱  31%        │
├──────────────────────────────────────────────┤
│ Ask Dumbledore…                            ↵ │
└──────────────────────────────────────────────┘
```

Full app — subject page:
```
┌──────────────────┬───────────────────────────────────────────────────────────────┐
│ ● ● ●            │ Subjects / 🧪 Organic Chemistry              [Generate exam]  ⋯ │
│ ◡◡ Dumbledore    │                                                               │
│ 🔍 Search     ⌘K │        🧪                                                      │
│ 🏠 Home          │        Organic Chemistry                                      │
│ 📥 Inbox       3 │        ◷ Deadline   Dec 12 · Midterm                          │
│ 📝 Exams         │        ◎ Progress   ▰▰▰▰▰▰▰▱▱▱ 72%                            │
│ ⚙️ Settings      │        ◉ Status     Learning                                  │
│                  │        ⏱ This week  2 h 40 min                                │
│ SUBJECTS         │        ───────────────────────────────────────────────        │
│ 🧪 Organic Chem  │        Roadmap   Concepts   Seen   Exams                      │
│ 📐 Linear Alg    │        ☑ Nucleophiles & electrophiles                         │
│ 🌍 Geography     │        ☑ Leaving groups                                       │
│ + New subject    │        ☐ Carbocation stability            ▸ Continue in chat │
│                  │        💡 Checkpoint 1 · 3 questions · carries 1 missed idea  │
│                  │        ☐ SN1 mechanism                                        │
└──────────────────┴───────────────────────────────────────────────────────────────┘
```

Exam results:
```
  📝 Weak-spots exam · Organic Chemistry                       7 / 10 · 70%
  ┌ By concept ───────────────────────────────────────────────────────────┐
  │ Carbocation stability  ▰▰▱▱  1/3   Struggling                          │
  │ SN2 inversion          ▰▰▰▰  2/2   Mastered                            │
  └────────────────────────────────────────────────────────────────────────┘
  💡 Your gaps: you treat primary carbocations as stable (Q3, Q7).
     [ Explore with ChatGPT ]   [ Copy prompt ]   [ Review in 2 days ]
```

### 5.5 Design system

- `tokens.css` = §3.2 values as CSS variables for light and dark (follows the system appearance; a manual override lives in Settings).
- Spacing on a 4 px grid (4/8/12/16/24/32/48/96) · radii 4 (controls), 6 (menus, cards), 10–12 (panels, toast, quiz card, ask bar) · motion 150–200 ms ease-out, off with reduced motion.
- Components: Button (primary blue / secondary outline / ghost), IconButton, Input, Textarea, Switch, Checkbox, Radio row, Tag (9 colours), ProgressBar (thin, green fill), Callout, ToggleBlock, Divider, Tooltip, Menu, Dialog, Toast, Skeleton, EmptyState, DatabaseTable, ViewTabs, Sidebar, TopBar/Breadcrumbs, PageHeader (emoji icon + title + properties), CommandPalette (⌘K), QuizQuestion, RoadmapItem, OrbGlyph.
- Icons: emoji for subjects (Notion habit), Lucide line icons (1.5 stroke) in `--c-icoSec` for UI.
- Microcopy: short, warm, concrete. No wizard clichés and no movie quotes. "Dumbledore" plus the spectacles glyph carry the character.

### 5.6 Shortcuts (modelled on Goldfish)

**The Dumbledore key is right ⌥.** As in Goldfish: one modifier key, detected by polling so only a clean tap counts. It can be remapped to any left/right modifier or fn (on JIS keyboards, right ⌘). The fallback chord is ⌃⌥D, and onboarding teaches the key by having you press it.

| Gesture | Context | Action |
|---|---|---|
| Tap | Study session running in an AI chat | Paste the next step, or open the quiz when a checkpoint is next |
| Tap | Line in a text field starts with `/d ` | Run the rest as an instruction to Dumbledore ("/d quiz me on chapter 3", "/d make it simpler"); Goldfish's `/g` idea |
| Tap | AI chat box focused, empty | Insert the suggested prompt |
| Tap | AI chat box focused, with your text | A hint: hold ⌥ to rewrite it |
| Tap | Text selected anywhere | Attach the selection: "Explain this with ChatGPT · Add to a roadmap · Quiz me on this" |
| Tap | AI chat open, no session | Open the subject picker |
| Tap | Anywhere else | Open the mini panel; tap again to close it |
| Hold ≥ 500 ms | AI chat box with your text (also during a session) | Rewrite your prompt in place; ⌘Z restores it |
| Double-tap | Anywhere | Chat window: a multi-turn chat with Dumbledore |
| Tap | Ask bar or quiz card open | Acts as Enter: send / next question |
| Esc | Any Dumbledore surface or pending action | Cancel or close; nothing is written |

- **Mouse, Goldfish-style:** click the orb = same as a tap · long-press = Ask bar · right-click = menu (Pause capture · Hide orb · Open app · Quit) · drag = latch to an edge or corner · hover = tooltip listing the shortcuts.
- **Only two global chords, to limit collisions:** ⌃⌥⌘P pause/resume capture · ⌃⌥⌘D open the full app.
- **Quiz card:** 1–4 pick an answer · Enter or right ⌥ confirm / next · Esc close.
- **Full app (Notion's own shortcuts):** ⌘K search · ⌘N new subject · ⌘E new exam · ⌘\ toggle sidebar · ⌘[ / ⌘] back / forward · ⌘⇧L dark mode · ⌘, settings · Esc close dialogs.
- **Where Dumbledore acts (decided 2026-10-24):** AI chats only, but every one the student uses, on the web or as an app, known or unknown (an unknown one is recognized by its chat box). Ordinary text boxes (email, docs, search) are left alone.
- Everything is remappable in Settings → Shortcuts. Conflicts (Goldfish's right ⌥, Claude Desktop's double-tap ⌥) are detected and a fix is offered.

---

## 6. Architecture

### 6.1 Processes

```
┌──────────────────────────── Dumbledore.app (agent app, no Dock icon) ────────────────────────────┐
│                                                                                                  │
│  Electron main (TypeScript)                                   Swift helper app (own bundle)      │
│  ├─ app shell: windows, tray, IPC, lifecycle   ◀─ JSON-RPC ─▶ ├─ window text via Accessibility   │
│  └─ engine (pure TS, testable without Electron)  Unix socket  ├─ fallback: capture + Vision OCR  │
│     ├─ perception: cadence, privacy, episodes, prefilter      ├─ Accessibility: focus, frames,   │
│     ├─ brain: LLM router, prompts, agents                     │  chat-input finder, values       │
│     ├─ learning: sessions, roadmaps, quizzes, mastery         ├─ right-⌥ gestures (polled)       │
│     ├─ scheduler: follow-ups, nudges                          ├─ paste / click / keys, clipboard │
│     └─ store: SQLite (Drizzle), memory .md mirror             └─ browser URL, permissions, idle  │
│                                                                                                  │
│  Renderers (React): overlay (orb + side stack + pill + chip + toast + quiz card) · panel ·        │
│                     ask bar · full app (created on demand, destroyed on close)                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
        │ HTTPS (redacted text only)
        ▼
  Free LLM APIs (router with fallbacks; optional local model)
```

- Screenshots never leave the helper and are never written to disk. Only OCR text crosses into the engine.
- The engine is framework-free TypeScript. Electron, the helper and the LLM providers are injected behind interfaces, so unit tests use fakes.
- The helper runs as its own background app (`Dumbledore Helper.app` inside the main bundle). It is started with `open` or SMAppService and reached over a Unix socket. macOS ties Screen Recording and Accessibility to it, so Electron rebuilds, and the terminal used during development, never affect permissions.
- The Electron spike showed the orb floats without stealing focus. The fallback stays documented in case a macOS update breaks that (§11): F-ORB, with the orb, side stack and Ask bar as native panels in the helper.

### 6.2 Repository layout

```
dumbledore/
├─ package.json · tsconfig.*.json · electron.vite.config.ts · biome.json · vitest.config.ts · playwright.config.ts · electron-builder.yml
├─ docs/            PLAN.md · PROGRESS.md (living checklist + issues) · ARCHITECTURE.md · DESIGN.md · DECISIONS.md (ADRs) · evals/
├─ native/helper/   Swift package: main.swift · RPC.swift · Capture.swift · ChangeDetect.swift · OCR.swift
│                   · Accessibility.swift · ChatInput.swift · Keys.swift · Input.swift · Browser.swift · Permissions.swift
├─ src/
│  ├─ shared/       domain types, zod schemas, IPC contract, helper RPC contract, constants (no Node/DOM imports)
│  ├─ engine/       perception/ · brain/ (llm/, prompts/, agents/) · learning/ · scheduler/ · store/ · privacy/ · events.ts
│  ├─ main/         app.ts · windows/ (overlay, panel, askbar, app) · tray.ts · ipc/ · helper-client/ · test-control/
│  ├─ preload/      typed contextBridge API
│  └─ renderer/     design-system/ · surfaces/ (overlay, panel, askbar, app) · pages/ · hooks/ · lib/
├─ tests/           unit/ · integration/ · e2e-sim/ (Playwright + fake helper) · e2e-real/ · fixtures/ (frames, episodes, llm)
├─ tools/           mock-chat/ (fake ChatGPT page) · seed-demo.ts · eval-prompts.ts · bench.ts · dev-launch.sh
└─ resources/       icons · entitlements.plist · Info.plist extras
```

Rules: `shared` imports nothing platform-specific; `engine` never imports Electron; `renderer` talks only through the preload API; one module = one responsibility, files ≲ 300 lines; every module has a header comment saying what it owns.

### 6.3 Helper protocol (JSON-RPC 2.0 over a Unix socket, newline-delimited, typed on both sides)

| Method | Returns |
|---|---|
| `ping` | version, permission summary |
| `permissions.status` / `permissions.request {kind}` | screen, accessibility, automation per browser |
| `frontmost` | pid, bundleId, app, windowId, title, frame, isFullScreen, browser URL |
| `perceive {scope: frontmost\|visible, minChange}` | Per window: source (`ax` or `ocr`), changed, content hash, text lines `{text, conf, box}` in screen coordinates (never an image). Accessibility text first; screenshot + Vision OCR only when the window has too little readable text or is on the OCR list |
| `ax.focused` | role, subrole, editable, frame, placeholder, valueLength, bundleId |
| `ax.readFocusedValue` | text of the focused field (only on an explicit key tap or "improve" action) |
| `ax.selectedText` | the current selection (only on an explicit key tap) |
| `ax.findChatInput {bundleId}` | element ref + frame (AX first, OCR-placeholder fallback) |
| `input.paste {text, target?, replace, restoreClipboard}` | ok, method used, verified |
| `input.click {x, y}` · `input.key {combo}` | ok |
| `system.idle` · `system.displays` | seconds idle · display layout |
| `llm.onDevice.status` · `llm.onDevice.generate {instructions, prompt, schema}` | Apple on-device model availability (Apple Intelligence on, model ready, language) · schema-guided JSON |

Events (helper → engine): `focus.changed`, `app.activated`, `key.rightOption {tap \| holdStart \| holdEnd}`, `screen.locked/unlocked`, `display.changed`, `helper.error`. The helper is restarted automatically if it exits.

### 6.4 Perception pipeline

| Stage | Detail |
|---|---|
| Cadence | Active (input in last 30 s): check every 2 s · idle 60 s+: every 10 s · idle 5 min+, locked or display asleep: paused · Low Power Mode: ×2 intervals |
| Scope | Frontmost window every tick; other visible windows ≥25% of a screen every 3rd tick (split-screen PDF + ChatGPT is a common study setup) |
| Text source | Accessibility text of the window first. As in Goldfish, Chrome/Electron apps are asked to expose their text; the walk is capped by depth and a 150 ms time budget. Fall back to screenshot + OCR when that yields < 200 characters or the app is on the OCR list (Preview with scanned PDFs, Keynote/PowerPoint slides, video players, canvas-drawn apps) |
| Change detection | Text hash for Accessibility text; 64-bit dHash per window for OCR (re-OCR only if Hamming distance ≥ 6 or 30 s have passed) |
| Privacy filter (before capture) | Blocked bundle ids (password managers, Keychain Access, banking apps, messaging apps by default), blocked hosts, private/incognito windows, Dumbledore itself, user exclusions, capture switch |
| OCR (fallback) | Vision `.accurate`, `en-US` (+ `sv-SE`), language correction off, auto-detect off (it misreads small grey labels). Window cropped, native resolution, Ă→Å post-correction. Lines sorted into reading order with alignment hints (left/centre/right) so the LLM can tell chat roles apart |
| Episode builder | Same app + window/URL → one episode; closes after an 8 s switch, idle, or 3 min (rolling checkpoint for long reads); merges scrolled text without duplicates |
| Boilerplate stripper | Lines seen in ≥80% of an app's frames (menus, nav bars) are dropped |
| Signals | Dwell, reading speed vs the student's baseline, re-reads, scroll-backs, revisits, search queries (from URLs), questions typed into AI chats |
| Prefilter (local, free) | Requires dwell ≥ 20 s (any length for AI chats) and ≥ 150 chars of clean text; scores app/domain hints, academic vocabulary density, known study sites (LMS, Wikipedia, docs, arXiv, PDFs) |
| Extraction queue | Batches up to 3 episodes per call; flushes every 2 min, immediately for AI-chat episodes during a session; daily budget guard |
| Retention | Episode text kept 48 h (configurable), then only the extracted learning items remain |

### 6.5 Brain (LLM layer)

> **Update 2026-10-24:** Gemini 3.5 is the primary provider for every tier, with a €10 total spend cap; see `DEFAULT_ROUTES` in `src/shared/llm.ts`.

- **Tiers:** `triage` (tiny yes/no), `extract` (JSON from screen text), `reason` (roadmaps, quizzes, exams, profile), `write` (prompts for the student's AI — latency-critical), `chat` (coach with tools).
- **Routing (v1):**

  | Tier | Primary | Fallbacks, in order |
  |---|---|---|
  | `triage`, `extract` | Apple on-device model (English content; input chunked to fit its 4K context) | OVHcloud `gpt-oss-20b` → Groq `openai/gpt-oss-20b` → optional Mistral / Cloudflare |
  | `reason` | Groq `openai/gpt-oss-120b` | Groq `qwen/qwen3.8-27b` → OVHcloud `gpt-oss-120b` → optional Mistral `mistral-small-2603` |
  | `write` | Groq `openai/gpt-oss-20b`, low reasoning effort | Groq `qwen/qwen3.8-27b` → OVHcloud `gpt-oss-20b` → the roadmap's draft prompt (no LLM) |
  | `chat` (tools) | Groq `openai/gpt-oss-120b` (tools without a schema) | OVHcloud `gpt-oss-120b` |

  Finnish content skips the Apple model, which doesn't support Finnish. Every request's size (input + max output) is checked against Groq's per-minute token bucket; anything bigger is split (exams in 5-question batches) or sent to OVHcloud.
- **Router:** ordered (provider, model) candidates per tier; skips providers in cooldown; token buckets per provider/model from known limits + live rate-limit headers; retry with backoff on 429/5xx/timeouts; per-task timeouts (`write`: 2.5 s, then fall back to the roadmap's draft prompt); daily budgets; every call logged (tokens, latency, outcome) for the Settings usage view.
- **Structured output:** every agent has a zod schema → JSON-schema mode where the provider supports it, otherwise JSON mode + validation + one repair call with the validation errors.
- **Cache:** identical prompt hash → cached 24 h.
- **Privacy:** redaction before any call (emails, phone numbers, long digit runs, card numbers via Luhn, key/password patterns); per-provider "may train on your data" flag shown in Settings; "local-only extraction" option if a local model is available (§3.3).
- **Agents:** extractor (P1) · roadmapper (P3) · step writer (P4) · quizmaster + verifier (P5) · examiner (P6) · gap fixer (P7) · prompt improver (P8) · suggester (P9) · coach (P10) · nudge writer (P11) · profiler (P12).

### 6.6 Learning engine

**Study session state machine**
```
idle ──chat detected──▶ available ──pick──▶ planning ──ok──▶ step(k) ──next──▶ step(k+1) | checkpoint(j)
checkpoint(j) ──submitted──▶ step(…) ── … ──last item──▶ complete ──▶ follow-up scheduled
any ──chat closed──▶ paused (resumable)    planning ──fail──▶ available (+ toast)    step ──ask bar──▶ step (modified)
```

**Roadmap & checkpoints**
- Items: `learn` (one idea, 3–8 min, objective, teaching move, prompt draft) and `checkpoint` (covered concepts, misconception probes).
- Number of checkpoints = max(1, ⌈learn steps ÷ 2.5⌉); the last item is always a checkpoint covering the whole roadmap.
- Questions per checkpoint = 3 + 1 per carried concept (max 5).
- **Carry-over:** a concept missed in a checkpoint enters the `carry` set and is re-tested with a *new* question in the next checkpoint (and in later reviews) until passed.
- **Just-in-time generation:** a checkpoint is generated while the student reads the step before it, using what the AI actually explained. A verifier call answers each question blind; any mismatch with the answer key is regenerated (max 2 tries) or dropped.

**Mastery & spaced repetition**
- Per concept `mastery ∈ [0,1]`: correct → m += (1 − m) × 0.3 × difficulty factor · wrong → m × 0.6 · "struggling" encounter → m × 0.9 + flag · reading alone never raises mastery much (+0.05 max).
- Status tags: New (< 0.2) · Learning (0.2–0.7) · Struggling (recent miss or struggle flag) · Mastered (≥ 0.85 and 2 spaced reviews passed).
- Leitner boxes with intervals 1 d · 3 d · 7 d · 16 d · 35 d; correct → next box, wrong → box 1. Deadlines pull reviews earlier (T−3 d, T−1 d).

**Nudge policy** — score = value (deadline proximity, struggle, due count, session momentum) × receptivity (natural break: returning from idle, app switch away from work, start of day, 30–60 min after a session; never while typing, in full-screen, in meeting apps or during quiet hours) − fatigue (recent nudges, dismissal rate). Hard caps (Goldfish is stricter still, at one contextual tip a day): at most 4 nudges a day, at least 60 min apart. Dedupe keys stop the same suggestion from repeating. Ignored nudges collapse into the orb's dot and expire after 1 h. Two optional daily anchors: a morning plan ("Today: 2 reviews due, midterm in 9 days → a 20-minute plan") and an evening wrap (what you learned, what's scheduled next).

### 6.7 Data model (SQLite via Drizzle, migrations versioned)

| Table | Key fields |
|---|---|
| `subjects` | id, name, emoji, colour, description, goal, deadline, status (active/suggested/archived), focus (normal/focus/muted) |
| `concepts` | id, subject_id, parent_id, name, summary, mastery, box, next_review_at, status, struggle_count, last_seen_at |
| `encounters` | id, subject_id, concept_id, episode_id, **seen**, **big_picture**, **topic_path** (json), **understanding** (understood/unclear/struggling/unknown), evidence, open_questions (json), key_terms, source app/url/title, dwell_s, created_at |
| `assignments` | id, subject_id, title, course, due_at, source, status |
| `episodes` | id, bundle_id, app, title, url, kind (reading/ai_chat/other), started_at, ended_at, dwell_s, text (48 h), signals (json), extracted |
| `roadmaps` / `roadmap_items` | roadmap: subject, title, goal, start_reason, status, version · item: idx, kind, title, objective, concept_ids, move, prompt_draft, prompt_sent, status, timestamps |
| `quizzes` / `questions` / `answers` | quiz: kind (checkpoint/exam/review/placement), scope, roadmap_item_id, score · question: concept_id, stem, options, correct_index, rationales, difficulty, carried_from · answer: chosen_index, correct, answered_at |
| `nudges` | kind, text, action, shown_at, outcome (accepted/dismissed/snoozed/expired) |
| `chat_messages` | thread, role, content, actions, created_at |
| `profile` | about_me, level, prompt language, prompt habits, summary |
| `search_fts` | SQLite FTS5 index over encounters, concepts and subjects (powers ⌘K search, like Goldfish's snapshot search) |
| `settings` · `llm_calls` · `events` | key/value (API keys encrypted with Electron `safeStorage`) · usage log · rotating debug log |

**The "memory file"** (`~/Library/Application Support/Dumbledore/memory/<subject>.md`), regenerated on change:
```markdown
# 🧪 Organic Chemistry
Goal: pass the midterm (2026-12-12) · Mastery 62% · Last studied 2026-10-24

## Concept map
- Nucleophilic substitution
  - SN1 — Learning (0.45) · review due 2026-10-26
  - SN2 — Mastered (0.90)
- Carbocation stability — Struggling (missed 2 of 3 in checkpoint 1)

## Encounters
### 2026-10-24 14:32 · Chrome · en.wikipedia.org/wiki/SN1_reaction · 6 min
- **Seen:** rate = k[R–X]; tertiary substrates favour SN1 because their carbocations are most stable.
- **Big picture:** Organic Chemistry › Nucleophilic substitution › SN1 vs SN2 — working out when each mechanism happens, for the midterm.
- **Understanding:** struggling — re-read the stability paragraph 3×; asked ChatGPT "why are tertiary carbocations more stable".
- **Open questions:** How does hyperconjugation stabilise a carbocation?
```

### 6.8 IPC and renderer data flow

- `shared/ipc.ts` defines every channel once: request/response channels with zod schemas and push events. Preload exposes `api.invoke(channel, payload)` and `api.on(event, cb)`, typed by the contract. Main validates every payload. The preload has no dependencies, because Electron 45's sandboxed preloads lost the Node built-ins. We use no third-party IPC library (electron-trpc is stale).
- Renderer: TanStack Query over `api.invoke`; push events invalidate queries (for example `memory.changed` → refresh Inbox). Local UI state uses React state or a tiny Zustand store.
- One React codebase with one entry per surface (`overlay`, `panel`, `askbar`, `app`), all sharing the design system.

### 6.9 Security & privacy

- Electron hardening: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, no remote content, Electron fuses (no RunAsNode etc.), IPC allow-list with validation.
- Helper: allow-listed commands only; refuses to read field values unless triggered by the user; never stores images. Its socket lives in the app's private folder with owner-only permissions, and the helper checks the peer's code signature, so no other process on the Mac can ask it for screen text.
- Data: everything local in `~/Library/Application Support/Dumbledore`; export and "Delete everything" in Settings; retention controls; Inbox items can be forgotten one by one.
- A **test-control channel** (for automated E2E) exists only in dev builds behind an env flag, bound to localhost with a random token.

### 6.10 Performance budgets (validated in Wave 0, enforced in WP9)

Measured baseline (Electron spike, trivial page): orb + panel = 89 MB physical footprint. Targets with the real UI: **idle (orb + panel) ≤ 130 MB Electron + ≤ 40 MB helper = ≤ 170 MB total** (Goldfish on this Mac: ~640 MB) · full app open ≤ 320 MB, back to idle after closing · helper OCR peak ~260 MB for under a second (OCR is the rare fallback) · average CPU ≤ 3% while actively capturing, ≤ 0.5% idle · OCR ≤ 450 ms per window · right-⌥ → paste ≤ 300 ms (draft) / ≤ 1.5 s (refined) · roadmap ≤ 8 s · checkpoint ready instantly (prefetched) · 10-question exam ≤ 15 s.

---

## 7. Prompts

Full drafts are in **Appendix A**. Design rules shared by all prompts:
- Inputs in tagged sections (`<student>`, `<subjects>`, `<episode>`, …) so small models don't mix them up.
- Outputs are JSON validated by zod; 1–2 short few-shot examples for the small extraction model.
- Temperatures: extraction 0.1 · quizzes 0.3 · prompts 0.5 · coach chat 0.6.
- Every prompt written *for the student's AI* follows the same **student-prompt rules:** first person · one line of the student's context (level, what they know, what confuses them) · asks for exactly what the step needs in a numbered structure · brevity rule ("No greetings or small talk. Short structured bullets, max ~150 words, bold key terms.") · an active-learning hook when it fits ("Then ask me one question to check I got it, and wait.") · never mentions Dumbledore · the student's language · ≤ 110 words.

---

## 8. Build plan — parallel waves

The work runs in waves. Inside each wave, independent pieces run at the same time as separate subagents, each in its own git worktree with folders it alone owns. I write the shared contracts first, integrate every lane, and keep `PROGRESS.md` current. The work packages (WP0–WP10) further down hold the detailed tasks and "done when" criteria; the schedule below says what runs in parallel.

### 8.0 Schedule

**Wave 0 — Foundation (short)**
- Me: repo scaffold; frozen v1 contracts (shared types, IPC, helper protocol, DB schema, prompt I/O schemas); fake helper and fake LLM; test harness; docs.
- At the same time, three spike agents: overlay & focus (Electron) · helper (Accessibility vs OCR, writing into fields, right-⌥ polling) · LLMs (Groq/OVHcloud JSON reliability, Apple on-device availability).
- You: the Groq key, when convenient. The keyless OVHcloud fallback covers development until then.

**Wave 1 — six lanes at once**

| Lane | Owns | Builds | Tests against |
|---|---|---|---|
| L1 Helper (Swift) | `native/` | WP3: everything in §6.3, incl. the on-device model bridge | fixture screenshots, real apps |
| L2 Engine core + brain | `src/engine/store`, `src/engine/brain` | WP1 + all prompts P1–P12 + eval harness | fake LLM; live evals |
| L3 Perception | `src/engine/perception`, `src/engine/privacy` | WP4 logic: cadence, episodes, stripper, signals, prefilter, redaction, extraction queue | recorded frame fixtures + fake helper |
| L4 Learning | `src/engine/learning`, `src/engine/scheduler` | WP6 + WP8 logic: session state machine, roadmap, checkpoints, carry-over, mastery, spaced reviews, nudge policy | fake clock + fake brain |
| L5 App UI | `src/renderer/design-system`, `pages`, `surfaces/app`, `surfaces/panel` | WP2 + WP7 UI: tokens, components, every page with demo data, ⌘K | Playwright screenshots, light/dark |
| L6 Shell + overlay | `src/main`, `src/preload`, `surfaces/overlay`, `surfaces/askbar` | WP5: windows, tray, IPC, orb, side stack, pill, chip, toasts, quiz card, Ask bar, docking, focus hand-back, shortcut routing (§5.6) | fake helper events + focus suite |

**Wave 2 — three integration tracks at once**

| Track | Joins | Done when |
|---|---|---|
| I1 Perception → memory | L1 + L3 + L2 | Live screen → Inbox; extraction eval passes on real captures (S1) |
| I2 Study session | L1 + L2 + L4 + L6 | F2–F5 work end to end on the mock chat page and real ChatGPT (S2–S4) |
| I3 App + follow-ups | L2 + L4 + L5 | All pages on real data; exams; reviews and nudges; onboarding (S5–S6) |

**Wave 3 — harden, four streams at once:** packaging & signing · performance & 8-hour soak · security & privacy review · UI polish pass (WP9).

**Wave 4 — dogfood loop (WP10):** I drive the real-world scenarios on this Mac. They share one screen, so they run one at a time. Reviewer agents triage what I find, and fixer agents take independent issues in parallel worktrees.

**Critical path:** contracts → L1 helper + L6 shell → I2 study session → dogfood. Everything else runs alongside it.

Sizes: S ≈ a focused session · M ≈ a few sessions · L ≈ many sessions. Every lane, track and stream ends with the quality gate in §10.2.

### Work packages

#### WP0 — Kick-off & risk spikes (S) · Wave 0
- Project folder + git; electron-vite + React + strict TypeScript + Biome + Vitest + Playwright; docs skeleton; helper skeleton (`ping`) built and bundled.
- During development the helper runs as a child of my shell and inherits this Claude app's existing Screen Recording and Accessibility grants, so nothing blocks on you. The packaged app ships the helper as `Dumbledore Helper.app` and asks for its own grants once (WP9).
- Spikes, each recorded in `DECISIONS.md`:
  - (a) Overlay: one transparent full-screen click-through panel per display (Goldfish's approach) vs small moving windows. Must never steal focus over Chrome, ChatGPT or full-screen apps, and must be hidden from screen sharing.
  - (b) Accessibility text vs OCR: coverage and timings on real windows (Wikipedia, a PDF, slides, ChatGPT, Google Docs).
  - (c) Focused element + frame in ChatGPT web (Chrome, Safari), the ChatGPT app and the Claude app.
  - (d) Writing into each field: Accessibility insert vs ⌘V, verified, clipboard restored.
  - (e) Right-⌥ via modifier polling: tap/hold/double-tap with the Finnish layout, and coexistence with Goldfish.
  - (f) LLMs: is the Apple on-device model available on this Mac (Apple Intelligence on; guided generation compiles with Command Line Tools)? JSON-schema reliability and latency of Groq and OVHcloud per model.
  - (g) Typing into Dumbledore's panels: activate → type → hand focus back to the exact chat field. Verified with `lsappinfo front` and the focused element; native Ask-bar fallback if flaky.
- **Done when:** every spike has a chosen approach (or the documented fallback), and the empty app runs as an agent app with tray + orb.

#### WP1 — Engine core (M) · lane L2
- Shared types and schemas, event bus, settings, SQLite schema + migrations + repositories, LLM layer (§6.5), redaction, fake LLM + fixtures, typed IPC contract + preload.
- **Done when:** unit coverage ≥ 90% on engine core; a live smoke test hits each configured provider.

#### WP2 — Design system & UI shell (M) · lane L5
- `tokens.css`, all components (§5.5), layouts for overlay, panel, ask bar and app, every page with seeded demo data, ⌘K palette, light/dark.
- **Done when:** Playwright screenshots of every page in both themes are reviewed against the Notion reference and DESIGN.md; a fresh UI-critique agent signs off; no contrast failures.

#### WP3 — Native helper (M) · lane L1 (Swift)
- All of §6.3: capture, change detection, OCR with reading order, window/app info, browser URL (AX first, AppleScript fallback), focus tracking + AX observers + Chrome/Electron accessibility switch, chat-input finder, paste/click/keys with layout-correct key codes, clipboard save/restore, right-⌥ classifier, idle/lock/display events, permission status/request. Plus the TypeScript client and a **fake helper** that replays fixtures.
- **Done when:** integration tests pass (OCR ≥ 97% character accuracy on fixture screenshots, latency within budget); manual check in Chrome, Safari, ChatGPT and Claude.

#### WP4 — Perception → memory (M) · lane L3, then track I1
- Cadence, privacy filter, episodes, boilerplate stripper, signals, prefilter, extraction queue + batching, extractor (P1), subject/concept linking + suggested subjects, assignments, Markdown memory mirror, Inbox data.
- **Done when:** on 30 labelled recorded episodes, "is learning" precision ≥ 0.85 and recall ≥ 0.80; a 1-hour live run produces sensible Inbox items within free-tier budgets.

#### WP5 — Floating presence (M) · lane L6, then track I2
- Orb (states, drag, snap, per-display home, full-screen visibility, hide/show), side stack, Study pill, suggestion chip, toasts, quiz card shell, Ask bar, mini panel (+ focus hand-back), tray menu, AI-chat detector, docking with animation, right-⌥ routing (F4).
- **Done when:** docking ≤ 300 ms in Chrome, Safari and the ChatGPT app; a typing test proves the orb never steals focus; right-⌥ never fires on ⌥-combinations.

#### WP6 — Study sessions (L) · lanes L2 + L4, then track I2 · the heart of the product
- Picker, context assembly, roadmapper (resume + cold start with placement check), session state machine, step writer (draft → just-in-time refine → timeout fallback), paste with verification + fallback toast ("Copied — press ⌘V"), Next + shortcut, live chat extraction between steps, checkpoints (prefetch, verifier, quiz card, scoring, carry-over), "Fix my gaps", prompt improver, coach tips, session persistence.
- **Done when:** scenarios S2–S4 pass on the mock chat page and on real ChatGPT; roadmap and quiz evals meet thresholds (§9.2).

#### WP7 — Full app (M) · lane L5, then track I3
- Wire every page to real data: Home, Subjects, Subject page (4 views), Inbox (accept/merge/ignore), Exams (2-click create, take, results, gaps → explore prompts), Chat with tools, Settings (all sections), About you, Onboarding.
- **Done when:** S5 passes; every page has empty, loading and error states; screenshot review approved.

#### WP8 — Follow-ups & coaching intelligence (M) · lane L4, then track I3
- Mastery updates, Leitner scheduler, natural-break detector, nudge policy with fatigue learning, review exams, learner profile, next-topic suggestions, prompt-habit insights, deadline ramp-up.
- **Done when:** S6 passes with a simulated clock; nudge policy unit-tested (never while typing or full-screen; caps hold).

#### WP9 — Package & harden (S/M) · Wave 3
- electron-builder app (agent app, icon, helper app embedded under `Contents/Helpers`, local signing, better-sqlite3 unpacked and re-signed), launch at login, helper auto-restart, local crash/error log, export/delete data, Electron security checklist, performance tuning to budgets, 8-hour soak test for leaks.
- **Done when:** `Dumbledore.app` installs to /Applications, keeps its permissions across reboots and rebuilds, and meets §6.10 in a 1-hour benchmark.

#### WP10 — Dogfood & iterate (L, loop) · Wave 4
- Run S1–S9 on this Mac with real Chrome + ChatGPT, Safari and the ChatGPT app. Log issues by severity, fix, re-run, tune prompts against the eval sets, do UI polish passes. Finish with a report with screenshots.
- **Done when:** the Definition of Done (§9.4) is met and one full round has zero P0/P1 issues.

**Parallelism recap:** see §8.0. At peak, six builder agents run at once in Wave 1, then three integration tracks in Wave 2.

---

## 9. Testing & QA

### 9.1 Test pyramid

| Level | Tool | What |
|---|---|---|
| Unit | Vitest | text cleaning, episodes, prefilter, redaction, router/fallback/rate limits (fake providers), schema validation, prompt builders (snapshot), session state machine, carry-over, mastery, scheduler (fake clock), nudge policy, multi-display coordinate maths, right-⌥ classifier (synthetic event sequences), repositories (in-memory SQLite) |
| Component | Vitest + Testing Library | design-system components, quiz card, roadmap item, picker |
| Helper integration | Vitest spawning the real helper | OCR accuracy/latency on fixture screenshots, RPC robustness (malformed input, restart), permission reporting |
| E2E-sim | Playwright `_electron` + fake helper | every UI flow, IPC, study session logic, screenshots in light/dark (visual regression baselines) |
| E2E-real | Packaged app launched with `open` + dev test-control channel | real capture/OCR/AX/paste on this Mac, against the mock chat page and real ChatGPT. Focus is checked with `lsappinfo front` and the focused element before and after every action, because Playwright clicks can't reveal focus stealing |
| Evals | `tools/eval-prompts.ts` against the real free providers | extraction, roadmaps, quizzes, step prompts, improver (§9.2) |
| Performance | `tools/bench.ts` | RAM per process, CPU over 30 min, OCR latency, LLM latency, paste latency |

### 9.2 LLM evaluation sets (results saved in `docs/evals/`)
- **Extraction:** 30 labelled episodes (20 learning incl. AI chats, PDFs, slides, docs; 10 not learning) → precision ≥ 0.85, recall ≥ 0.80, three parts always filled, "struggling" only with evidence.
- **Roadmaps:** 8 scenarios (cold start, resume, struggling prerequisite, big course, tiny question, Finnish content, deadline tomorrow, mastered basics) → rubric: correct start point, ≥ 1 checkpoint and correct spacing, carry concepts placed, steps sized 3–8 min, prompt drafts follow the student-prompt rules.
- **Quizzes:** 50 generated questions → ≥ 95% agree with the blind verifier; no "all of the above"; distractors are real misconceptions (spot-checked by me).
- **Step prompts & improver:** 30 cases → ≤ 110 words, brevity rule present, no greetings, context line present, intent preserved (judged by me against a checklist).

### 9.3 Real-world scenarios on this Mac
- **S1 Passive capture:** read a Wikipedia article and a lecture PDF for 3 min each → Inbox shows correct three-part items; a subject is suggested.
- **S2 Study session:** open ChatGPT → Study pill → pick subject → roadmap → step 1 pasted → Next ×2 → checkpoint with one wrong answer → miss carried into checkpoint 2 → roadmap complete.
- **S3 Docking & improver:** type "what is osmosis" into ChatGPT → orb docks → right-⌥ → improved prompt replaces the text → ⌘Z restores it.
- **S4 Ask bar cold start:** hold right-⌥ → "I don't get the Calvin cycle" → roadmap from scratch with placement offer → first prompt pasted.
- **S5 Exams:** 10-question weak-spots exam from the app → take → results → gaps → "Explore with ChatGPT" pastes a repair prompt.
- **S6 Follow-up:** simulated next day → review nudge at a natural break → review → mastery and schedule update.
- **S7 Privacy:** password manager, a banking site and an incognito window are never captured; the pause switch stops capture immediately.
- **S8 Endurance:** 1-hour normal use → RAM/CPU within budget; 8-hour soak → no growth.
- **S9 Coverage:** Safari, the ChatGPT app, Claude (web + app), Gemini, Perplexity, a second display, full-screen ChatGPT.

### 9.4 Definition of Done (v1)
1. Install + onboarding in < 3 min; permissions survive restarts and rebuilds.
2. Orb never steals focus (typing test), docks in ≤ 300 ms, shows over full-screen apps, drags/snaps and remembers its place.
3. Right-⌥ tap/hold works in Chrome, Safari, the ChatGPT app and the Claude app; zero false triggers on ⌥-combinations (Finnish layout).
4. Paste lands in ChatGPT (Chrome, Safari, app), Claude, Gemini and Perplexity in ≥ 19 of 20 attempts each; the clipboard is restored.
5. Capture is always on with a working switch; blocked apps are never OCR'd; budgets in §6.10 hold.
6. Extraction eval meets §9.2; every record has all three parts.
7. S2 runs end-to-end on real ChatGPT; carry-over verified; ≥ 95% of quiz answer keys verified.
8. Exams: created in ≤ 2 clicks, generated in ≤ 15 s, results show gaps with explore prompts.
9. Follow-ups: reviews scheduled and nudged only at natural breaks; caps hold.
10. Full app: all pages in light and dark with empty/loading/error states; passes the UI review against Notion.
11. A heavy study day stays inside the free tiers (usage view shows the headroom).
12. Typecheck, lint, unit, integration and E2E-sim green; E2E-real scenarios S1–S9 pass.

---

## 10. Working method

### 10.1 Keeping it structured over a long build
- **Parallel by default:** anything that doesn't depend on unfinished work runs at the same time (§8.0).
- **Git from the first minute**, one small commit per task (local only — nothing is pushed unless you ask).
- **Living docs:** `PROGRESS.md` is the single source of truth for status (phase checklist + issue list with severity). `DECISIONS.md` records each choice and its reason. `ARCHITECTURE.md` and `DESIGN.md` stay current. These survive context resets, so the build never loses its thread.
- **Interface-first:** shared types, the IPC contract, the helper protocol, the DB schema and the prompt I/O schemas are written before parallel work starts.

### 10.2 Quality gate at the end of every phase
Typecheck · Biome lint/format · unit + integration tests · E2E where relevant · a fresh-eyes code review (subagent, `/code-review`) · UI screenshots reviewed when UI changed · docs updated · commit.

### 10.3 Subagent plan
| Role | When | How |
|---|---|---|
| Parallel builders | Wave 0 spikes, Wave 1 lanes L1–L6, Wave 2 tracks I1–I3, Wave 3 streams, Wave 4 fixers | Precise brief + folders only they own + acceptance tests; separate git worktrees; I integrate and review every diff |
| Fresh-eyes reviewers | End of every lane, track and wave | Get the code, not my conclusions; report bugs ranked by severity |
| UI critic | After L5, L6 and I3, and during Wave 4 | Gets screenshots + DESIGN.md + the Notion reference; reports concrete deviations |
| Research/spike agents | As needed | Narrow questions (e.g. one AX quirk) |

### 10.4 The iteration loop (Wave 4, and in small form inside every lane)
Build → automated tests → use it for real → critique (me + reviewer agents) → fix the highest-severity issue → re-run the affected tests and scenarios → repeat until the exit criteria hold.

### 10.5 Keeping you in the loop
Milestone updates with screenshots. I ping you only when I need you: permission clicks, API keys, real-ChatGPT tests.

---

## 11. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| macOS permission friction; grants reset on rebuild | No capture/paste | Permissions live on the helper app, signed with a stable local certificate and launched via `open`; onboarding with live status + deep links |
| Electron RAM vs "minimal" | Heavier than a native app | Measured 74–89 MB for orb + panel (Goldfish: ~640 MB). One shared renderer for overlay + panel, app window destroyed on close, heavy lifting in the helper |
| Overlay steals focus | Paste fails, typing interrupted | Verified not to (14 of 14 runs); focus suite in E2E-real; **F-ORB fallback:** native orb in the helper |
| Typing into our own panels activates Dumbledore (Electron issue #52915) | Focus must be handed back before pasting | Verified hand-back; native Ask bar in the helper as the fallback; adopt Electron's `activable:false` once it ships |
| Electron 45 is days old; software-posted clicks activate panels on macOS 26.6+/27 (#53889) | Regressions after OS/Electron updates | Pin exact versions (44.9.3 as the fallback); the helper never posts clicks onto our own windows; re-run the focus suite after every OS update |
| Chrome web accessibility slow/unavailable | Can't find the chat box | Enable Chrome's accessibility only for AI-chat tabs; OCR-placeholder fallback; click-to-focus fallback |
| Paste blocked (secure input, keyboard layout, rich editors) | Prompt not inserted | Per-app method (Accessibility insert, or ⌘V with a layout-aware key code), verified after writing; "Copied — press ⌘V" toast as the last resort |
| Right-⌥ conflicts (Goldfish uses right ⌥ on this Mac; ⌥ also types characters) | Two apps fire on one tap; false triggers | Clean-tap classifier; remappable key + fallback chord; conflict detection at onboarding; for this Mac see §12.1 item 5 |
| Free LLM limits change / outages (Groq preview models vanish; 8K tokens/min cap) | Features degrade | Multi-provider router with model IDs in config, budgets, request splitting, prefilter, caching, keyless OVHcloud fallback |
| Apple Intelligence off on this Mac, or content in Finnish | Extraction can't run on-device | Router falls back automatically to OVHcloud/Groq; Finnish goes to cloud models by design |
| Screen text sent to a cloud LLM | Trust, privacy | Blocklists, redaction, retention limits, provider choice, local option, a transparent privacy page |
| Weak roadmaps/quizzes from cheap models | Trust | Schema validation, blind verifier, eval sets, "flag this question", stronger tier for reasoning |
| Over-nudging | Annoyance | Caps, receptivity, fatigue learning, quiet hours |
| OCR quality on tiny text / non-English | Worse extraction | `.accurate` mode, 2× capture for small text, language hints |
| macOS 26 API changes | Breakage | Spikes first; capture fallbacks |
| "Dumbledore" is a trademarked character name | Launch risk | Fine as a working title; check before any public release |

---

## 12. What I need from you, assumptions, out of scope

### 12.1 At approval
1. **Folder for the project.** Suggestion: `~/workshop/dumbledore`. This session currently lives in a temporary folder that is deleted with the session.
2. **One free Groq API key** (console.groq.com → API Keys; no card needed). Optionally a Mistral key as an extra EU fallback (turn off "Anonymous improvement data"). You create the accounts (I can't), then put the keys in `~/workshop/dumbledore/.env.local` (I'll create the template) or paste them into the app's Settings later. Please don't paste keys into this chat. Also, if you're happy to, switch on Apple Intelligence (System Settings → Apple Intelligence & Siri). That lets screen extraction run on the Mac for free; without it the router uses the cloud fallbacks.
3. **A one-time "Allow" later, not now.** During development the helper runs under this Claude app's existing permissions, so I can build and test without you. When the packaged app is ready, you grant Accessibility (and optionally Screen Recording) once. A local signing certificate (2 min, steps provided) keeps that grant across updates; it's optional.
4. **OK to use your logged-in ChatGPT in Chrome for testing.** Dumbledore pastes prompts; I'll send a handful of test prompts during Phases 6 and 10.
5. **Right ⌥ is already Goldfish's key on this Mac**, so both apps would react to the same tap. Options:
   - Remap Goldfish's key in its settings (it accepts any modifier or fn). My recommendation, since your brief wants right ⌥ for Dumbledore.
   - Give Dumbledore another key on this Mac.
   - Quit Goldfish while testing.
   - **Decided 2026-10-24:** Dumbledore takes right ⌥. Ilari switches Goldfish's key off in Goldfish's own settings.

### 12.2 Assumptions
macOS 15+ (developed and tested on 26.4.1, Apple Silicon) · English UI; prompts follow the language of the content (Finnish works) · single user, all data local, no accounts or backend · local self-signed build for now (public notarized distribution later) · "Dumbledore" is a working title.

### 12.3 Out of scope for v1
Windows/Linux/mobile · cloud sync · voice input · a key proxy/backend (needed before a public release, so students don't need their own keys) · direct LMS/Calendar integrations (v1 learns deadlines from the screen) · notarized public distribution · auto-sending prompts (setting exists, off) · teacher/parent dashboards · short-answer grading (MCQ only in v1).

---

## Appendix A — Prompt drafts

Variables are in `{braces}`. Final versions live in `src/engine/brain/prompts/` with typed inputs, a zod output schema, tier, temperature and eval fixtures.

### P1 — Extractor (tier `extract`, JSON)

**System**
> You are the perception module of Dumbledore, a study coach running on a student's Mac. You receive text OCR'd from the student's screen during one or more *episodes* (a continuous stretch in one app or page), plus behaviour signals. Decide whether the student was trying to learn or understand something. If so, record it so precisely that a tutor could pick up exactly where the student is.
>
> **Learning:** course material, textbooks, lecture slides/notes, papers, documentation or tutorials being studied, explanations in AI chats, practice problems, flashcards, educational videos (captions/slides), assignments, exam or deadline information.
> **Not learning:** social media, news, shopping, entertainment, messaging small talk, settings screens, routine work with no new concept being learned, UI noise (menus, buttons, ads, cookie banners). When unsure, return `is_learning: false`. Never invent anything the text does not support.
>
> For each learning item fill three parts:
> 1. **seen** — the actual thing on screen: the specific claim, definition, formula or example as shown (paraphrase ≤ 60 words; keep key terms and symbols).
> 2. **big_picture** — what the student was most likely trying to understand and why: a topic path from broad to specific (2–4 levels) plus one sentence of purpose.
> 3. **understanding** — `understood | unclear | struggling | unknown`, with evidence from the signals (slow reading, re-reads, scrolling back, repeated searches, asking an AI to "explain / simpler / I don't get", wrong answers). Without evidence use `unknown`; never guess `struggling`.
>
> Also give up to 3 `open_questions` the student probably still has (phrased as the student would ask), `key_terms`, and any assignment or deadline (title, course, ISO date). Match an existing subject when it fits (use its id); propose a new subject only for a genuinely new area of study. For AI-chat episodes: right-aligned blocks are usually the student's messages; a repeated or rephrased question is evidence of confusion; what the AI explained counts as *seen*. Return JSON only.

**User**
```
<student>{about_me} · language: {lang}</student>
<subjects>[{"id":"s1","name":"Organic Chemistry","top_concepts":["SN2","nucleophiles"]}]</subjects>
<episode id="e1" app="Google Chrome" url="https://en.wikipedia.org/wiki/SN1_reaction" title="SN1 reaction - Wikipedia" dwell="6m52s">
<signals>reading=slow (84 wpm vs 210 usual) · scrolled_back=3 · revisits_today=2 · searches=["sn1 vs sn2 difference"] · ai_questions=["why are tertiary carbocations more stable"]</signals>
<text>
[L] The SN1 reaction is a substitution reaction in organic chemistry …
[L] Rate = k[R–X] …
</text>
</episode>
```
**Output schema:** `{ is_learning, confidence, reason, items: [{ subject: {match_id | new_name}, topic_path[], seen, big_picture, understanding: {status, evidence}, open_questions[], key_terms[], assignment? }] }`

### P3 — Roadmapper (tier `reason`, JSON)

**System**
> You are Dumbledore's curriculum designer. Build the shortest path that takes this student from where they are now to genuinely understanding the goal. The teaching happens through their own AI assistant ({assistant}); short quizzes prove understanding along the way.
>
> 1. **Map the territory.** List the concepts needed for the goal, from prerequisites to core ideas to applications. Size to the goal: a narrow question 3–5 learn steps; a chapter 6–10; a whole course 10–15 (if bigger, cover the first milestone and name the next one).
> 2. **Find the starting point.** Skip concepts with solid evidence of mastery (passed checkpoints or exams). Start at the earliest prerequisite that is unmastered or shows struggle. Explain the choice in one sentence ("You already handle X; you stumbled on Y twice, so we start there."). With no evidence at all, start from the essentials and set `offer_placement: true`.
> 3. **Learn steps.** One idea per step, 3–8 minutes each, ordered so each step needs only earlier ones. Each has an observable objective ("can explain why…", "can solve…") and a teaching move: intuition/analogy, definition, worked example, contrast with a confusable idea, apply to a new case, explain-back, connect to the big picture. Vary the moves and include at least one explain-back or predict-first step.
> 4. **Checkpoints.** After every 2–3 learn steps and always at the end (at least one in total). Each lists the concepts it tests and the misconception each question should probe. Concepts the student got wrong before (`<carry>`) must be re-tested at the first checkpoint after their step.
> 5. **Prompt drafts.** For every learn step write `prompt_draft`, the message the student will paste into {assistant}, following the student-prompt rules (§7).
> Return JSON only.

**User:** goal / subject · deadline · time available · student profile · mastery table (concept → status + evidence) · newest 20 encounters (seen / big picture / understanding) · open questions · previous roadmaps (done steps) · `<carry>` concepts.
**Output schema:** `{ title, goal, start_reason, offer_placement, estimated_minutes, items: [ {kind:"learn", id, title, objective, concepts[], move, prompt_draft} | {kind:"checkpoint", id, covers[], probes:[{concept, misconception}], n_questions} ], next_milestone? }`

### P4 — Step writer (tier `write`, JSON, ≤ 2.5 s or fall back to the draft)

**System**
> Write the exact message the student will paste into {assistant} for the current roadmap step. Start from the draft and adapt it to what just happened in the chat.
> - Follow the student-prompt rules (§7).
> - If the student asked follow-ups or seemed confused in the last exchange, address that first in one clause ("I still don't get why…").
> - If a concept was missed in a checkpoint, target the misconception directly ("I thought X — explain why that's wrong.").
> - Don't repeat what the chat already covered; build on it ("You explained A; now…").
> - Plain text with line breaks; no markdown headings.
> Also return `coach_tip` — one sentence (≤ 20 words) that teaches the student the prompting technique this prompt uses — and `memory_updates`: facts worth remembering from the chat excerpt (this is your tool for writing to the student's memory file).

**User:** step (title, objective, move, draft) · last chat excerpt (OCR, ~1,500 chars, roles inferred) · recent misses · profile · language.
**Output schema:** `{ prompt, coach_tip, memory_updates: [{ type: "understanding" | "note" | "question", concept, value, evidence }] }`

### P5 — Checkpoint quizmaster (tier `reason`) + blind verifier (tier `extract`)

**System**
> Write {n} multiple-choice questions that prove the student understood {concepts} — not that they memorised wording. Ground every question in what the student actually studied (chat excerpts below); don't test details they never saw. Mix types: a conceptual "why", an apply-to-a-new-case or predict, and a contrast or spot-the-error; add more as needed. Re-test carried concepts ({carry}) with a fresh scenario and never reuse an old question.
> Each question: stem ≤ 35 words · 4 options · exactly one correct · distractors are misconceptions a real learner would hold (no jokes, no "all of the above") · a rationale per option ≤ 25 words · difficulty 1–3 (aim for 2: challenging but fair) · concept tag. Silently solve each question before finalising; if two options could be argued correct, rewrite it. Return JSON only.

**Verifier:** "Answer each question. Return the option index you believe is correct and your confidence (0–1)." A mismatch with the key → regenerate that question (max 2 tries) or drop it.

### P6 — Exam builder (tier `reason`)
Same rules as P5, plus scope selection (weak spots / due / everything), 5–20 questions, interleaving across subjects, difficulty ramp, and at least one transfer question per concept.

### P7 — Gap fixer (tier `write`)
> The student missed these questions (stem, their choice, correct answer, rationale). For each, diagnose the misconception in ≤ 12 words. Then write ONE prompt for {assistant} (student-prompt rules, ≤ 110 words) that repairs all of them: contrast the wrong idea with the right one, ask for one concrete example each, and end with "Then quiz me with 2 new questions and wait for my answers." Also suggest one next topic that builds on what they now know.

### P8 — Prompt improver (tier `write`)
> The student typed this into {assistant}: «{draft}». Turn it into a prompt that makes them learn, not just get an answer — without changing what they want. Add one line of their context (from the profile), the structure they need, the brevity rule and — if they are learning a concept — an active-learning hook. If they clearly want a quick fact or a task done, keep it short and only add context and format. ≤ 110 words, first person, their language. Return `{prompt, coach_tip: "What I improved: …" (≤ 20 words)}`.

### P9 — Suggester (tier `write`)
Picks and writes the single best prompt for an empty chat box from ranked candidates: next session step › open question from the current page › struggling concept › due review › deadline-driven topic › starter ("Help me plan how to learn ___").

### P10 — Coach (tier `chat`, tools)
> You are Dumbledore: a calm, warm, wise learning coach who lives on the student's Mac. Speak briefly (≤ 80 words unless asked), plainly, always with a concrete next step. Never do the student's assignments for them; help them learn by using AI tools well. You know the learner profile, subjects with mastery and deadlines, due reviews, the active session and what they've looked at recently (below).
> - "What should I focus on?" → rank by deadline proximity, then struggling concepts, then due reviews, then momentum; give the top 1–3 with a one-line reason each and offer the action.
> - When they want to understand or learn something — even something you have no record of — call `start_roadmap` first.
> - Act through tools: `start_roadmap(subject_or_goal, goal?)`, `create_exam(scope, n, focus)`, `insert_prompt(text)`, `set_focus(subject)`, `remember(fact)`, `schedule_review(concept, when)`.
> - Never invent progress data. If you don't know, say so.

### P11 — Nudge writer (tier `triage`)
≤ 14 words, specific, one call to action, friendly, no guilt. Example: "3-minute check on carbocations? You missed two yesterday."

### P12 — Profiler (tier `reason`, daily)
Learner profile ≤ 200 words from About you, subjects, mastery, encounters and prompt habits: level, goals and deadlines, strengths, recurring struggles, how they use AI (gives context? asks to be quizzed? asks for examples?), and the 2 habits most worth coaching next.
