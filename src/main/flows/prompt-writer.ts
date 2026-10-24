/**
 * The prompt box (right ⌥ hold, ask bar route 'prompt'): the student says what they want ("explain
 * SN1 simply, I have an exam Friday") and Dumbledore writes a good prompt from it, plus what it
 * knows (the subject studied last, the running session, the AI chat in front, the page on screen),
 * then pastes it into the AI chat box without sending it.
 *
 * The prompt is written while the ask bar is still open (it shows its thinking state, and an error
 * line if writing fails); the bar closes before the paste so focus can return to the chat. A failed
 * paste puts the prompt on the clipboard with the ChatWriter's "copied — press ⌘V" toast, the same
 * fallback a study step gets.
 */
import type { PerceptionService, PromptService } from '@engine/contracts'
import type { ChatWriter } from '../chat/chat-writer'
import type { ToastSpec } from '../overlay/toasts'
import type { SurfaceControl } from '../platform'
import { chatContext } from './context'
import type { Thinking } from './thinking'

export interface PromptWriterDeps {
  prompts: Pick<PromptService, 'improve'>
  perception: Pick<PerceptionService, 'aiChat' | 'chatExcerpt' | 'pageContext'>
  writer: Pick<ChatWriter, 'write'>
  surfaces: Pick<SurfaceControl, 'isOpen' | 'close'>
  thinking: Thinking
  overlay: { showToast(spec: ToastSpec): string }
  /** Name of the subject studied last (else the focus subject); null when there is none. */
  subjectName: () => string | null
}

export interface PromptWriteResult {
  /** The prompt is in the AI chat box (false: it was copied to the clipboard instead). */
  pasted: boolean
  prompt: string
}

export class PromptWriter {
  constructor(private readonly deps: PromptWriterDeps) {}

  async write(context: string, opts: { signal?: AbortSignal } = {}): Promise<PromptWriteResult> {
    const { prompts, perception, writer, surfaces, thinking, overlay } = this.deps
    const wish = context.trim()
    if (!wish) throw new Error('Say what the prompt should ask for.')
    const ctx = chatContext(perception)
    const subject = this.deps.subjectName()
    if (subject) {
      ctx.pageContext = [`Subject: ${subject}`, ctx.pageContext].filter((s) => s.trim()).join('\n')
    }
    const result = await thinking.run('Writing your prompt…', () => prompts.improve(wish, ctx))
    const prompt = result.prompt.trim()
    if (!prompt) throw new Error('Dumbledore could not write a prompt. Try again.')

    if (surfaces.isOpen('askbar')) await surfaces.close('askbar')
    const out = await writer.write({
      text: prompt,
      mode: 'insert',
      target: 'chat',
      signal: opts.signal,
    })
    return { pasted: out.ok, prompt }
  }
}
