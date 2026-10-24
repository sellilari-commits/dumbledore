# Lane progress notes

Every build lane keeps one file here, so work survives interruptions. A lane that is restarted
reads its file first and continues from it instead of starting over.

| Lane | File | Owns |
|---|---|---|
| L1 Helper | `L1-helper.md` | `native/helper`, `src/engine/helper`, `tools/mock-chat` |
| L2a Store | `L2a-store.md` | `src/engine/store`, `src/engine/queries`, `src/engine/subjects`, `tools/seed-demo.ts` |
| L2b Brain | `L2b-brain.md` | `src/engine/brain`, `tools/eval-prompts.ts`, `docs/evals` |
| L3 Perception | `L3-perception.md` | `src/engine/perception`, `src/engine/privacy` |
| L4 Study | `L4-study.md` | `src/engine/learning/study` |
| L5 Follow-ups | `L5-followups.md` | `src/engine/learning/{mastery,quiz,followup}`, `src/engine/scheduler` |
| L6 App UI | `L6-app-ui.md` | `src/renderer/{design-system,pages,lib}`, `surfaces/{app,panel}` |
| L7a Shell | `L7a-shell.md` | `src/main`, `src/preload`, `resources` |
| L7b Overlay | `L7b-overlay.md` | `src/renderer/surfaces/{overlay,askbar}` |

Format of each file:

```markdown
# L1 Helper — status
Updated: <ISO time>

## Scope
- ✅ done item
- 🚧 in progress item — what is left
- ⬜ not started item

## Next
1. …

## Open issues / requests for the integrator
- …
```
