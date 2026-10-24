# U Code tab — status
Updated: 2026-10-24T17:50:00Z

## Scope
- ✅ Real helper samples (perceive frontmost, 3× a minute apart) of the Claude app Code tab → tests/fixtures/episodes/09-claude-code-tab-real.json (long lines cut to 300 chars, scrubbed)
- ✅ Cause: real Code tab has title "Claude", no "⏺ Bash(…)" glyphs, transcript is one >160-char AX line; only "Ran 2 commands" (1 agent kind) or nothing matched → never a coding session
- ✅ Fix (ai-chat/coding.ts): new evidence — workspace chip "Now working in … · …" (agent), "Claude Code" header line (header), agent checklist ≥2 "done/in progress/not done" lines (plan), "Ran a/N …" tool summaries. header/plan are confirm-only (never decide alone), so a study chat with a "Claude Code" sidebar entry + code stays a chat
- ✅ No study memory: Detection.agentSession → tracker.isAgentSession → builder marks OpenEpisode.agentSession → episode kind 'other', stored extracted:true; worker.enqueue skips extracted episodes. Code→Chat switch in one window now splits episodes too
- ✅ Tests: ai-chat/code-tab-real.test.ts, fixture 09 (learning:true, extractCalls 0, encounters 0), fixture 08 hardened the same way; vitest perception+privacy 16 files / 271 green; tsc 0; biome clean

## Next
1. Live check in the installed app after the next build.

## Open issues / requests for the integrator
- Claude Code in a terminal/editor (isCodingApp) is still "coding, not chat" only; its episodes can still be extracted as ordinary pages (deliberately unchanged: programming study in VS Code).
- Already-stored junk (29 claude ai_chat episodes, memory like "troubleshooting permission persistence") is not cleaned up by this change.
