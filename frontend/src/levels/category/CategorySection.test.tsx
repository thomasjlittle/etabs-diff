// Issue #17: all 7 categories with counts (0 shown), Other only when used, used-by for definitions,
// and the category / subcategory filter.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { emptyCategories } from '../../shared/categories'
import type { CategoryNode, ChangeGroup, ChangeRow, ViewModel } from '../../shared/viewModel'
import { Shell } from '../../App'

afterEach(cleanup)

const row = (id: string, label: string, subcategoryId: string): ChangeRow => ({
  id, elementId: label, elementType: 'beam', label, kind: 'modified',
  categoryId: subcategoryId.split('/')[0], subcategoryId,
  property: 'p', before: '1', after: '2', affects: [],
})

/** The empty tree with counts and rowIds filled from the rows, as #15 will do. */
function categoriesFor(rows: ChangeRow[]): CategoryNode[] {
  return emptyCategories().map((c) => {
    const subcategories = c.subcategories.map((s) => {
      const rowIds = rows.filter((r) => r.subcategoryId === s.id).map((r) => r.id)
      return { ...s, rowIds, count: rowIds.length }
    })
    return { ...c, subcategories, count: subcategories.reduce((n, s) => n + s.count, 0) }
  })
}

const rows = [
  row('r1', 'B1', 'assignments/section'),
  row('r2', 'B2', 'assignments/modifiers'),
  { ...row('r3', '4000Psi', 'definitions/materials'), elementType: 'material' },
  { ...row('r4', '4000Psi', 'definitions/materials'), elementType: 'material', property: 'Fy' },
]
const defGroup = (id: string, rowId: string): ChangeGroup => ({
  id, categoryId: 'definitions', subcategoryId: 'definitions/materials', kind: 'modified', elementType: 'material',
  property: 'E', before: '1', after: '2', count: 1, stories: [], rowIds: [rowId], usedBy: 840,
})

const vmFor = (rs: ChangeRow[], groups: ChangeGroup[] = []): ViewModel => ({
  meta: {
    baseline: { file: 'a', etabsVersion: '22' }, revised: { file: 'b', etabsVersion: '22' },
    units: { length: 'in', force: 'kip' }, notCompared: [],
  },
  summary: { total: rs.length, groups },
  categories: categoriesFor(rs),
  rows: rs,
})

const category = () => screen.getByRole('region', { name: 'Category' })
const element = () => screen.getByRole('region', { name: 'Element' }).textContent ?? ''

describe('CategorySection', () => {
  it('shows the 7 categories in order with counts, including 0, and hides an empty Other', () => {
    render(<Shell vm={vmFor(rows)} />)
    const names = ['Model Settings', 'Definitions', 'Objects', 'Assignments', 'Loading', 'Analysis', 'Design']
    const buttons = names.map((name) => within(category()).getByRole('button', { name: new RegExp(`^${name}\\d+$`) }))
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Model Settings0', 'Definitions2', 'Objects0', 'Assignments2', 'Loading0', 'Analysis0', 'Design0',
    ])
    expect(within(category()).getByRole('button', { name: 'Section assignment1' })).toBeTruthy()
    expect(within(category()).getByRole('button', { name: 'Meshing0' })).toBeTruthy()
    expect(within(category()).queryByRole('button', { name: /^Other/ })).toBeNull()
  })

  it('shows Other when a change landed in it', () => {
    render(<Shell vm={vmFor([...rows, row('r9', 'X', 'other/uncategorized')])} />)
    expect(within(category()).getByRole('button', { name: 'Other1' })).toBeTruthy()
  })

  it('lists each changed definition once with how many elements use it', () => {
    render(<Shell vm={vmFor(rows, [defGroup('gE', 'r3'), defGroup('gFy', 'r4')])} />)
    const list = within(category()).getByRole('list', { name: 'Materials changed' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['4000Psi: used by 840 elements'])
  })

  it('clicking a category, then a subcategory, filters the Element level; clicking again clears', () => {
    render(<Shell vm={vmFor(rows)} />)
    const assignments = within(category()).getByRole('button', { name: 'Assignments2' })
    const modifiers = within(category()).getByRole('button', { name: 'Property modifiers1' })

    fireEvent.click(assignments)
    expect(assignments.getAttribute('aria-pressed')).toBe('true')
    expect(element()).toContain('B1')
    expect(element()).toContain('B2')
    expect(element()).not.toContain('4000Psi')

    fireEvent.click(modifiers)
    expect(modifiers.getAttribute('aria-pressed')).toBe('true')
    expect(assignments.getAttribute('aria-pressed')).toBe('false')
    expect(element()).toContain('B2')
    expect(element()).not.toContain('B1')

    fireEvent.click(modifiers)
    expect(modifiers.getAttribute('aria-pressed')).toBe('false')
    expect(element()).toContain('4000Psi')
  })
})
