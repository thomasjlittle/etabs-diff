// Issue #14 / #15 PR 1 checks: fixtures load, the shell shows three sections with the full category
// tree, and the shared filter works.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { checkShape, loadFixtures } from './shared/load'
import { CATEGORIES, OTHER, emptyCategories } from './shared/categories'
import { toViewModel } from './shared/toViewModel'
import { initialUiState, uiReducer, visibleRows, type Filter } from './shared/uiState'
import type { ChangeGroup, ChangeRow, ViewModel } from './shared/viewModel'
import { Shell } from './App'

afterEach(cleanup)

describe('loading', () => {
  it('loads the schema.py fixtures and builds a view model', async () => {
    const vm = toViewModel(await loadFixtures())
    expect(vm.meta.baseline).toEqual({ file: 'model-a.e2k', etabsVersion: '22.1.0' })
    expect(vm.meta.revised.file).toBe('model-b.e2k')
    expect(vm.meta.notCompared).toEqual(['$ DESIGN PREFERENCES', '$ FUNCTIONS'])
  })

  it('a file in the wrong format fails with a readable message', () => {
    expect(() => checkShape({ modelA: {}, modelB: {}, diff: {} } as never)).toThrow(/schema.py format/)
  })
})

describe('categories', () => {
  it('lists the 7 categories in order, then Other, all with zero counts', () => {
    const tree = emptyCategories()
    expect(tree.map((c) => c.label)).toEqual([
      'Model Settings', 'Definitions', 'Objects', 'Assignments', 'Loading', 'Analysis', 'Design', 'Other',
    ])
    for (const c of tree) {
      expect(c.count).toBe(0)
      for (const s of c.subcategories) expect(s.count).toBe(0)
    }
  })

  it('subcategory ids are unique and prefixed by their category', () => {
    const ids = [...CATEGORIES, OTHER].flatMap((c) => c.subcategories.map((s) => {
      expect(s.id.startsWith(`${c.id}/`)).toBe(true)
      return s.id
    }))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('shell', () => {
  it('shows the three sections, with the category tree and no element changes', async () => {
    const raw = await loadFixtures()
    raw.diff = { frames: { added: [], removed: [], modified: {}, matchedBy: {} }, tables: {} }
    render(<Shell vm={toViewModel(raw)} />)
    for (const name of ['Summary', 'Category', 'Element']) expect(screen.getByRole('region', { name })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Category' }).textContent).toContain('Assignments')
    expect(screen.getByText('No element changes to show.')).toBeTruthy()
  })
})

// Hand-made rows and groups isolate filter behavior from fixture mapping.
const row = (id: string, subcategoryId: string): ChangeRow => ({
  id, elementId: id, elementType: 'beam', label: id, kind: 'modified',
  categoryId: subcategoryId.split('/')[0], subcategoryId,
  property: 'Section', before: 'W18X35', after: 'W21X44', affects: [],
})
const rows = [row('r1', 'assignments/section'), row('r2', 'assignments/section'), row('r3', 'assignments/modifiers'), row('r4', 'definitions/materials')]
const group = (id: string, rowIds: string[]): ChangeGroup => ({
  id, categoryId: 'assignments', subcategoryId: 'assignments/section', kind: 'modified', elementType: 'beam',
  property: 'Section', before: 'W18X35', after: 'W21X44', count: rowIds.length, stories: [], rowIds,
})
const groups = [group('g1', ['r1', 'r2']), group('g2', ['r4'])]
const noFilter: Filter = { groupId: null, categoryId: null, subcategoryId: null }

describe('shared filter', () => {
  it('filters by group, category or subcategory', () => {
    const ids = (f: Partial<Filter>) => visibleRows(rows, groups, { ...noFilter, ...f }).map((r) => r.id)
    expect(ids({ groupId: 'g1' })).toEqual(['r1', 'r2'])
    expect(ids({ categoryId: 'assignments' })).toEqual(['r1', 'r2', 'r3'])
    expect(ids({ categoryId: 'assignments', subcategoryId: 'assignments/modifiers' })).toEqual(['r3'])
    expect(ids({})).toHaveLength(4)
  })

  it('one filter at a time: picking a group clears the category, and the other way round', () => {
    let s = uiReducer(initialUiState, { type: 'filter_subcategory', categoryId: 'assignments', subcategoryId: 'assignments/section' })
    s = uiReducer(s, { type: 'filter_group', groupId: 'g1' })
    expect(s.filter).toEqual({ ...noFilter, groupId: 'g1' })
    s = uiReducer(s, { type: 'filter_category', categoryId: 'definitions' })
    expect(s.filter).toEqual({ ...noFilter, categoryId: 'definitions' })
  })

  it('a click in Summary filters the Element level', () => {
    const vm: ViewModel = {
      meta: {
        baseline: { file: 'a', etabsVersion: '22' }, revised: { file: 'b', etabsVersion: '22' },
        units: { length: 'in', force: 'kip' }, notCompared: [],
      },
      summary: { total: rows.length, groups },
      categories: emptyCategories(),
      rows,
    }
    render(<Shell vm={vm} />)
    fireEvent.click(screen.getByRole('button', { name: /^2 beam/ }))
    const element = screen.getByRole('region', { name: 'Element' })
    expect(element.textContent).toContain('r1')
    expect(element.textContent).not.toContain('r3')
  })
})
