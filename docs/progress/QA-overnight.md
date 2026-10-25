# QA overnight: install to tests, end to end
Updated: 2026-10-24T23:40Z · Olle / Claude · done

A full pass over the app: clean install, every test suite, the installed app on the real engine,
and three audits (install/setup/settings, overlay and router surfaces, the learning loop). What
was broken or inconsistent in unclaimed files is fixed and pushed; what is a product decision or
sits in someone's area is listed under **Open** below.

## How it was checked
- **Fresh clone** of main (scratch folder): `npm ci` (now also fetches Electron), `npm run
  typecheck` clean, `npx vitest run` 1537 passed / 43 skipped (the helper's integration tests
  skip until the helper is built), `npm run package` → `release/mac-arm64/Dumbledore.app` with
  the helper embedded and the fuses set.
- **Working tree:** typecheck clean, `biome check .` 0 errors (2 old warnings), `vitest run` 1577
  passed, `npm run test:e2e` 104 passed.
- **Installed app** (`npm run install-app`, then `DUMBLEDORE_CONTROL=1 DUMBLEDORE_DATA_DIR=<scratch>`):
  fuses read back (RunAsNode, NODE_OPTIONS, --inspect off), signature verifies, helper connects,
  onboarding opens on first launch. On the real engine with only the keyless OVH fallback: subject
  created (emoji picked), exam generated in 30 s, answered and finished (score, 3 gaps with
  misconceptions, fix prompt), the missed concepts show as struggling on the subject and on Home,
  a 9-step SN1 vs SN2 roadmap planned in 58 s and shown under Continue.
- **Not checked live:** outlining a real page, the key gestures in a real chat and capture. A new
  ad-hoc build has no Accessibility / Screen Recording grant until it is given again (see Open →
  signing). Material upload opens a file picker, so it is covered by unit tests only.

## Fixed (all on main)
**Install and build**
- The helper builds on the macOS 15 SDK (FoundationModels guarded and weak-linked only when the SDK
  has it); `npm run package` builds the helper first, `npm ci` fetches Electron, `test:e2e` builds
  first; `npm run install-app` builds, signs inside-out and installs; README; engines node ≥ 22.12;
  the missing `bench` script removed; lint scoped so `npm run lint` is clean.
- Electron fuses: no other process can run Dumbledore as plain Node or attach a debugger to borrow
  its macOS grants.
- Login item only from /Applications; a stale test-control token file is removed at start.
- OCR on macOS 15 read Swedish å as ă/ả: mapped back (Vision has no sv-SE there).

**First run**
- A fresh install opened Home and never onboarding (the window loaded `/home`; only `/` redirects).
  It opens at `/` now, and onboarding opens on launch until done.
- Screen Recording dead end: macOS applies the grant only to a new process, so onboarding waited
  forever. "Turned it on? Quit & reopen" (new IPC `app.relaunch`); onboarding remembers its step.
- A stopped helper shows a note with Quit & reopen instead of permissions stuck on "off".
- Before onboarding is done the key did nothing; it now brings onboarding back. The key lesson
  accepts the backup chord.
- Privacy copy says what is true: stored on the Mac, only the text a question needs goes to the AI
  provider, masked. The no-effect "Auto-send prompts" switch is gone.

**Surfaces**
- A tap clears the outline (also mid-session) and closes the open mini panel; on a reading page
  it outlines.
- Outline: the orb and its cards sit above the wash; the card shows on the page's display only and
  says "tap <your key> to clear"; it honours the OCR switch and says "Private page" for excluded
  apps and sites; its outcomes are shown (they answer a gesture that otherwise shows nothing).
- The overlay follows the theme and the Dumbledore key; settings changes reach every window.
- Quiz keys are grabbed only while the quiz card is visible (not with the orb hidden).
- Tray: shows ⌃⌥⌘D on "Open Dumbledore" and offers "End study session" while one runs.
- A key tap never reads a selection or field in an excluded app or a password manager.

**Learning loop**
- The usual AI is part of every AppState push (it vanished after the first update).
- Home → Continue keeps a roadmap whose session ended (parked), as the session would resume it.
- No ChatGPT default: prompts say "their AI assistant" when no chat is known; the quiz fix prompt
  names the open chat, the session's or the usual AI; onboarding and first steps name any AI chat.
- The quiz result says where the fix prompt went ("Opened Claude with the prompt" / "· paste with ⌘V").
- Exams on a subject with nothing captured follow its goal (P06 v3); a real run on "SN1 vs SN2"
  had asked about keto-enol and EAS.
- Roadmap planning: the planner cut the brain off at 30 s although the brain allowed 45 s, and the
  keyless fallback needs ~60 s. Both are 90 s.
- A finished roadmap offers "Plan the next roadmap"; gap counts read "Stuck on it N times"
  (quiz misses and confused reading both count). First steps stay ticked once done.
- Prefilter recognises Dumbledore's own sidebar after Inbox → Memory.
- Errors: the router's "unavailable" and the spending cap read in plain words.
- Delete everything also removes the clean-up's database backups and the chat-box spots.

## Open (decisions, or someone else's area)
**For Olle**
- **Gemini isn't connected on your Mac.** The installed app lists Gemini as not working, so every AI
  call uses the slow free OVH fallback (exam ~30 s, roadmap ~60 s). `.env.local` points
  `DUMBLEDORE_ENV_FILES` at `hugo-backend/.env`, which apparently has no `GEMINI_API_KEY` (not
  read). Add the key in Settings → AI providers.
- **Permissions after each install** (fixed the morning after): ad-hoc signing changed with every
  build, so macOS stopped honouring the Accessibility / Screen Recording switches after a
  reinstall while they still looked on. `install-app` now signs with a stable "Dumbledore Dev"
  identity (`tools/dev-identity.sh`), and a stuck "Waiting for macOS…" offers "Already on? Reset
  and ask again" (`tccutil reset` for the app, then macOS asks again). The first install with the
  new signature needs the grants once more.

**For Ilari (his decisions or areas)**
- Toast rule (6364d96): the password-field refusal, "Cancelled", router errors and the Screen
  Recording reminder are silent by design. One is risky: "Couldn't paste — copied, press ⌘V"
  overwrites the clipboard without telling the student. Only outline outcomes were added to the
  shown purposes.
- Perception: a selection in a just-focused excluded app can be saved onto the previous page
  (`highlights.ts`, the gate uses the last tick's episode); the idle probe perceives, OCR included,
  before the private-window / host check (`scheduler.ts`).
- Snooze bypasses the nudge engine; `offerPlacement` is unused; mock and real read models differ
  (review, quiz.finish mastery, subject detail); the Memory "New" tag means "never quizzed" and
  stays until a quiz.
- The checkpoint "quiz or continue?" box needed the smoke test updated (done in 9e2820e).

**Engineering, not urgent**
- Helper socket checks only the uid, not the caller's code signature (PLAN §6.9).
- Test-control works in the packaged app when `DUMBLEDORE_CONTROL=1` (needed for these runs);
  gate it behind a build flag before giving the app to anyone.
- No UI for spend vs the €10 cap; an env key that fails shows "No key yet"; with safeStorage
  unavailable a saved key is lost on restart while the flag says it is set; `ai.ready` is always
  true (the keyless fallback counts).
- Login at startup has no Settings switch, and Delete everything leaves it on.
- `Package.swift`'s unconditional weak FoundationModels flag breaks `swift build` on the 15 SDK
  (`build.sh` is the supported build).
- PLAN.md is behind: §5, §6.2 (tools/bench.ts, dev-launch.sh, … don't exist), WP9 (helper is in
  LoginItems), §9.4.1 ("permissions survive rebuilds" holds only with install-app's stable identity).
- Dead code: design-system `RoadmapItem` / `Checkbox`, `useChat`, a few unused events and channels.
- Selection actions can't be cancelled with Esc; the overlay timer-chooser test is flaky in the
  full run (passes alone).
