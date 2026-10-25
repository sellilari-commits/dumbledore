/**
 * Starting or resuming a roadmap from a click in the app ("Make a roadmap", "Start a roadmap",
 * "Resume"), saying plainly what happens at each moment:
 *   · at once: "Planning a roadmap for Hyksos expulsion…";
 *   · then step 1 goes into the open AI chat, or, with none open, onto the clipboard (Dumbledore
 *     switches to no other app), and a pop-up says "Step 1 of 6 is copied — paste it into ChatGPT
 *     with ⌘V". A click on it, or on "Open ChatGPT", opens the student's usual AI with the prompt
 *     (prompt.openUsualAi: a website opens only on that click);
 *   · a new roadmap opens its subject page, where it shows under Progress with why it was made,
 *     how it works and all its steps.
 */
import { toast, useToasts } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { useAction } from '@renderer/lib/queries'
import { APP_ROUTES, type SessionStarted } from '@shared/state'
import { useLocation } from 'wouter'
import { openedText } from './NoChatChoice'

/** What "Make a roadmap" does, for its tooltip. */
export const ROADMAP_HINT =
  'Dumbledore plans a few steps on this topic, with a short quiz, and walks you through them in your AI chat. A roadmap the subject already has moves to its Roadmap history.'

/** What "Quick fix" does, for its tooltip. */
export const QUICK_FIX_HINT =
  'One prompt for your AI about exactly what you got wrong here. No roadmap, nothing else changes.'

/** "Step 2 of 6": the step the session is on. */
export function stepLabel(s: Pick<SessionStarted, 'index' | 'total'>): string {
  return `Step ${Math.min(s.index + 1, s.total)} of ${s.total}`
}

/** What the pop-up says once the step is out: copied (paste it there) or in the open chat. */
export function startedText(s: SessionStarted): string {
  if (s.copied) {
    const where = s.copied.usual?.name ?? 'your AI chat (ChatGPT, Claude, Gemini…)'
    return `${stepLabel(s)} is copied — paste it into ${where} with ⌘V`
  }
  return `${stepLabel(s)} is in ${s.assistant ?? 'your AI chat'} — press Enter there`
}

export function useStartRoadmap() {
  const start = useAction('session.start')
  const openUsual = useAction('prompt.openUsualAi')
  const [location, navigate] = useLocation()

  const open = (text: string) =>
    openUsual.mutate(text, {
      onSuccess: (r) =>
        r.opened
          ? toast(openedText(r.opened), { tone: 'success', ttlMs: 8000 })
          : toast('No AI to open — the prompt is copied, paste it into your AI chat.'),
      onError: (err) => errorToast(err),
    })

  return {
    pending: start.isPending,
    /**
     * `planning`: the words shown at once (null: none, e.g. a quick resume). `show`: open the
     * subject page afterwards, so the student sees the roadmap.
     */
    run(
      input: { subjectId: string; goal: string | null },
      opts: { planning: string | null; show: boolean },
    ) {
      const planningId = opts.planning ? toast(opts.planning, { ttlMs: 60_000 }) : null
      const done = () => {
        if (planningId !== null) useToasts.getState().dismiss(planningId)
      }
      start.mutate(
        { ...input, question: null, copyIfNoChat: true },
        {
          onSuccess: (s) => {
            done()
            // Show the roadmap: its subject page opens at Progress, at the top.
            if (opts.show && !location.startsWith(`/subjects/${s.subjectId}/`))
              navigate(APP_ROUTES.subject(s.subjectId))
            else if (opts.show) document.getElementById('subject-progress')?.scrollIntoView()
            const copied = s.copied
            toast(startedText(s), {
              tone: 'success',
              ttlMs: 15_000,
              ...(copied?.usual
                ? {
                    action: {
                      label: `Open ${copied.usual.name}`,
                      onClick: () => open(copied.text),
                    },
                    actOnClick: true,
                  }
                : {}),
            })
          },
          onError: (err) => {
            done()
            errorToast(err)
          },
        },
      )
    },
  }
}
