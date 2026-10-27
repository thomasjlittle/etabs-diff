// Issue #19: the whole review UI against the reference fixtures. Every change in fixtures/diff.json
// shows once in the Element table, lands where a reviewer expects it, and the three levels agree on
// counts and filters. toViewModel.test.ts covers the view model itself; this test reads only the DOM.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { loadFixtures, type RawResult } from './shared/load'
import { toViewModel } from './shared/toViewModel'
import type { ChangeKind, ViewModel } from './shared/viewModel'
import { Shell } from './App'

afterEach(cleanup)

let raw: RawResult
let vm: ViewModel
beforeAll(async () => {
  raw = await loadFixtures()
  vm = toViewModel(raw)
})

// ---------- expectations, written by hand ----------

/** What a reviewer should see for one raw change: change type, Element cell, Story cell,
 *  "Category › Subcategory" and Property. Keyed by `table · id · field` (or `added` / `removed`). */
type Expected = [kind: ChangeKind, element: string, story: string, category: string, property: string]

const RELEASES = 'Assignments › Releases, offsets, insertion points, local axes'

const EXPECTED: Record<string, Expected> = {
  'frames · D3@L3 · added': ['added', 'brace D3', 'L3', 'Objects › Frames', 'Object'],
  'frames · B7@L1 · removed': ['removed', 'beam B7', 'L1', 'Objects › Frames', 'Object'],
  'frames · B1@L1 · props.modI33': ['modified', 'beam B1', 'L1', 'Assignments › Property modifiers', 'I33 modifier'],
  'frames · B4@L3 · props.lineMass': ['modified', 'beam B4', 'L3', 'Loading › Mass Source', 'Line mass'],
  'frames · B5@L2 · props.releaseI': ['modified', 'beam B5', 'L2', RELEASES, 'Release I'],
  'frames · B5@L2 · props.releaseJ': ['modified', 'beam B5', 'L2', RELEASES, 'Release J'],
  'frames · B9@L1 · label': ['renamed', 'beam B9', 'L1', 'Objects › Frames', 'Label'],
  'frames · C2@L1 · section': ['modified', 'column C2', 'L1', 'Assignments › Section assignment', 'Section'],
  'frames · D2@L2 · nodes': ['moved', 'brace D2', 'L2', 'Objects › Frames', 'Nodes'],
  'stories · L3 · elev': ['modified', 'story L3', 'L3', 'Model Settings › Stories & Grids', 'Elevation'],
  'nodes · 3@Base · props.restraint': ['modified', 'joint 3', 'Base', 'Assignments › Restraints & springs', 'props.restraint'],
  'loads · 5@L3|Live|Force|Gravity · added': ['added', 'joint 5', 'L3', 'Loading › Applied Loads', 'Object'],
  'loads · F1@L2|SDL|Uniform|Gravity · values': ['modified', 'slab F1', 'L2', 'Loading › Applied Loads', 'values'],
  'materials · 4000Psi · E': ['modified', 'material 4000Psi', '—', 'Definitions › Materials', 'E'],
  'materials · 4000Psi · fc': ['modified', 'material 4000Psi', '—', 'Definitions › Materials', 'fc'],
  'frameSections · BR1 · t': ['modified', 'frameSection BR1', '—', 'Definitions › Frame Sections', 't'],
  'loadPatterns · EQX · R': ['modified', 'loadPattern EQX', '—', 'Loading › Load Patterns', 'R'],
  'loadCases · EQX · pDelta': ['modified', 'loadCase EQX', '—', 'Analysis › Load Cases', 'pDelta'],
  'combos · 0.9D+E · added': ['added', 'combo 0.9D+E', '—', 'Analysis › Load Combinations', 'Object'],
  'combos · 1.2D+L+E · factors.Live': ['modified', 'combo 1.2D+L+E', '—', 'Analysis › Load Combinations', 'factors.Live'],
  'massSource · MsSrc1 · Live': ['modified', 'massSource MsSrc1', '—', 'Loading › Mass Source', 'Live'],
}

/** Display text for a raw before/after value, as the Element table should show it. */
const shown = (value: unknown) =>
  value == null ? '—' : value === '' ? '""' : typeof value === 'string' ? value : JSON.stringify(value)

/** Every individual change in the raw diff, with the Before / After text expected for modified ones. */
function rawChanges(r: RawResult) {
  const out: { key: string; before?: string; after?: string }[] = []
  for (const [table, set] of [['frames', r.diff.frames] as const, ...Object.entries(r.diff.tables)]) {
    for (const id of set.added) out.push({ key: `${table} · ${id} · added` })
    for (const id of set.removed) out.push({ key: `${table} · ${id} · removed` })
    for (const [id, changes] of Object.entries(set.modified)) {
      for (const c of changes) out.push({ key: `${table} · ${id} · ${c.field}`, before: shown(c.before), after: shown(c.after) })
    }
  }
  return out
}

// ---------- DOM helpers, same conventions as the level tests ----------

const region = (name: string) => screen.getByRole('region', { name })
const bodyRows = () => within(region('Element')).queryAllByRole('row').slice(1) // skip the header row
const cells = (tr: HTMLElement) => within(tr).getAllByRole('cell').map((td) => td.textContent ?? '')
const showing = () => {
  const m = /Showing (\d+) of (\d+) changes?/.exec(region('Element').textContent ?? '')
  expect(m).not.toBeNull()
  return { shown: Number(m![1]), of: Number(m![2]) }
}
/** A Category button is <span>label</span><span>count</span>. */
const labelOf = (button: HTMLElement) => button.firstElementChild?.textContent ?? ''
const countOf = (button: HTMLElement) => Number(button.lastElementChild?.textContent)

const CATEGORY_NAMES = ['Model Settings', 'Definitions', 'Objects', 'Assignments', 'Loading', 'Analysis', 'Design', 'Other']
const categoryButtons = () => CATEGORY_NAMES.flatMap((name) =>
  within(region('Category')).queryAllByRole('button', { name: new RegExp(`^${name} \\d+$`) }).map((button) => ({ name, button })))

describe('review UI on the reference fixtures', () => {
  it('has a hand-written expectation for every raw change, and none left over', () => {
    const keys = rawChanges(raw).map((c) => c.key)
    expect(keys).toHaveLength(21)
    expect(new Set(keys).size).toBe(keys.length)
    expect([...keys].sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  it('shows every raw change exactly once in the Element table, in the expected place', () => {
    render(<Shell vm={vm} />)
    const rendered = bodyRows().map(cells)
    const changes = rawChanges(raw)
    expect(rendered).toHaveLength(changes.length)

    for (const { key, before, after } of changes) {
      const [kind, element, story, category, property] = EXPECTED[key]
      const matches = rendered.filter((c) => c[0] === kind && c[1] === element && c[2] === story
        && c[3] === category && c[4] === property
        && (before === undefined || (c[5] === before && c[6] === after)))
      expect(matches, key).toHaveLength(1)
      if (kind === 'added') expect(matches[0][5], key).toBe('—')
      if (kind === 'removed') expect(matches[0][6], key).toBe('—')
    }
  })

  it('agrees on the total: Summary, Element and the sum of the categories', () => {
    render(<Shell vm={vm} />)
    const total = rawChanges(raw).length
    expect(within(region('Summary')).getByText(/^\d+ changes?$/).textContent).toBe(`${total} changes`)
    expect(showing()).toEqual({ shown: total, of: total })
    const categories = categoryButtons()
    expect(categories.map((c) => c.name)).toEqual(CATEGORY_NAMES.slice(0, 7)) // Other is empty, so hidden
    expect(categories.reduce((n, c) => n + countOf(c.button), 0)).toBe(total)
  })

  it('clicking each Summary group shows exactly its rows, and together the groups cover every row once', () => {
    render(<Shell vm={vm} />)
    const all = bodyRows().map((tr) => cells(tr).join(' | '))
    const groups = within(region('Summary')).getAllByRole('button')
    expect(groups.length).toBeGreaterThan(0)
    const seen: string[] = []

    for (const button of groups) {
      // "312 beams, ..." for a group of many; "Beam B1, ..." for a group of one.
      const count = Number(/^(\d+) /.exec(button.textContent ?? '')?.[1] ?? 1)
      fireEvent.click(button)
      expect(button.getAttribute('aria-pressed'), button.textContent!).toBe('true')
      expect(bodyRows(), button.textContent!).toHaveLength(count)
      expect(showing().shown).toBe(count)
      seen.push(...bodyRows().map((tr) => cells(tr).join(' | ')))
      fireEvent.click(button)
      expect(button.getAttribute('aria-pressed')).toBe('false')
    }
    expect([...seen].sort()).toEqual([...all].sort())
  })

  it('clicking each non-empty subcategory shows exactly its count, matching the expectations', () => {
    render(<Shell vm={vm} />)
    const expectedCounts = new Map<string, number>()
    for (const [, , , category] of Object.values(EXPECTED)) expectedCounts.set(category, (expectedCounts.get(category) ?? 0) + 1)
    const clicked = new Map<string, number>()

    for (const { name, button: categoryButton } of categoryButtons()) {
      let subTotal = 0
      for (const button of within(within(region('Category')).getByRole('list', { name })).getAllByRole('button')) {
        const count = countOf(button)
        subTotal += count
        if (count === 0) continue
        const label = `${name} › ${labelOf(button)}`
        fireEvent.click(button)
        expect(button.getAttribute('aria-pressed'), label).toBe('true')
        expect(bodyRows(), label).toHaveLength(count)
        expect(bodyRows().every((tr) => cells(tr)[3] === label), label).toBe(true)
        expect(within(region('Element')).getByLabelText('Active filter').textContent).toBe(label)
        clicked.set(label, count)
        fireEvent.click(button)
        expect(button.getAttribute('aria-pressed')).toBe('false')
      }
      expect(countOf(categoryButton), name).toBe(subTotal)
    }
    expect(Object.fromEntries(clicked)).toEqual(Object.fromEntries(expectedCounts))
  })
})
