/**
 * P16 Chat summary (tier `triage`): folds the older part of the double-tap chat into the running
 * summary so far, so a long chat keeps its memory without sending every turn. It keeps what the
 * next turns need: what the student asked and wants, what Dumbledore did, created, changed or
 * undid (names and ids exactly), open questions and promises. At most ~180 words, in the chat's
 * language.
 */
import {
  type ChatSummaryInput,
  type ChatSummaryOutput,
  ChatSummaryOutput as ChatSummaryOutputSchema,
} from '@engine/brain-contract'
import { clip, clipTail, countWords, looksFinnish } from '../llm/text'
import { languageName, limitWords, type PromptSpec, tag } from './shared'

export const CHAT_SUMMARY_MAX_WORDS = 180

export function chatSummaryLanguage(input: ChatSummaryInput): string {
  return looksFinnish(input.transcript) ? 'fi' : 'en'
}

export const chatSummaryPrompt: PromptSpec<ChatSummaryInput, ChatSummaryOutput, ChatSummaryOutput> =
  {
    id: 'P16',
    task: 'summarizeChat',
    version: 1,
    tier: 'triage',
    temperature: 0.2,
    maxOutputTokens: 600,
    reasoningEffort: 'low',
    schemaName: 'chat_summary',
    schema: ChatSummaryOutputSchema,
    onDeviceOk: false,
    cacheable: true,
    language: chatSummaryLanguage,
    build: (input) => ({
      system: `You keep the memory of a long chat between a student and Dumbledore, their study coach. Fold the older chat turns into the summary so far and return one updated summary.
- Keep what later turns need: what the student asked for and wants, what Dumbledore did — created, changed, saved, deleted, planned or undid (lines starting "Done:", "Undone by the student:" and "Tools:" say this) — with names and ids exactly as written, what is still open (questions, promises, things waiting for the student's click), and facts the student gave (dates, goals, preferences).
- Later turns win: when something was changed or undone, say how it ended up.
- Leave out greetings, small talk and the wording of long explanations (one line on what was explained is enough).
- At most ${CHAT_SUMMARY_MAX_WORDS} words, short plain sentences or "- " lines, no headings, written about the chat ("The student asked …; Dumbledore created …").
Write in ${languageName(chatSummaryLanguage(input))}.`,
      user: [
        tag('summary_so_far', input.previous.trim() || '(none yet)'),
        tag('older_turns', clipTail(input.transcript, 24_000)),
      ].join('\n'),
    }),
    check: (out) =>
      countWords(out.summary) > CHAT_SUMMARY_MAX_WORDS + 40
        ? [`summary has ${countWords(out.summary)} words; max ${CHAT_SUMMARY_MAX_WORDS}`]
        : [],
    finalize: (out) => ({
      summary: clip(limitWords(out.summary.trim(), CHAT_SUMMARY_MAX_WORDS + 40), 2400),
    }),
  }
