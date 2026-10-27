// Issue #14 checks: fixtures load, the shell shows three sections, and the shared filter works.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { checkShape, loadFixtures } from './shared/load'
import { GROUPS, toViewModel } from './shared/toViewModel'
import { initialUiState, uiReducer, visibleRows } from './shared/uiState'
import type { CategoryNode, ElementRow, ViewModel } from './shared/viewModel'
import { emptyCounts } from './shared/viewModel'
import { Shell } from './App'

afterEach(cleanup)

describe('loading', () => {
  it('loads the schema.py fixtures and builds a view model', async () => {
    const vm = toViewModel(await loadFixtures())
    expect(vm.meta.baseline).toBe('model-a.e2k')
    expect(vm.meta.revised).toBe('model-b.e2k')
    expect(vm.summary.map((g) => g.id)).toEqual(GROUPS.map((g) => g[0]))
  })

  it('a file in the wrong format fails with a readable message', () => {
    expect(() => checkShape({ modelA: {}, modelB: {}, diff: {} } as never)).toThrow(/schema.py format/)
  })
})

describe('shell', () => {
  it('shows the three sections, empty', async () => {
    render(<Shell vm={toViewModel(await loadFixtures())} />)
    for (const name of ['Summary', 'Category', 'Element']) expect(screen.getByRole('region', { name })).toBeTruthy()
    expect(screen.getByText('No element changes to show.')).toBeTruthy()
  })
})

// Hand-made rows and categories, since grouping (#15) is not built yet.
const row = (id: string, groupId: string, categoryId: string): ElementRow =>
  ({ id, elementId: id, label: id, kind: 'modified', groupId, categoryId, fields: [], affects: [] })
const node = (id: string, groupId: string, children: CategoryNode[] = []): CategoryNode =>
  ({ id, groupId, label: id, counts: emptyCounts(), children, rowIds: [] })
const rows = [row('r1', 'G1', 'G1/frames'), row('r2', 'G1', 'G1/frames/braces'), row('r3', '1C', '1C/materials')]
const categories = [node('G1/frames', 'G1', [node('G1/frames/braces', 'G1')]), node('1C/materials', '1C')]

describe('shared filter', () => {
  it('group filter keeps that group; category filter includes sub-categories', () => {
    expect(visibleRows(rows, categories, { groupId: 'G1', categoryId: null }).map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(visibleRows(rows, categories, { groupId: 'G1', categoryId: 'G1/frames' }).map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(visibleRows(rows, categories, { groupId: 'G1', categoryId: 'G1/frames/braces' }).map((r) => r.id)).toEqual(['r2'])
    expect(visibleRows(rows, categories, { groupId: null, categoryId: null })).toHaveLength(3)
  })

  it('changing group clears the category', () => {
    let s = uiReducer(initialUiState, { type: 'filter_category', groupId: 'G1', categoryId: 'G1/frames' })
    s = uiReducer(s, { type: 'filter_group', groupId: '1C' })
    expect(s.filter).toEqual({ groupId: '1C', categoryId: null })
  })

  it('a click in Summary filters the Element level', () => {
    const vm: ViewModel = {
      meta: { baseline: 'a', revised: 'b', units: { length: 'in', force: 'kip' } },
      summary: [
        { id: 'G1', title: 'Geometry', tier: 'MVP', counts: emptyCounts(), coverage: 'compared' },
        { id: '1C', title: 'Material', tier: 'MVP', counts: emptyCounts(), coverage: 'compared' },
      ],
      categories,
      rows,
    }
    render(<Shell vm={vm} />)
    fireEvent.click(screen.getByText(/1C Material/))
    const element = screen.getByRole('region', { name: 'Element' })
    expect(element.textContent).toContain('r3')
    expect(element.textContent).not.toContain('r1')
  })
})
