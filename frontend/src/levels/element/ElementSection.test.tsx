// Issue #18: one line per change, filters from Levels 1 and 2 with a clear button, moved and renamed
// rows, units and grid when present, and row selection.
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

// B23 has two changes, so it appears on two lines.
const rows: ChangeRow[] = [
  row({ id: 'r1', subcategoryId: 'assignments/section', grid: 'C/4' }),
  row({ id: 'r2', subcategoryId: 'assignments/modifiers', property: 'I33 modifier', before: '1', after: '0.35' }),
  row({ id: 'r3', subcategoryId: 'objects/frames', elementType: 'column', label: 'C3', story: 'L4', kind: 'moved',
    property: 'Position', before: '(0, 0)', after: '(24, 0)', unit: 'in' }),
  row({ id: 'r4', subcategoryId: 'objects/frames', label: 'B9', story: 'L1', kind: 'renamed',
    property: 'Label', before: 'B4', after: 'B9' }),
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
const cells = (tr: HTMLElement) => within(tr).getAllByRole('cell').map((td) => td.textContent)

describe('ElementSection', () => {
  it('shows one line per change, in the order given, with all columns', () => {
    render(<Shell vm={vm} />)
    expect(bodyRows()).toHaveLength(4)
    expect(cells(bodyRows()[0])).toEqual(['modified', 'beam B23', 'L5 · C/4', 'Assignments › Section assignment', 'Section', 'W18X35', 'W21X44'])
    expect(cells(bodyRows()[1])).toEqual(['modified', 'beam B23', 'L5', 'Assignments › Property modifiers', 'I33 modifier', '1', '0.35'])
    expect(region().textContent).toContain('Showing 4 of 4 changes')
  })

  it('shows moved and renamed rows with their old and new values, and units when given', () => {
    render(<Shell vm={vm} />)
    expect(cells(bodyRows()[2])).toEqual(['moved', 'column C3', 'L4', 'Objects › Frames', 'Position', '(0, 0) in', '(24, 0) in'])
    expect(cells(bodyRows()[3])).toEqual(['renamed', 'beam B9', 'L1', 'Objects › Frames', 'Label', 'B4', 'B9'])
  })

  it('filters by a Summary group, shows the filter, and clears it', () => {
    render(<Shell vm={vm} />)
    fireEvent.click(screen.getByRole('button', { name: /^Beam B23, L5: Section/ }))
    expect(bodyRows()).toHaveLength(1)
    expect(within(region()).getByLabelText('Active filter').textContent).toBe('1 beam · Section')
    expect(region().textContent).toContain('Showing 1 of 4 changes')

    fireEvent.click(within(region()).getByRole('button', { name: 'Clear filter' }))
    expect(bodyRows()).toHaveLength(4)
    expect(within(region()).queryByLabelText('Active filter')).toBeNull()
  })

  it('filters by a Category subcategory', () => {
    render(<Shell vm={vm} />)
    const category = screen.getByRole('region', { name: 'Category' })
    fireEvent.click(within(category).getByRole('button', { name: /^Frames/ }))
    expect(bodyRows().map((tr) => cells(tr)[1])).toEqual(['column C3', 'beam B9'])
    expect(within(region()).getByLabelText('Active filter').textContent).toBe('Objects › Frames')
  })

  it('clicking a row selects it', () => {
    render(<Shell vm={vm} />)
    fireEvent.click(bodyRows()[1])
    expect(bodyRows()[1].getAttribute('aria-selected')).toBe('true')
    expect(bodyRows()[0].getAttribute('aria-selected')).toBe('false')
  })
})
