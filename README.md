# Dumbledore

A study coach that lives on your Mac. It notices what you're learning on screen, writes the
prompts for your AI chat (ChatGPT, Claude, Gemini, …), outlines what to read on a page, and
quizzes you so it sticks. Everything stays on your Mac.

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
| Just package (`release/mac-arm64/Dumbledore.app`) | `npm run package` |
| Use a separate data folder (testing) | `DUMBLEDORE_DATA_DIR=/tmp/dd-test npm run dev` |

On first launch, onboarding asks for **Accessibility** (required) and **Screen Recording** (for
PDFs, slides and video). The right ⌥ key is Dumbledore's key: tap in an AI chat for the next
study prompt, tap on an article or PDF to outline what to read, hold to write a prompt,
double-tap to chat.

## Test

```bash
npm run typecheck
npm run lint
npm test          # unit + engine + helper integration
npm run test:e2e  # screenshots of every screen (tests/e2e-sim/__screenshots__)
```

`npm run eval` scores the prompts against a real AI provider (needs a key; see `docs/evals`).
