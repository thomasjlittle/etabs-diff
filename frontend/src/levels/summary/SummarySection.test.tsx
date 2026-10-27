// Issue #16: Summary lines, ordering, not-compared items, and the group filter.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { emptyCategories } from '../../shared/categories'
import type { ChangeGroup, ChangeRow, ViewModel } from '../../shared/viewModel'
import { Shell } from '../../App'
import { describeGroup, orderGroups, storyRange } from './describe'

afterEach(cleanup)

const group = (over: Partial<ChangeGroup>): ChangeGroup => ({
  id: 'g', categoryId: 'assignments', subcategoryId: 'assignments/section', kind: 'modified', elementType: 'beam',
  property: 'Section', before: 'W18X35', after: 'W21X44', count: 1, stories: [], rowIds: [], ...over,
})

const row = (id: string, label: string, subcategoryId: string): ChangeRow => ({
  id, elementId: `${label}@L3`, elementType: 'beam', label, story: 'L3', kind: 'modified',
  categoryId: subcategoryId.split('/')[0], subcategoryId,
  property: 'Section', before: 'W18X35', after: 'W21X44', affects: [],
})

describe('describeGroup', () => {
  it('a multi-element group gives count, stories and the change', () => {
    expect(describeGroup(group({ count: 312, stories: ['L5', 'L4', 'L3'] })))
      .toBe('312 beams, L5, L4, L3: Section W18X35 → W21X44')
  })

  it('a group of one names the element', () => {
    expect(describeGroup(group({ stories: ['L5'] }), 'B23')).toBe('Beam B23, L5: Section W18X35 → W21X44')
  })

  it('a definition change shows units and how many elements use it', () => {
    const g = group({ categoryId: 'definitions', subcategoryId: 'definitions/materials', elementType: 'material',
      property: 'E', before: '3605', after: '4030', unit: 'ksi', usedBy: 840 })
    expect(describeGroup(g, '4000Psi')).toBe('Material 4000Psi: E 3605 ksi → 4030 ksi, used by 840 elements')
  })

  it('added, removed and moved say so; renamed shows old and new label; no unit on a missing value', () => {
    expect(describeGroup(group({ kind: 'added', count: 2 }))).toBe('2 beams: added')
    expect(describeGroup(group({ kind: 'moved', elementType: 'column' }), 'C3')).toBe('Column C3: moved')
    expect(describeGroup(group({ kind: 'renamed', before: 'B4', after: 'B9' }), 'B9')).toBe('Beam B9: renamed B4 → B9')
    expect(describeGroup(group({ before: '—', after: '1.2', unit: 'kip' }), 'B4')).toBe('Beam B4: Section — → 1.2 kip')
  })

  it('more than three stories become a range', () => {
    expect(storyRange(['L6', 'L5', 'L4', 'L3'])).toBe('L6–L3 (4 stories)')
  })
})

describe('orderGroups', () => {
  it('follows the 7-category order, then largest first, with Other last', () => {
    const ordered = orderGroups([
      group({ id: 'other', categoryId: 'other', count: 9 }),
      group({ id: 'small', categoryId: 'assignments', count: 1 }),
      group({ id: 'defs', categoryId: 'definitions', count: 1 }),
      group({ id: 'big', categoryId: 'assignments', count: 5 }),
    ])
    expect(ordered.map((g) => g.id)).toEqual(['defs', 'big', 'small', 'other'])
  })
})

describe('SummarySection', () => {
  const rows = [row('r1', 'B1', 'assignments/section'), row('r2', 'B2', 'assignments/section'), row('r3', 'B3', 'assignments/modifiers')]
  const vm: ViewModel = {
    meta: {
      baseline: { file: 'v1.e2k', etabsVersion: '22.1.0' }, revised: { file: 'v2.e2k', etabsVersion: '22.2.0' },
      units: { length: 'in', force: 'kip' }, notCompared: ['$ FUNCTIONS'],
    },
    summary: {
      total: 3,
      groups: [
        group({ id: 'swap', count: 2, stories: ['L3'], rowIds: ['r1', 'r2'] }),
        group({ id: 'mod', subcategoryId: 'assignments/modifiers', property: 'I33 modifier', before: '1', after: '0.35', rowIds: ['r3'] }),
      ],
    },
    categories: emptyCategories(),
    rows,
  }

  it('shows both models, the total, every group and the not-compared sections', () => {
    render(<Shell vm={vm} />)
    const summary = screen.getByRole('region', { name: 'Summary' })
    expect(summary.textContent).toContain('v1.e2k · ETABS 22.1.0')
    expect(summary.textContent).toContain('v2.e2k · ETABS 22.2.0')
    expect(summary.textContent).toContain('3 changes')
    expect(within(summary).getByRole('button', { name: '2 beams, L3: Section W18X35 → W21X44' })).toBeTruthy()
    expect(within(summary).getByRole('button', { name: 'Beam B3: I33 modifier 1 → 0.35' })).toBeTruthy()
    expect(within(summary).getByRole('list', { name: 'Not compared' }).textContent).toContain('$ FUNCTIONS: not compared')
  })

  it('clicking a group shows exactly its rows; clicking again clears the filter', () => {
    render(<Shell vm={vm} />)
    const button = screen.getByRole('button', { name: /^2 beams/ })
    const element = () => screen.getByRole('region', { name: 'Element' }).textContent ?? ''

    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(element()).toContain('B1')
    expect(element()).not.toContain('B3')

    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(element()).toContain('B3')
  })

  it('says so when there are no changes', () => {
    render(<Shell vm={{ ...vm, summary: { total: 0, groups: [] }, rows: [] }} />)
    expect(screen.getByRole('region', { name: 'Summary' }).textContent).toContain('No changes found.')
  })
})
