// Detail panel for the selected element: its type, label, story, grid, match and affects, every
// change to it whatever the filter, the clicked change highlighted, and Close / Escape to clear.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { emptyCategories } from '../../shared/categories'
import type { ChangeGroup, ChangeRow, ViewModel } from '../../shared/viewModel'
import { Shell } from '../../App'

afterEach(cleanup)

const row = (over: Partial<ChangeRow> & Pick<ChangeRow, 'id' | 'subcategoryId'>): ChangeRow => ({
  elementId: 'B23@L5', elementType: 'beam', label: 'B23', story: 'L5', kind: 'modified',
  categoryId: over.subcategoryId.split('/')[0],
  property: 'Section', before: 'W18X35', after: 'W21X44', affects: [], ...over,
})

// B23 has two changes; C3 has one.
const rows: ChangeRow[] = [
  row({ id: 'r1', subcategoryId: 'assignments/section', grid: 'C/4', affects: ['stiffness', 'mass'], matchedBy: 'label' }),
  row({ id: 'r2', subcategoryId: 'assignments/modifiers', property: 'I33 modifier', before: '1', after: '0.35',
    affects: ['stiffness'], matchedBy: 'label' }),
  row({ id: 'r3', subcategoryId: 'objects/frames', elementId: 'C3@L4', elementType: 'column', label: 'C3', story: 'L4',
    kind: 'moved', property: 'Position', before: '(0, 0)', after: '(24, 0)', unit: 'in', affects: ['geometry'],
    matchedBy: 'geometry' }),
]
const groups: ChangeGroup[] = [{
  id: 'g1', categoryId: 'assignments', subcategoryId: 'assignments/section', kind: 'modified', elementType: 'beam',
  property: 'Section', before: 'W18X35', after: 'W21X44', count: 1, stories: ['L5'], rowIds: ['r1'],
}]
const vm: ViewModel = {
  meta: {
    baseline: { file: 'a', etabsVersion: '22' }, revised: { file: 'b', etabsVersion: '22' },
    units: { length: 'in', force: 'kip' }, notCompared: [],
  },
  summary: { total: rows.length, groups },
  categories: emptyCategories(),
  rows,
}

const region = () => screen.getByRole('region', { name: 'Element' })
const bodyRows = () => within(region()).getAllByRole('row').slice(1) // skip the header row
const detail = () => screen.getByRole('region', { name: 'Element detail' })
const queryDetail = () => screen.queryByRole('region', { name: 'Element detail' })
const changes = () => within(within(detail()).getByRole('list', { name: 'Changes to this element' })).getAllByRole('listitem')

describe('ElementDetail', () => {
  it('shows nothing when no row is selected', () => {
    render(<Shell vm={vm} />)
    expect(queryDetail()).toBeNull()
  })

  it('selecting a row opens the panel with that element’s details', () => {
    render(<Shell vm={vm} />)
    fireEvent.click(bodyRows()[2])
    expect(within(detail()).getByRole('heading', { name: 'column C3' })).toBeTruthy()
    const text = detail().textContent
    expect(text).toContain('Typecolumn')
    expect(text).toContain('LabelC3')
    expect(text).toContain('StoryL4')
    expect(text).not.toContain('Grid')
    expect(text).toContain('MatchedBy geometry')
    expect(within(detail()).getByLabelText('Affects').textContent).toBe('geometry')
    expect(changes().map((li) => li.textContent)).toEqual(['Objects › Frames · Position: (0, 0) in → (24, 0) in'])
    expect(changes()[0].getAttribute('aria-current')).toBe('true')
  })

  it('shows the grid when present and lists every change to the element, highlighting the clicked one', () => {
    render(<Shell vm={vm} />)
    fireEvent.click(bodyRows()[1])
    expect(detail().textContent).toContain('GridC/4')
    expect(detail().textContent).toContain('MatchedBy label')
    expect(within(detail()).getByLabelText('Affects').textContent).toBe('stiffnessmass')
    expect(changes().map((li) => li.textContent)).toEqual([
      'Assignments › Section assignment · Section: W18X35 → W21X44',
      'Assignments › Property modifiers · I33 modifier: 1 → 0.35',
    ])
    expect(changes()[0].getAttribute('aria-current')).toBeNull()
    expect(changes()[1].getAttribute('aria-current')).toBe('true')
  })

  it('lists both changes even when a filter hides one', () => {
    render(<Shell vm={vm} />)
    fireEvent.click(screen.getByRole('button', { name: /^Beam B23, L5: Section/ }))
    expect(bodyRows()).toHaveLength(1)
    fireEvent.click(bodyRows()[0])
    expect(changes()).toHaveLength(2)
    expect(changes()[1].textContent).toContain('I33 modifier')
  })

  it('Close clears the selection', () => {
    render(<Shell vm={vm} />)
    fireEvent.click(bodyRows()[0])
    fireEvent.click(within(detail()).getByRole('button', { name: 'Close' }))
    expect(queryDetail()).toBeNull()
    expect(bodyRows()[0].getAttribute('aria-selected')).toBe('false')
  })

  it('Escape clears the selection', () => {
    render(<Shell vm={vm} />)
    fireEvent.click(bodyRows()[0])
    expect(detail()).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(queryDetail()).toBeNull()
    expect(bodyRows()[0].getAttribute('aria-selected')).toBe('false')
  })
})
