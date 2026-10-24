/**
 * Study picker (#/picker, PLAN F2 step 3): "What do you want to learn?" plus the subjects the
 * engine ranks (session.picker), each with its extracted study questions. Choosing one — or
 * typing anything — calls session.start; the panel then closes so main can paste step 1.
 * Keys: ↑↓ move, Enter starts, Esc closes the window.
 */
import { Kbd, SpectaclesGlyph } from '@renderer/design-system'
import { useAction, useAppState, usePicker } from '@renderer/lib/queries'
import { type KeyboardEvent, useId, useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { closePanel, useEscape } from '../panel-actions'
import { SectionError, SectionLoading } from '../Section'
import { optionDomId, PickerList } from './PickerList'
import './picker.css'
import { buildOptions, moveIndex, type PickerOption, toStartInput } from './picker-options'

export function Picker() {
  const picker = usePicker()
  const app = useAppState()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [chosen, setChosen] = useState<string | null>(null)
  const [, navigate] = useLocation()
  const start = useAction('session.start')
  const listId = useId()
  useEscape(closePanel)

  const options = useMemo(() => buildOptions(picker.data, query), [picker.data, query])
  const index = Math.min(active, Math.max(0, options.length - 1))
  const current = options[index]

  const choose = (option: PickerOption) => {
    if (start.isPending) return
    setChosen(option.id)
    start.mutate(toStartInput(option), {
      onSuccess: () => {
        closePanel()
        navigate('/')
      },
      onSettled: () => setChosen(null),
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(moveIndex(index, e.key === 'ArrowDown' ? 1 : -1, options.length))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (current) choose(current)
    }
  }

  const noSubjects = picker.data !== undefined && picker.data.subjects.length === 0
  const provider = app.data?.aiChat?.provider ?? null

  return (
    <div className="pn-card pn-picker" data-view="picker">
      <div className="pn-picker__head">
        <SpectaclesGlyph size={22} className="pn-picker__glyph" />
        <input
          className="pn-picker__input"
          value={query}
          placeholder="What do you want to learn?"
          aria-label="What do you want to learn?"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={current ? optionDomId(listId, current) : undefined}
          // biome-ignore lint/a11y/noAutofocus: the picker opens to be typed into
          autoFocus
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="pn-picker__body">
        {!query && options.length > 0 ? (
          <div className="pn-picker__label">Your subjects</div>
        ) : null}
        {picker.isLoading ? (
          <SectionLoading lines={3} label="Finding what you were studying" />
        ) : null}
        {picker.error ? <SectionError error={picker.error} /> : null}
        <PickerList
          id={listId}
          options={options}
          active={index}
          chosen={chosen}
          onHover={setActive}
          onChoose={choose}
        />
        {start.error ? (
          <p className="pn-note pn-note--error" role="alert">
            {start.error.message}
          </p>
        ) : null}
        {!query && !picker.isLoading ? (
          <p className="pn-picker__hint">
            {noSubjects
              ? 'Type anything you want to learn — Dumbledore builds a roadmap from scratch.'
              : 'Or type anything you want to learn…'}
          </p>
        ) : null}
      </div>
      <footer className="pn-picker__foot">
        <span>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> choose
        </span>
        <span>
          <Kbd>↵</Kbd> start
        </span>
        <span>
          <Kbd>esc</Kbd> close
        </span>
        {provider ? <span className="pn-picker__target">Prompts go to {provider}</span> : null}
      </footer>
    </div>
  )
}
