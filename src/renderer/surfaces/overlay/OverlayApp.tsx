/**
 * The overlay page: renders OverlayState on a transparent full-screen canvas — orb, side stack,
 * Study pill, suggestion chip, toasts and the quiz card — and sends OverlayActions back. Renders
 * nothing when the state belongs to another display. Hit areas report hover for click-through.
 */
import type { DumbledoreApi } from '@shared/ipc'
import type { OverlayAction, OverlayState } from '@shared/state'
import { useCallback, useEffect, useRef, useState } from 'react'
import { report } from './lib/bridge'
import {
  besideAnchor,
  cardAnchor,
  chipAnchor,
  type OrbBox,
  type Size,
  sideToward,
  tooltipAnchor,
} from './lib/layout'
import { useHitAreaHover } from './lib/useHitAreaHover'
import { useOverlayState } from './lib/useOverlayState'
import { type Point, usePointerGesture } from './lib/usePointerGesture'
import { useViewport } from './lib/useViewport'
import { Orb } from './orb/Orb'
import { orbLook } from './orb/orbLook'
import { QUIZ_WIDTH, QuizCard } from './quiz/QuizCard'
import { OrbTooltip, TOOLTIP_ID } from './satellites/OrbTooltip'
import { StudyPill } from './satellites/StudyPill'
import { SuggestionChip } from './satellites/SuggestionChip'
import { TOAST_WIDTH, ToastStack } from './toast/ToastStack'
import './styles/base.css'
import './styles/ui.css'

const TOOLTIP_DELAY_MS = 450
/** How long a dropped orb waits at the drop point for main's snapped position. */
const SETTLE_MS = 900

interface Props {
  api: DumbledoreApi
  /** This window's display (from `?display=`); null renders whatever display the state names. */
  displayId: number | null
}

export function OverlayApp({ api, displayId }: Props) {
  const state = useOverlayState(api)
  const viewport = useViewport()
  const send = useCallback(
    (action: OverlayAction) => {
      api
        .invoke('overlay.action', action)
        .catch((e: unknown) => report(e, `overlay ${action.type}`))
    },
    [api],
  )
  useHitAreaHover(send)
  // A drag that crosses onto another display keeps this window's scene (it owns the pointer)
  // until the drop, even though main already moved the orb's state over there.
  const [dragging, setDragging] = useState(false)

  const mine = state !== null && (displayId === null || state.displayId === displayId)
  if (!state || (!mine && !dragging)) return null
  return (
    <OverlayScene
      api={api}
      state={state}
      viewport={viewport}
      send={send}
      onDragging={setDragging}
    />
  )
}

interface SceneProps {
  api: DumbledoreApi
  state: OverlayState
  viewport: Size
  send: (action: OverlayAction) => void
  onDragging: (dragging: boolean) => void
}

function OverlayScene({ api, state, viewport, send, onDragging }: SceneProps) {
  const look = orbLook(state.orb)
  const statePos = { x: state.orb.x, y: state.orb.y }

  // After a drop, hold the orb where it was let go until main answers with the snapped spot.
  const [settle, setSettle] = useState<Point | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new position from main ends the settle
  useEffect(() => setSettle(null), [state.orb.x, state.orb.y])
  useEffect(() => {
    if (!settle) return
    const timer = window.setTimeout(() => setSettle(null), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [settle])

  const tooltip = useHoverDelay(TOOLTIP_DELAY_MS)
  const gesture = usePointerGesture(statePos, {
    onClick: () => send({ type: 'orbClick' }),
    onLongPress: () => {
      tooltip.set(false)
      send({ type: 'orbLongPress' })
    },
    onContextMenu: () => {
      tooltip.set(false)
      send({ type: 'orbContextMenu' })
    },
    onDrag: (p, done) => {
      tooltip.set(false)
      send({ type: 'orbDrag', x: Math.round(p.x), y: Math.round(p.y), done })
      if (done) setSettle(p)
    },
  })

  const center = gesture.dragPos ?? settle ?? statePos
  const orb: OrbBox = { x: center.x, y: center.y, r: look.size / 2 }
  const moving = gesture.dragPos !== null
  useEffect(() => onDragging(moving), [moving, onDragging])

  const showPill = !look.docked && state.pill !== null
  const cardOpts = { clearPill: showPill, dock: look.docked ? state.dockTarget : null }
  const side = sideToward(orb, state.edge, viewport)

  return (
    <div className="ov-root" data-moving={moving || undefined} data-edge={state.edge}>
      <Orb
        orb={state.orb}
        look={look}
        center={center}
        gesture={gesture}
        onActivate={() => send({ type: 'orbClick' })}
        onHoverChange={tooltip.set}
        tooltipId={tooltip.on ? TOOLTIP_ID : undefined}
      />
      {tooltip.on && !moving && !gesture.pressed && (
        <OrbTooltip anchor={tooltipAnchor(orb, viewport)} />
      )}

      {showPill && state.pill && (
        <StudyPill
          pill={state.pill}
          anchor={besideAnchor(orb, side, viewport)}
          onClick={() => send({ type: 'pillClick' })}
        />
      )}
      {state.chip && (
        <SuggestionChip
          chip={state.chip}
          anchor={chipAnchor(orb, viewport, look.docked ? state.dockTarget : null)}
          onClick={() => send({ type: 'chipClick' })}
        />
      )}

      {state.quiz ? (
        <QuizCard
          key={state.quiz.quizId}
          api={api}
          quizId={state.quiz.quizId}
          anchor={cardAnchor(orb, state.edge, viewport, QUIZ_WIDTH, cardOpts)}
          onClose={() => send({ type: 'quizClose' })}
        />
      ) : (
        <ToastStack
          toasts={state.toasts}
          anchor={cardAnchor(orb, state.edge, viewport, TOAST_WIDTH, cardOpts)}
          send={send}
        />
      )}
    </div>
  )
}

/** Hover flag that turns on after a delay and off at once (tooltips). */
function useHoverDelay(delayMs: number): { on: boolean; set: (hovering: boolean) => void } {
  const [on, setOn] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const set = useCallback(
    (hovering: boolean) => {
      window.clearTimeout(timer.current)
      if (hovering) timer.current = window.setTimeout(() => setOn(true), delayMs)
      else setOn(false)
    },
    [delayMs],
  )
  return { on, set }
}
