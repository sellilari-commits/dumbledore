# Y Gestures — status
Updated: 2026-10-24 (done; handed back to coordinator)

## Scope
- ✅ decide.ts — map v2 (coordinator update 2): tap = Enter on ask bar/quiz · refuse password · session in AI chat → next step · `/d` → instruction · chat box with own text → hint "Hold ⌥ to rewrite your prompt" · empty box / AI chat elsewhere → studyLast · selection → toast · else panel. Chip click: empty → suggest, typed → improve. Hold: ask bar/quiz → ignore · password → refuse · `/d` → instruction · chat box with text → improve (also in a session) · anything else → chooseSubject (askbar route 'choose'). Double-tap → askbar / focusAskbar. holdEnd → ignore.
- ✅ shortcut-router.ts + tap-guard.ts (key taps wait doubleTapMs+150 ms; a double-tap supersedes the tap) + hints.ts + selection-actions.ts + last-subject.ts (newest non-ignored encounter with an active subject → focus subject → picker)
- ✅ copy: onboarding key step (3 lessons, verdicts), DoneStep "Try it", Settings → Shortcuts (description + "Dumbledore key" gesture group), orb tooltip. Tray lists no gestures → unchanged.
- ✅ Screen Recording required: PERMISSIONS required + "So Dumbledore can read PDFs, slides and video."; onboarding Continue needs both; Settings rows show red "Off — …" description + "Turn on".
- ✅ tests: 147 green (router, onboarding, settings, overlay); tsc clean in my files; biome clean.

## Open issues / requests for the integrator
- SuggestionChip still says "Improve prompt · ⌥" (overlay, outside my scope) → "Rewrite prompt · hold ⌥".
- manager.open('askbar') on a visible ask bar re-places it; focusAskbar relies on open() just focusing.
- app.ts fallback chord could pass { source: 'chord' } to skip the 450 ms tap guard.
- PLAN §5.3 F4 first bullet + §5.6 rows still describe the old map.
- Better long-term: helper emits `tap` only after the double-tap window (then drop TapGuard).
