# T Memory real — status
Updated: 2026-10-24T18:20Z

## Findings so far (real DB copy, read-only, 54 episodes / 16 encounters today)
- Demo leak path A (the real one): perception read Dumbledore's OWN renderer in mock mode, shown
  in the Claude app's preview pane (localhost:5190 app-ui, no bridge -> mock demo) and the
  tools/mock-chat page (127.0.0.1:5199). Extractor turned it into Chemistry encounters + an assignment.
- Demo leak path B (latent): src/renderer/lib/api.ts falls back to mock whenever window.dumbledore
  is missing, incl. the packaged app if preload fails. overlay/lib/bridge.ts has the same fallback
  (not my files; report).
- Demo rows: assignment asg_mvmnkfnje23a2696e4 "Lab report: SN1 hydrolysis"; encounters
  enc_mvmnkfnib28852e2c6, enc_mvmnkfnkf2d2a76e56, enc_mvmnpg506cd822e0f6, enc_mvmodgfgf2fc57d4d2,
  enc_mvmodgfi5fbdca7eb1, enc_mvmoecq82971a9e43e; polluted concept summaries con_mvmm1ly04fda11f23d,
  con_mvmm1rpp8c47a668de, con_mvmodgff4ac54ab78c, con_mvmoecq8ffd1219b58.
- Dev-work noise (not demo): subject sub_mvmns1rg8d4e5468af Software Development (suggested),
  encounters seq 6,7,10,12,13,15, concepts Code Signing/macOS/Accessibility.../Permission persistence.
- Bad encounters mostly from OVH gpt-oss fallback 17:01–17:31Z; Gemini flash-lite skipped dev chats.
- Prefilter passes empty ChatGPT/Gemini home pages (UI chrome only) -> wasted calls.
- Budget 150 calls / 200k est tokens per day ~ 55 batches: a full day of use will hit it.

## Scope
- ✅ 1. api.ts: mock only with ?mock=1 or dev-server plain browser; built app w/o bridge -> failing API
- ✅ 1b. prefilter: drop Dumbledore's own UI (sidebar signature, key demo, mock chat) + empty chat home pages (+tests)
- ✅ 2. worker: budget 400 calls / 1.2M tokens; hourly recover of unextracted + in-flight guard (+test);
       scheduler: missed-unlock recovery (+test). Capture default on, persisted (settings captureEnabled=true), login item.
- ✅ 3. P1 v2 rules (own UI, coding-agent work, empty chat page, describe content not UI); compact on-device
       variant kept short. Fixtures R01–R12 in tests/fixtures/llm/extraction.json; eval `--only R`.
       Live: Gemini real cases 12/12 (v1 and v2); OVH gpt-oss-20b v1 P=0.75 + 1 struggling guess, v2 P=0.75, 0 guesses.
       Full suite v2 Gemini: 42 eps P=1 R=1 (docs/evals/2026-10-24-extraction-r6.md). Spend ~€0.05.
- ✅ Tests green (perception, brain, renderer/lib), node tsc 0, biome clean. Web tsc: 1 error in
       lib/mock/handlers-core.ts ('prompt.write' missing) from the coordinator's concurrent ipc change, not mine.

## Open issues / requests for the integrator
- overlay/lib/bridge.ts wantsMock() falls back to mock when bridge missing (same as api.ts had).
- privacy/redact turns unspaced chat text (PDF/AX of ChatGPT) into [secret] — loses chemistry content.
- Demo rows to clean listed above; also memory/chemistry.md regenerates from DB.
