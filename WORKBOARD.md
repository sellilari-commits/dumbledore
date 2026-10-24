# Workboard

Who is working on what in this repo, right now. Several people and their Claude agents work here
in parallel (Ilari, Olle), so check this board before you start and keep it current. The rules are
in `AGENTS.md` → "Workboard" (every agent and tool reads it; a pre-push hook enforces it).

## In progress

| Started (UTC) | Who / agent | Work | Files or areas claimed | Branch | Notes |
|---|---|---|---|---|---|
| 2026-10-24 20:20 | Ilari / Claude | Delete a subject (trash button) and everything Dumbledore remembers about it | src/engine/contracts.ts, src/engine/store/repos/subjects.ts, src/engine/testing/memory-repos.ts, src/engine/store/conformance/subjects.ts, src/engine/subjects/subject-service.ts, src/shared/ipc.ts, src/main/ipc/handlers.ts, src/main/fakes/fake-services.ts, src/renderer/lib/mock/handlers-core.ts, src/renderer/lib/queries.ts, src/renderer/surfaces/app/AppSidebar.tsx, src/renderer/pages/subject/ | main | |

## Done recently

Newest first; keep about the last 20 entries.

| Finished (UTC) | Who / agent | Work | Commit |
|---|---|---|---|
| 2026-10-24 | Ilari / Claude | Fresh install starts empty: orb and chat window never fall back to demo data | 84f8871 |
| 2026-10-24 | Ilari / Claude | Workboard rules for every agent (AGENTS.md + pointers) and the pre-push hook | see log |
| 2026-10-24 | Ilari / Claude | Double-tap chat: recent topics carousel on top | c13beea |
| 2026-10-24 | Ilari / Claude | Capture stays on while the screen changes, even without input | 250e04b |
| 2026-10-24 | Ilari / Claude | No tip box after a prompt is pasted | ac41cbe |
| 2026-10-24 | Ilari / Claude | Long press: describe what you want, Dumbledore writes the prompt | 244adae |
| 2026-10-24 | Ilari / Claude | Memory on real use: no demo leaks, steadier capture, better extraction | e657135 |
