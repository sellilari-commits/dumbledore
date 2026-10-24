/**
 * Has the AI answered a step yet? A learn step counts as done only once the student actually got
 * the answer to its prompt (Ilari, 2026-10-25), not when the prompt was pasted.
 *
 * `answerAfterPrompt` finds the pasted prompt in the live chat excerpt (perception's
 * chatExcerptOf: "Student: …" / "<Assistant>: …" blocks, newest last) by word shingles, so a
 * wrapped, truncated or OCR'd prompt still matches, and returns the assistant text after it.
 * `AnswerWatch` polls the excerpt while a step is sent and calls back once the answer is long
 * enough and has stopped changing for `stablePolls` polls (the AI may still be streaming).
 */
import type { Cancel, Clock } from '../../clock'

export interface AnswerOptions {
  /** An answer shorter than this is not an answer yet (a greeting, a "Thinking…" line). */
  minChars: number
  /** Polls with an unchanged answer before it counts (streaming has stopped). */
  stablePolls: number
  pollMs: number
  /** How much of the chat to read. */
  excerptChars: number
}

export const ANSWER_DEFAULTS: AnswerOptions = {
  minChars: 120,
  stablePolls: 2,
  pollMs: 2000,
  excerptChars: 6000,
}

const SHINGLE = 6
const BLOCK_SEP = /\n{2,}/
const ROLE = /^([^\n:]{1,40}):\s/

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Word shingles from the start, middle and end of the prompt (the screen may show only part). */
function shinglesOf(prompt: string): string[] {
  const words = norm(prompt).split(' ').filter(Boolean)
  if (words.length === 0) return []
  if (words.length <= SHINGLE) return [words.join(' ')]
  const at = (i: number) => words.slice(i, i + SHINGLE).join(' ')
  const last = words.length - SHINGLE
  return [...new Set([at(0), at(Math.floor(last / 2)), at(last)])]
}

interface Block {
  role: 'student' | 'assistant' | null
  text: string
}

function blocksOf(excerpt: string, assistant: string | null): Block[] {
  return excerpt
    .split(BLOCK_SEP)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = ROLE.exec(raw)
      if (!m) return { role: null, text: raw }
      const who = (m[1] ?? '').trim()
      const body = raw.slice(m[0].length)
      if (who === 'Student') return { role: 'student', text: body }
      // Only known speaker labels count: "Explain this step by step: …" is not a speaker.
      if (who === (assistant ?? 'Assistant') || who === 'Assistant')
        return { role: 'assistant', text: body }
      return { role: null, text: raw }
    })
}

/**
 * The assistant's text after the last place the prompt appears in the chat, '' when the prompt
 * isn't there (chat switched, scrolled away) or nothing came after it yet.
 */
export function answerAfterPrompt(
  excerpt: string,
  prompt: string,
  assistant: string | null,
): string {
  const shingles = shinglesOf(prompt)
  if (shingles.length === 0 || !excerpt.trim()) return ''
  const blocks = blocksOf(excerpt, assistant)
  const hit = (text: string) => {
    const n = norm(text)
    return shingles.some((s) => n.includes(s))
  }
  let at = -1
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (hit((blocks[i] as Block).text)) {
      at = i
      break
    }
  }
  if (at < 0) return ''
  const here = blocks[at] as Block
  const after = blocks
    .slice(at + 1)
    .filter((b) => b.role !== 'student')
    .map((b) => b.text)
  // Without roles (no alignment info) the prompt and the answer may share one block: take what
  // follows the prompt's last shingle inside it.
  if (here.role === null) {
    const n = norm(here.text)
    const end = Math.max(
      ...shingles.map((s) => (n.lastIndexOf(s) >= 0 ? n.lastIndexOf(s) + s.length : -1)),
    )
    const tail = end >= 0 ? n.slice(end).trim() : ''
    if (tail) after.unshift(tail)
  }
  return after.join('\n').trim()
}

/** True when the excerpt already holds a substantial answer to `prompt`. */
export function hasAnswer(
  excerpt: string,
  prompt: string,
  assistant: string | null,
  minChars = ANSWER_DEFAULTS.minChars,
): boolean {
  return answerAfterPrompt(excerpt, prompt, assistant).length >= minChars
}

export interface WatchTarget {
  itemId: string
  prompt: string
  assistant: string | null
}

/**
 * Polls the live chat for the answer to one sent step. `onAnswered` fires once, when the answer
 * is at least `minChars` long and unchanged for `stablePolls` polls in a row.
 */
export class AnswerWatch {
  private target: WatchTarget | null = null
  private cancel: Cancel | null = null
  private lastLength = -1
  private steady = 0

  constructor(
    private readonly clock: Clock,
    private readonly excerpt: ((maxChars: number) => string) | null,
    private readonly onAnswered: (itemId: string) => void,
    private readonly opts: AnswerOptions = ANSWER_DEFAULTS,
  ) {}

  get watching(): string | null {
    return this.target?.itemId ?? null
  }

  start(target: WatchTarget): void {
    this.stop()
    if (!this.excerpt) return // no live chat feed: the student marks the step done by tapping
    this.target = target
    this.cancel = this.clock.setInterval(() => this.poll(), this.opts.pollMs)
  }

  stop(): void {
    this.cancel?.()
    this.cancel = null
    this.target = null
    this.lastLength = -1
    this.steady = 0
  }

  /** One check now (also used by the poll timer). */
  poll(): void {
    const target = this.target
    if (!target || !this.excerpt) return
    let length = 0
    try {
      length = answerAfterPrompt(
        this.excerpt(this.opts.excerptChars),
        target.prompt,
        target.assistant,
      ).length
    } catch {
      return
    }
    if (length >= this.opts.minChars && length === this.lastLength) this.steady++
    else this.steady = length >= this.opts.minChars ? 1 : 0
    this.lastLength = length
    if (this.steady >= this.opts.stablePolls) {
      this.stop()
      this.onAnswered(target.itemId)
    }
  }
}
