# Dumbledore

A study coach that lives on your Mac. It notices what you're learning on screen, writes the
prompts for your AI chat (ChatGPT, Claude, Gemini, …), outlines what to read on a page, and
quizzes you so it sticks. Your data stays on your Mac; only the text a question needs goes to
the AI provider, with emails, numbers and passwords masked.

Electron + React + TypeScript, with a small Swift helper (`native/helper`) for Accessibility,
screen text (OCR, PDFs) and the right-⌥ key. Product plan: `docs/PLAN.md`. Working rules for
people and agents: `AGENTS.md` (claim work on `WORKBOARD.md` before you start).

## Requirements

- macOS 15 or later, Apple Silicon
- Xcode Command Line Tools (`xcode-select --install`); full Xcode is not needed
- Node.js 22.12 or later, npm 11

## Set up

```bash
npm ci
```

AI: Dumbledore uses Gemini first (a free keyless service is the slow fallback). Add a key in
the app under **Settings → AI providers** (stored in the macOS Keychain), or for development copy
`.env.example` to `.env.local` and fill in `GEMINI_API_KEY` (or point `DUMBLEDORE_ENV_FILES` at
an existing env file). The installed app reads `.env.local` from its data folder,
`~/Library/Application Support/Dumbledore/`.

## Run

| What | Command |
|---|---|
| Develop (helper from this terminal, app with hot reload) | `bash native/helper/build.sh` once, then `npm run dev` |
| Build, sign and install `Dumbledore.app` in /Applications | `npm run install-app` |
| Just package, unsigned (`release/mac-arm64/Dumbledore.app`) | `npm run package` |
| Use a separate data folder (testing) | `DUMBLEDORE_DATA_DIR=/tmp/dd-test npm run dev` |

On first launch, onboarding asks for **Accessibility** (required) and **Screen Recording** (for
PDFs, slides and video). macOS keeps these grants only while the app's signature stays the same,
so `npm run install-app` signs every build with this Mac's own **Dumbledore Dev** identity
(`tools/dev-identity.sh` makes it on first use, in its own keychain at `~/.dumbledore-dev`; the
login keychain is left alone). Grant once and rebuilds keep it. A switch left from an older build
looks on but doesn't apply: onboarding and Settings → Capture then offer **Already on? Reset and
ask again**. `SIGN_IDENTITY` overrides the identity (`-` = ad hoc, tied to one build).

The right ⌥ key is Dumbledore's key, with one job per gesture:
- **Tap: the prompt.** In your AI chat: the next step, your prompt rewritten, or the best next
  question. With text selected: Explain / Add to a roadmap / Quiz me. A tap never starts a roadmap.
- **Hold: mark what to read** on an article, a PDF or the AI's answer, for your goal and gaps.
  Hold again to clear.
- **Double-tap: talk to Dumbledore.** Ask anything or plan your studying; what you tell it is
  saved to your subject (each save shows in the chat, with Undo).

## Test

```bash
npm run typecheck
npm run lint
npm test          # unit + engine + helper integration
npm run test:e2e  # screenshots of every screen (tests/e2e-sim/__screenshots__)
```

`npm run eval` scores the prompts against a real AI provider (needs a key; see `docs/evals`).
