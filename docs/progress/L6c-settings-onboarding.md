# L6c Settings + Onboarding — status

Updated: 2026-10-24T16:12:00Z

## Scope

- ✅ lib/ mock: profile.get/update, data.export (→ `<data dir>/exports/…json`), data.deleteAll
  (`mock/handlers-account.ts`: back to a first run, permissions kept, habits cleared), 'gemini' in
  secrets.set / providers.test (dev env key → test passes without a saved key; `?geminiEnv=0` turns
  it off; saved keys < 12 chars are "rejected"), `MockApi.pressKey()` emits 'key.gesture', Gemini rows
  in demo usage, `empty` scenario has zero prompt habits (Home lane request), mock exposed as
  `window.__dumbledoreMock` in the browser
- ✅ lib/ hooks: useProfile, useUpdateProfile, useProviderCheck (cached providers.test), useExportData,
  useDeleteAllData (resets every cached query first); `lib/gestures.ts` = clean-tap detector +
  useKeyGestures (merges 'key.gesture' with DOM presses, so a wrong key like left ⌥ is visible);
  AFFECTS: secrets.set → providers.test, profile.update, coach.runAction → subjects.get/list,
  home, session, picker (Subject lane request); live: 'profile' scope → profile.get;
  renderWithApp takes `mock` options. lib/profile.ts stub kept but deprecated.
- ✅ Settings: About you on profile channels; AI providers = Gemini (live status: "Using key from
  Hugo project" / Connected / key form / rejected) → Groq → OVHcloud → Mistral → Apple; Data =
  Export (path shown, main reveals in Finder) + Delete everything (dialog lists exports too and the
  restart → data.deleteAll {confirm:true} → /onboarding if the window survives). Shared KeyForm.
- ✅ Onboarding: Welcome → Permissions (live ✓) → AI (Gemini ready / add a key) → What are you
  studying (subjects + deadlines + About you) → Learn the key (keycap, coaching "That’s left ⌥ — tap
  right ⌥ instead", hold explained, right ⌘ conflict fix) → Done (honest checklist, "Try it now") →
  settings.update onboardingDone → /home. `?step=permissions|ai|study|key|done` opens a step.
- ✅ Tests: 53 in my paths (lib, settings, onboarding); whole web project 224 green; tsc + biome clean
- ✅ Screenshots (light + dark, reviewed): `tests/e2e-sim/__screenshots__/ui-settings-{general,capture,
  orb,shortcuts,ai,ai-nokey,coaching,data,data-confirm,about}-*.png`,
  `ui-onboarding-{1-welcome,2-permissions,2-permissions-waiting,3-ai,3-ai-nokey,4-study,5-key,
  5-key-wrong,5-key-done,6-done}-*.png` (40 files). Taken from the Vite preview (port 5184) with
  `app.html?mock=1&latency=0&theme=…#/settings/<id>` and
  `app.html?mock=1&latency=0&scenario=onboarding&step=<id>#/onboarding`; real key presses
  (Playwright `AltLeft`/`AltRight`) drive the key step.

## Next

1. A checked-in Playwright spec for these screens (`tests/e2e-sim/ui-screens.spec.ts`, not my path).
2. `mock/handlers-study.ts` is 368 lines after Biome formatting — split quiz/exam helpers out.

## Open issues / requests for the integrator

- Main: while onboarding is open (onboardingDone false), forward 'key.gesture' to the app window and
  don't route the tap (else the lesson's tap also opens the panel).
- Main: providers.test('gemini') must pass with the dev env key when no key is saved — Settings and
  onboarding show "Using key from Hugo project" from exactly that.
- profile.update gets `level: null` for an empty level.
- Seen in the browser: navigating to "/" right after `resetQueries()` redirected with stale
  settings (to /home); Delete everything therefore navigates to /onboarding directly.
