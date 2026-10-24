/**
 * Tap on selected text (F4 d): a toast offering "Explain with <assistant>", "Add to a roadmap"
 * and "Quiz me" for the selection.
 */
import { usualAssistantFrom } from '@engine/perception/ai-chat/usual'
import type { RouterDeps } from './shortcut-router'

type Deps = Pick<
  RouterDeps,
  'perception' | 'overlay' | 'writer' | 'repos' | 'sessions' | 'quizzes' | 'ask'
>

export const preview = (text: string, max = 140) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text

export function explainPrompt(selection: string): string {
  return [
    "I'm studying this and want to really understand it:",
    `"${preview(selection, 600)}"`,
    'Explain it in 3 numbered points with one concrete example. No greetings or small talk. Short structured bullets, max ~150 words, bold key terms. Then ask me one question to check I got it, and wait.',
  ].join('\n')
}

export function selectionToast(deps: Deps, text: string): void {
  const assistant =
    deps.perception.aiChat()?.assistant ??
    usualAssistantFrom(deps.repos, Date.now())?.name ??
    'your AI'
  deps.overlay.showToast({
    kind: 'info',
    purpose: 'selection',
    title: 'Selected text',
    body: preview(text),
    actions: [
      {
        id: 'explain',
        label: `Explain with ${assistant}`,
        primary: true,
        run: () => explain(deps, text),
      },
      { id: 'roadmap', label: 'Add to a roadmap', run: () => addToRoadmap(deps, text) },
      { id: 'quiz', label: 'Quiz me', run: () => quizMe(deps, text) },
    ],
  })
}

async function explain(deps: Deps, text: string): Promise<void> {
  await deps.writer.write({ text: explainPrompt(text), mode: 'insert', target: 'chat' })
}

async function addToRoadmap(deps: Deps, text: string): Promise<void> {
  const subjectId = deps.repos.settings.get().focusSubjectId
  await deps.sessions.start({ subjectId, goal: preview(text, 200), question: null })
}

async function quizMe(deps: Deps, text: string): Promise<void> {
  const { repos, quizzes, overlay, ask } = deps
  const lower = text.toLowerCase()
  const ids = repos.subjects
    .list({ status: ['active'] })
    .flatMap((s) => repos.concepts.listBySubject(s.id))
    .filter((c) => lower.includes(c.name.toLowerCase()))
    .map((c) => c.id)
  if (ids.length > 0) {
    const quiz = await quizzes.startReview(ids)
    overlay.openQuiz(quiz.id)
    return
  }
  await ask.instruction(`Quiz me on this: ${preview(text, 300)}`)
}
