/**
 * The overlay page: renders OverlayState on a transparent full-screen canvas — the orb with its
 * one timer square under it, the suggestion chip, toasts and the quiz card — and sends
 * OverlayActions back. Renders nothing when the state belongs to another display. Hit areas
 * report hover for click-through.
 */
import type { DumbledoreApi } from '@shared/ipc'
import type { OverlayAction, OverlayState } from '@shared/state'
import { useCallback, useEffect, useState } from 'react'
import { report } from './lib/bridge'
import {
  cardAnchor,
  chipAnchor,
  type OrbBox,
  type Size,
  stackAnchor,
  verticalToward,
} from './lib/layout'
import { useHitAreaHover } from './lib/useHitAreaHover'
import { useOverlayState } from './lib/useOverlayState'
import { type Point, usePointerGesture } from './lib/usePointerGesture'
import { useViewport } from './lib/useViewport'
import { Orb } from './orb/Orb'
import { orbLook } from './orb/orbLook'
import { QUIZ_WIDTH, QuizCard } from './quiz/QuizCard'
import { SuggestionChip } from './satellites/SuggestionChip'
import { TimerButton } from './satellites/TimerButton'
import { TOAST_WIDTH, ToastStack } from './toast/ToastStack'
import './styles/base.css'
import './styles/ui.css'

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

  const gesture = usePointerGesture(statePos, {
    onClick: () => send({ type: 'orbClick' }),
    onLongPress: () => send({ type: 'orbLongPress' }),
    onContextMenu: () => send({ type: 'orbContextMenu' }),
    onDrag: (p, done) => {
      send({ type: 'orbDrag', x: Math.round(p.x), y: Math.round(p.y), done })
      if (done) setSettle(p)
    },
  })

  const center = gesture.dragPos ?? settle ?? statePos
  const orb: OrbBox = { x: center.x, y: center.y, r: look.size / 2 }
  const moving = gesture.dragPos !== null
  useEffect(() => onDragging(moving), [moving, onDragging])

  const cardOpts = { dock: look.docked ? state.dockTarget : null }

  return (
    <div className="ov-root" data-moving={moving || undefined} data-edge={state.edge}>
      <Orb
        orb={state.orb}
        look={look}
        center={center}
        gesture={gesture}
        onActivate={() => send({ type: 'orbClick' })}
      />

      {!look.docked && (
        <TimerButton
          timer={state.timer}
          minutes={state.timerMinutes}
          anchor={stackAnchor(orb, state.edge, viewport)}
          up={verticalToward(orb, state.edge, viewport) === 'up'}
          onStart={(minutes) => send({ type: 'timerStart', minutes })}
          onStop={() => send({ type: 'timerClick' })}
          onLongPress={() => send({ type: 'orbLongPress' })}
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
