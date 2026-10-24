/** Design-system component tests: behaviour and accessibility of the building blocks. */
import type { Question } from '@shared/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import '../../lib/test-utils'
import { Button } from '../components/Button'
import { Checkbox } from '../components/Checkbox'
import { Choices } from '../components/Choices'
import { EmptyState, ErrorState, LoadingState } from '../components/Feedback'
import { PageHeader } from '../components/Page'
import { Popover } from '../components/Popover'
import { ProgressBar } from '../components/ProgressBar'
import { QuizQuestion } from '../components/QuizQuestion'
import { RadioGroup, RadioRow } from '../components/RadioRow'
import { Tag } from '../components/Tag'
import { ToggleBlock } from '../components/ToggleBlock'

describe('Button', () => {
  it('calls onClick and shows the shortcut hint', () => {
    const onClick = vi.fn()
    render(
      <Button variant="primary" shortcut="⌘E" onClick={onClick}>
        New exam
      </Button>,
    )
    fireEvent.click(screen.getByRole('button', { name: /new exam/i }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.getByText('⌘E')).toBeTruthy()
  })

  it('is disabled and busy while loading', () => {
    render(<Button loading>Save</Button>)
    const btn = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-busy')).toBe('true')
  })
})

describe('Tag & ProgressBar', () => {
  it('renders a coloured tag', () => {
    render(<Tag color="red">Struggling</Tag>)
    expect(screen.getByText('Struggling').className).toContain('dd-tag--red')
  })

  it('exposes progress to assistive tech', () => {
    render(<ProgressBar value={0.724} showValue label="Roadmap progress" />)
    const bar = screen.getByRole('progressbar', { name: 'Roadmap progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe('72')
    expect(screen.getByText('72%')).toBeTruthy()
  })
})

describe('Checkbox, RadioRow, Choices', () => {
  it('toggles a checkbox', () => {
    const onChange = vi.fn()
    render(<Checkbox checked={false} onCheckedChange={onChange} label="Leaving groups" />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Leaving groups' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('moves selection with arrow keys in a radio group', () => {
    const onSelect = vi.fn()
    render(
      <RadioGroup label="Focus">
        <RadioRow checked onSelect={() => onSelect('weak')}>
          Weak spots
        </RadioRow>
        <RadioRow checked={false} onSelect={() => onSelect('due')}>
          Due
        </RadioRow>
      </RadioGroup>,
    )
    const first = screen.getByRole('radio', { name: /weak spots/i })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(onSelect).toHaveBeenLastCalledWith('due')
  })

  it('picks a choice', () => {
    const onChange = vi.fn()
    render(
      <Choices
        label="Questions"
        value={5}
        options={[
          { value: 5, label: '5' },
          { value: 10, label: '10' },
        ]}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: '10' }))
    expect(onChange).toHaveBeenCalledWith(10)
  })
})

describe('ToggleBlock', () => {
  it('reveals its content', () => {
    render(<ToggleBlock title="Prompt">Explain carbocations</ToggleBlock>)
    expect(screen.queryByText('Explain carbocations')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /prompt/i }))
    expect(screen.getByText('Explain carbocations')).toBeTruthy()
  })
})

describe('States', () => {
  it('loading state announces its specific caption', () => {
    render(<LoadingState caption="Reading your notes on SN1…" />)
    expect(screen.getByRole('status').textContent).toContain('Reading your notes on SN1…')
  })

  it('empty and error states', () => {
    const retry = vi.fn()
    render(
      <>
        <EmptyState title="Nothing due" />
        <ErrorState error={new Error('Engine offline')} onRetry={retry} />
      </>,
    )
    expect(screen.getByText('Nothing due')).toBeTruthy()
    expect(screen.getByText('Engine offline')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(retry).toHaveBeenCalled()
  })
})

describe('QuizQuestion', () => {
  const question: Question = {
    id: 'q1',
    conceptId: null,
    conceptName: 'Carbocation stability',
    stem: 'Which carbocation is the most stable?',
    options: ['Methyl', 'Primary (1°)', 'Secondary (2°)', 'Tertiary (3°).'],
    correctIndex: 3,
    rationales: ['No donors.', 'One donor.', 'Two donors.', 'Three donors.'],
    difficulty: 1,
    carriedFrom: null,
  }

  it('quotes the right option when the answer is wrong (rows have no letters)', () => {
    render(
      <QuizQuestion
        index={0}
        question={question}
        chosenIndex={1}
        result={{ correct: false, correctIndex: 3 }}
      />,
    )
    const note = screen.getByRole('status').textContent ?? ''
    expect(note).toContain('Not quite. The answer is “Tertiary (3°)”. This one comes back')
    expect(note).not.toMatch(/answer is [A-D]\b/)
    expect(screen.getByRole('radio', { name: /Tertiary/ }).getAttribute('data-tone')).toBe(
      'correct',
    )
  })

  it('praises a right answer', () => {
    render(
      <QuizQuestion
        index={0}
        question={question}
        chosenIndex={3}
        result={{ correct: true, correctIndex: 3 }}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('Correct.')
  })
})

describe('PageHeader icon', () => {
  it('is decorative by default', () => {
    const { container } = render(<PageHeader icon="🧪" title="Organic Chemistry" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('.dd-page-header__icon')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
  })

  it('becomes a labelled button with onIconClick', () => {
    const onIconClick = vi.fn()
    render(
      <PageHeader
        icon="🧪"
        iconLabel="Change icon"
        iconExpanded={false}
        onIconClick={onIconClick}
        title="Organic Chemistry"
      />,
    )
    const button = screen.getByRole('button', { name: 'Change icon' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(onIconClick).toHaveBeenCalledOnce()
  })
})

/** PageHeader icon button + an anchored Popover, wired like the subject page. */
function Anchored() {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <PageHeader
        icon="🧪"
        iconRef={ref}
        iconExpanded={open}
        onIconClick={() => setOpen((o) => !o)}
        title="Organic Chemistry"
      />
      <Popover anchor={ref} open={open} onOpenChange={setOpen} label="Choose an icon">
        <button type="button">Use 🧬</button>
      </Popover>
    </>
  )
}

describe('Popover anchor', () => {
  it('opens on the anchor, toggles closed from it and gives focus back on Escape', async () => {
    const user = userEvent.setup()
    render(<Anchored />)
    const icon = screen.getByRole('button', { name: 'Change icon' })
    await user.click(icon)
    expect(screen.getByRole('dialog', { name: 'Choose an icon' })).toBeTruthy()
    await user.click(icon)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(icon.getAttribute('aria-expanded')).toBe('false')
    await user.click(icon)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(icon))
  })
})
