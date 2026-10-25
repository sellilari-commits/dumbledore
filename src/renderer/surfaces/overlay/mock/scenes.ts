/**
 * Scripted OverlayStates for browser development and screenshots (`?scene=<name>`), plus the
 * geometry of the fake desktop they sit on (MockStage draws the same chat box the orb docks to).
 */
import type { Rect } from '@shared/geometry'
import type { OverlayState, Toast } from '@shared/state'
import type { Size } from '../lib/layout'

export const SCENES = [
  'idle',
  'paused',
  'thinking',
  'attention',
  'session',
  'checkpoint',
  'pill',
  'docked',
  'improve',
  'toast',
  'tip',
  'quiz',
  'left',
  'timer',
  'outline',
] as const
export type SceneName = (typeof SCENES)[number]

/** The scripted tour that plays when no scene is pinned. */
export const TOUR: SceneName[] = [
  'idle',
  'pill',
  'thinking',
  'session',
  'docked',
  'improve',
  'session',
  'toast',
  'attention',
  'checkpoint',
  'quiz',
]

export function isScene(name: string | null): name is SceneName {
  return name !== null && (SCENES as readonly string[]).includes(name)
}

/** The fake browser window on the mock desktop. */
export function browserRect(vp: Size): Rect {
  const x = 56
  const y = 48
  return { x, y, width: Math.max(480, vp.width - x - 150), height: Math.max(360, vp.height - 96) }
}

/** The article the outline scene marks up: one line per row, at fixed spots in the window. */
export const ARTICLE = [
  'Carbocation',
  'A carbocation is an ion with a positively charged carbon atom that has only six',
  'electrons in its valence shell. They are key intermediates in SN1 and E1 reactions.',
  'Stability',
  'Carbocation stability increases from methyl to primary, secondary and tertiary.',
  'Alkyl groups donate electron density through hyperconjugation: adjacent C–H bonds',
  'overlap with the empty p orbital and spread the positive charge.',
  'Inductive effects of alkyl groups add to this, which is why 3° cations form fastest.',
  'History',
  'The term carbonium ion was used from 1902; Olah’s superacid work in the 1960s made',
  'carbocations observable by NMR, earning the 1994 Nobel Prize in Chemistry.',
  'See also: carbanion, radical, Wagner–Meerwein rearrangement.',
]

export function articleLines(vp: Size): { text: string; rect: Rect }[] {
  const win = browserRect(vp)
  return ARTICLE.map((text, i) => ({
    text,
    rect: {
      x: win.x + 160,
      y: win.y + 64 + i * 30,
      width: Math.min(620, win.width - 320),
      height: 20,
    },
  }))
}

const span = (lines: { rect: Rect }[], from: number, to: number): Rect => {
  const a = lines[from]?.rect ?? { x: 0, y: 0, width: 0, height: 0 }
  const b = lines[to]?.rect ?? a
  return { x: a.x, y: a.y, width: a.width, height: b.y + b.height - a.y }
}

/** The fake chat input inside that window — the orb docks beside it. */
export function chatBoxRect(vp: Size): Rect {
  const win = browserRect(vp)
  const width = Math.min(640, win.width - 160)
  return {
    x: Math.round(win.x + (win.width - width) / 2),
    y: win.y + win.height - 56 - 32,
    width,
    height: 56,
  }
}

export const NUDGE: Toast = {
  id: 'toast_nudge',
  kind: 'nudge',
  title: '3-minute check on carbocations?',
  body: 'You missed two of these yesterday. A quick quiz now locks them in.',
  actions: [
    { id: 'later', label: 'Later', primary: false },
    { id: 'start', label: 'Start quiz', primary: true },
  ],
  ttlMs: 15_000,
  nudgeId: 'nud_demo',
}

export const TIP: Toast = {
  id: 'toast_tip',
  kind: 'tip',
  title: 'Why this prompt works',
  body: 'It asks for a worked example before the definition, so you see the idea in action first.',
  actions: [],
  ttlMs: 15_000,
  nudgeId: null,
}

export const DEMO_QUIZ_ID = 'quiz_demo'
export const SUGGESTION =
  'Explain carbocation stability like I am new to organic chemistry, then give me one example to try'

function base(vp: Size): OverlayState {
  return {
    displayId: 1,
    orb: {
      x: vp.width - 32,
      y: Math.round(vp.height * 0.42),
      size: 40,
      visual: 'idle',
      thinking: false,
      progress: null,
      dot: 'none',
      paused: false,
      docked: false,
    },
    dockTarget: null,
    edge: 'right',
    pill: null,
    side: { next: null, quiz: false },
    chip: null,
    toasts: [],
    quiz: null,
    aiChat: null,
    timer: null,
    timerMinutes: 25,
  }
}

function session(s: OverlayState, k: number, n: number): OverlayState {
  return {
    ...s,
    aiChat: { provider: 'ChatGPT' },
    orb: { ...s.orb, visual: 'session', progress: { k, n } },
    side: { next: { label: `${k}/${n}` }, quiz: false },
  }
}

function docked(s: OverlayState, vp: Size): OverlayState {
  const box = chatBoxRect(vp)
  return {
    ...s,
    aiChat: { provider: 'ChatGPT' },
    dockTarget: box,
    orb: {
      ...s.orb,
      x: box.x + box.width + 10 + 14,
      y: box.y + box.height / 2,
      size: 28,
      visual: 'docked',
      docked: true,
    },
  }
}

export function sceneState(name: SceneName, vp: Size): OverlayState {
  const s = base(vp)
  switch (name) {
    case 'idle':
      return s
    case 'paused':
      return { ...s, orb: { ...s.orb, visual: 'paused', paused: true } }
    case 'thinking':
      return { ...s, orb: { ...s.orb, visual: 'thinking', thinking: true } }
    case 'attention':
      return { ...s, orb: { ...s.orb, visual: 'attention', dot: 'orange' } }
    case 'session':
      return session(s, 3, 8)
    case 'checkpoint': {
      const c = session(s, 4, 8)
      return { ...c, side: { next: null, quiz: true } }
    }
    case 'pill':
      return { ...s, aiChat: { provider: 'ChatGPT' }, pill: { label: 'Study', count: 4 } }
    case 'docked':
      return { ...docked(s, vp), chip: { kind: 'suggest', text: SUGGESTION } }
    case 'improve':
      return { ...docked(s, vp), chip: { kind: 'improve', text: 'what is a carbocation' } }
    case 'toast':
      return { ...s, toasts: [NUDGE] }
    case 'tip':
      return { ...session(s, 3, 8), toasts: [TIP] }
    case 'quiz':
      return {
        ...session(s, 4, 8),
        side: { next: null, quiz: true },
        quiz: { quizId: DEMO_QUIZ_ID },
      }
    case 'timer':
      return {
        ...s,
        // 25 minutes, 7 gone: the progress edge stands at about 28%.
        timer: {
          startedAt: new Date(Date.now() - 7 * 60_000 + 5_000).toISOString(),
          endsAt: new Date(Date.now() + 18 * 60_000 - 5_000).toISOString(),
        },
      }
    case 'outline': {
      const lines = articleLines(vp)
      return {
        ...s,
        outline: {
          windowId: 1,
          title: 'Carbocation – Wikipedia',
          subjectName: 'Organic Chemistry',
          summary: 'The Stability section is your gap; skip the history.',
          minutes: 1,
          // Two more passages further down the page: the edge cue and the card point there.
          below: 2,
          marks: [
            { rect: span(lines, 1, 2), verdict: 'skim', why: 'Background' },
            {
              rect: span(lines, 4, 6),
              lines: [4, 5, 6].map((i) => lines[i]?.rect).filter((r) => r !== undefined),
              verdict: 'read',
              why: 'Your gap: carbocation stability',
              order: 1,
            },
            {
              rect: span(lines, 7, 7),
              lines: [7].map((i) => lines[i]?.rect).filter((r) => r !== undefined),
              verdict: 'read',
              why: 'Why 3° cations form fastest',
              order: 2,
            },
            { rect: span(lines, 9, 11), verdict: 'skip', why: 'Off your goal' },
          ],
        },
      }
    }
    case 'left':
      return {
        ...session(s, 2, 6),
        edge: 'left',
        orb: { ...session(s, 2, 6).orb, x: 32, y: Math.round(vp.height * 0.3) },
        toasts: [TIP],
      }
  }
}
