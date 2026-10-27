import { describe, expect, it } from 'vitest'
import { loadFixtures, type RawResult } from './load'
import { toViewModel } from './toViewModel'
import { displayValue, propertyLabel, subcategoryFor } from './changeMapping'
import type { Change, SetDiff } from '../types'

const change = (field: string, before: unknown = 1, after: unknown = 2): Change =>
  ({ field, before, after, affects: ['stiffness'] })
const modified = (id: string, changes: Change[]): SetDiff => ({ added: [], removed: [], modified: { [id]: changes } })
async function emptyDiff(): Promise<RawResult> {
  const raw = await loadFixtures()
  return { ...raw, diff: { frames: { added: [], removed: [], modified: {}, matchedBy: {} }, tables: {} } }
}

describe('reference fixture mapping', () => {
  it('puts every individual change in exactly one subcategory and one group', async () => {
    const raw = await loadFixtures()
    const vm = toViewModel(raw)
    const sets = [raw.diff.frames, ...Object.values(raw.diff.tables)]
    const expectedTotal = sets.reduce((n, set) => n + set.added.length + set.removed.length
      + Object.values(set.modified).reduce((sum, changes) => sum + changes.length, 0), 0)
    expect(expectedTotal).toBe(21)
    expect(vm.rows).toHaveLength(expectedTotal)
    expect(new Set(vm.rows.map((r) => r.id)).size).toBe(expectedTotal)
    for (const set of sets) {
      for (const id of set.added) expect(vm.rows.filter((r) => r.elementId === id && r.kind === 'added')).toHaveLength(1)
      for (const id of set.removed) expect(vm.rows.filter((r) => r.elementId === id && r.kind === 'removed')).toHaveLength(1)
      for (const [id, changes] of Object.entries(set.modified)) {
        for (const change of changes) {
          expect(vm.rows.filter((r) => r.elementId === id && r.property === propertyLabel(change.field)
            && r.before === displayValue(change.before) && r.after === displayValue(change.after))).toHaveLength(1)
        }
      }
    }
    const assigned = vm.categories.flatMap((c) => c.subcategories.flatMap((s) => s.rowIds))
    const grouped = vm.summary.groups.flatMap((g) => g.rowIds)
    for (const row of vm.rows) {
      expect(assigned.filter((id) => id === row.id)).toHaveLength(1)
      expect(grouped.filter((id) => id === row.id)).toHaveLength(1)
      const sub = vm.categories.find((c) => c.id === row.categoryId)!.subcategories
        .find((s) => s.id === row.subcategoryId)!
      expect(sub.rowIds).toContain(row.id)
      expect(vm.summary.groups.find((g) => g.id === row.groupId)!.rowIds).toContain(row.id)
    }
    // An element's two releases must remain two independent changes.
    expect(vm.rows.filter((r) => r.elementId === 'B5@L2').map((r) => r.property).sort())
      .toEqual(['Release I', 'Release J'])
  })

  it('category counts sum their subcategories and the summary counts rows', async () => {
    const vm = toViewModel(await loadFixtures())
    for (const category of vm.categories) {
      expect(category.count).toBe(category.subcategories.reduce((sum, sub) => sum + sub.count, 0))
      for (const sub of category.subcategories) expect(sub.count).toBe(sub.rowIds.length)
    }
    expect(vm.summary.total).toBe(vm.rows.length)
    expect(vm.categories.reduce((sum, c) => sum + c.count, 0)).toBe(vm.rows.length)
    expect(vm.summary.groups.reduce((sum, g) => sum + g.count, 0)).toBe(vm.rows.length)
    expect(Object.fromEntries(vm.categories.map((c) => [c.id, c.count]))).toEqual({
      modelSettings: 1, definitions: 3, objects: 4, assignments: 5, loading: 5, analysis: 3, design: 0, other: 0,
    })
  })

  it('maps the fixture properties, move, rename, matches and impacts', async () => {
    const vm = toViewModel(await loadFixtures())
    const row = (id: string) => vm.rows.find((r) => r.elementId === id)!
    expect(row('C2@L1')).toMatchObject({ categoryId: 'assignments', subcategoryId: 'assignments/section',
      elementType: 'column', property: 'Section', before: 'W14X90', after: 'W14X120', affects: ['stiffness', 'mass'] })
    expect(row('B1@L1')).toMatchObject({ subcategoryId: 'assignments/modifiers', property: 'I33 modifier' })
    expect(row('B4@L3')).toMatchObject({ subcategoryId: 'loading/massSource', before: '—', after: '0.0000012' })
    expect(row('B9@L1')).toMatchObject({ kind: 'renamed', label: 'B9', before: 'B4', after: 'B9', matchedBy: 'geometry' })
    expect(row('D2@L2')).toMatchObject({ kind: 'moved', subcategoryId: 'objects/frames', matchedBy: 'label' })
    expect(row('B7@L1')).toMatchObject({ kind: 'removed', label: 'B7', elementType: 'beam', story: 'L1', after: '—' })
    expect(row('D3@L3')).toMatchObject({ kind: 'added', elementType: 'brace', before: '—' })
    expect(row('3@Base')).toMatchObject({ elementType: 'joint', subcategoryId: 'assignments/restraints' })
    expect(row('F1@L2|SDL|Uniform|Gravity')).toMatchObject({ elementType: 'slab', label: 'F1', story: 'L2',
      subcategoryId: 'loading/applied', before: '[0.000139]', after: '[0.000208]' })
    expect(row('5@L3|Live|Force|Gravity')).toMatchObject({ elementType: 'joint', label: '5', story: 'L3' })
  })

  it('counts section users and material users through sections without expanding definition rows', async () => {
    const vm = toViewModel(await loadFixtures())
    const materials = vm.rows.filter((r) => r.elementId === '4000Psi')
    expect(materials).toHaveLength(2) // E and fc, not 2 changes for each slab.
    for (const row of materials) expect(vm.summary.groups.find((g) => g.id === row.groupId)!.usedBy).toBe(6)
    const section = vm.rows.find((r) => r.elementId === 'BR1')!
    expect(vm.summary.groups.find((g) => g.id === section.groupId)!.usedBy).toBe(3)
    expect(vm.summary.groups.filter((g) => g.categoryId !== 'definitions').every((g) => g.usedBy === undefined)).toBe(true)
  })

  it('orders stories top down, then labels, and leaves model input unchanged', async () => {
    const raw = await loadFixtures()
    const before = JSON.stringify(raw)
    const vm = toViewModel(raw)
    expect([...new Set(vm.rows.map((r) => r.story))]).toEqual(['L3', 'L2', 'L1', 'Base', undefined])
    for (const story of raw.modelB.stories) {
      const labels = vm.rows.filter((r) => r.story === story.name).map((r) => r.label)
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
    }
    expect(toViewModel(raw)).toEqual(vm)
    expect(JSON.stringify(raw)).toBe(before)
  })
})

describe('mapping beyond the reference changes', () => {
  it.each([
    ['frames', 'props.offsetI', 'assignments/releases'],
    ['frames', 'props.endOffsetJ', 'assignments/releases'],
    ['frames', 'props.insertionPoint', 'assignments/releases'],
    ['frames', 'props.localAxis', 'assignments/releases'],
    ['nodes', 'props.spring', 'assignments/restraints'],
    ['areas', 'props.modM11', 'assignments/modifiers'],
    ['areas', 'props.diaphragm', 'assignments/diaphragms'],
    ['areas', 'props.autoMesh', 'assignments/meshing'],
    ['areas', 'props.pier', 'assignments/labels'],
    ['areas', 'props.spandrel', 'assignments/labels'],
    ['frames', 'props.group', 'assignments/labels'],
    ['nodes', 'props.addedMass', 'loading/massSource'],
    ['areas', 'props.areaMass', 'loading/massSource'],
    ['areas', 'section', 'assignments/section'],
    ['shellSections', 'thickness', 'definitions/shellSections'],
    ['functions', 'period', 'definitions/functions'],
    ['pointSprings', 'stiffness', 'definitions/linkProps'],
    ['options', 'units', 'modelSettings/options'],
    ['analysisOptions', 'solver', 'analysis/options'],
    ['designPreferences', 'code', 'design/preferences'],
    ['designOverwrites', 'factor', 'design/overwrites'],
    ['designCombos', 'factor', 'design/combosGroups'],
    ['frames', 'props.unknown', 'other/uncategorized'],
    ['mystery', 'section', 'other/uncategorized'],
    ['constructor', 'section', 'other/uncategorized'],
    ['toString', 'section', 'other/uncategorized'],
  ])('maps %s / %s to %s', (table, field, expected) => {
    expect(subcategoryFor(table, field)).toBe(expected)
  })

  it('retains unknown modified properties and added/removed records even without model data', async () => {
    const raw = await emptyDiff()
    raw.diff.frames.modified['B1@L1'] = [change('props.unknown'), change('unknown')]
    raw.diff.tables.mystery = { added: ['new'], removed: ['old'], modified: { existing: [change('foo')] } }
    const vm = toViewModel(raw)
    expect(vm.rows).toHaveLength(5)
    expect(vm.categories.find((c) => c.id === 'other')!.count).toBe(5)
    expect(vm.rows.every((r) => r.subcategoryId === 'other/uncategorized')).toBe(true)
    expect(vm.rows.find((r) => r.elementId === 'new')).toMatchObject({ before: '—', after: 'new' })
    expect(vm.rows.find((r) => r.elementId === 'old')).toMatchObject({ before: 'old', after: '—' })
  })

  it('keeps zero-count categories for an empty diff and preserves not-compared metadata', async () => {
    const raw = await emptyDiff()
    raw.modelB = { ...raw.modelB, unparsed: ['$ FUNCTIONS', '$ NEW'] }
    const vm = toViewModel(raw)
    expect(vm.rows).toEqual([])
    expect(vm.summary).toEqual({ total: 0, groups: [] })
    expect(vm.categories).toHaveLength(8)
    expect(vm.categories.every((c) => c.count === 0 && c.subcategories.every((s) => s.count === 0))).toBe(true)
    expect(vm.meta.notCompared).toEqual(['$ DESIGN PREFERENCES', '$ FUNCTIONS', '$ NEW'])
  })

  it('uses the baseline story, label and type for removed joints and shells', async () => {
    const raw = await emptyDiff()
    raw.diff.tables.nodes = { added: [], removed: ['3@Base'], modified: {} }
    raw.diff.tables.areas = { added: [], removed: ['F1@L1'], modified: {} }
    const vm = toViewModel(raw)
    expect(vm.rows.find((r) => r.elementId === '3@Base')).toMatchObject({ elementType: 'joint', story: 'Base',
      label: '3', subcategoryId: 'objects/joints', kind: 'removed' })
    expect(vm.rows.find((r) => r.elementId === 'F1@L1')).toMatchObject({ elementType: 'slab', story: 'L1',
      label: 'F1', subcategoryId: 'objects/shells', kind: 'removed' })
  })

  it('places a removed story between surviving stories according to its model elevation', async () => {
    const raw = await emptyDiff()
    raw.modelB = { ...raw.modelB, stories: raw.modelB.stories.filter((s) => s.name !== 'L2') }
    raw.diff.tables.stories = { added: [], removed: ['L2'], modified: { L1: [change('elev')], L3: [change('elev')] } }
    expect(toViewModel(raw).rows.map((r) => r.story)).toEqual(['L3', 'L2', 'L1'])
  })
})

describe('identical-change groups and definition usage', () => {
  it('groups on all five specified fields, keeps singleton groups and orders group stories', async () => {
    const raw = await emptyDiff()
    raw.diff.frames.modified = {
      'B1@L1': [change('props.modI33')], 'B2@L1': [change('props.modI33')],
      'B1@L3': [change('props.modI33')], 'B1@L2': [change('props.modI33')],
      'C1@L1': [change('props.modI33')], // Different element type.
      'B3@L1': [change('props.modI22')], // Different property.
      'B4@L1': [change('props.modI33', 0, 2)], // Different before value.
      'B5@L1': [change('props.modI33', 1, 3)], // Different after value.
    }
    const vm = toViewModel(raw)
    const group = vm.summary.groups.find((g) => g.count === 4)!
    expect(group).toMatchObject({ elementType: 'beam', property: 'I33 modifier', before: '1', after: '2',
      stories: ['L3', 'L2', 'L1'] })
    expect(group.rowIds.map((id) => vm.rows.find((r) => r.id === id)!.elementId))
      .toEqual(['B1@L3', 'B1@L2', 'B1@L1', 'B2@L1'])
    expect(vm.summary.groups).toHaveLength(5)
    expect(vm.summary.groups.filter((g) => g.count === 1)).toHaveLength(4)
  })

  it('canonicalizes object values without conflating absent, empty, zero and false values', () => {
    expect(displayValue({ z: 1, a: { y: 2, b: 3 } })).toBe(displayValue({ a: { b: 3, y: 2 }, z: 1 }))
    expect([null, undefined, '', 0, false].map(displayValue)).toEqual(['—', '—', '""', '0', 'false'])
  })

  it('unions users of grouped definitions, includes direct material use and does not count it twice', async () => {
    const raw = await emptyDiff()
    const shell = raw.modelB.areas[0]
    raw.modelB = { ...raw.modelB, areas: raw.modelB.areas.map((area) => area.id === shell.id
      ? { ...area, props: { ...area.props, material: '4000Psi' } } : area),
    nodes: raw.modelB.nodes.map((node, i) => i === 0 ? { ...node, props: { ...node.props, material: '4000Psi' } } : node) }
    raw.diff.tables.materials = {
      added: [], removed: [], modified: { '4000Psi': [change('E')], A500GrC: [change('E')] },
    }
    const vm = toViewModel(raw)
    expect(vm.rows).toHaveLength(2)
    expect(vm.summary.groups).toHaveLength(1)
    expect(vm.summary.groups[0]).toMatchObject({ count: 2, usedBy: 10 }) // 6 slabs + 1 joint + 3 braces.
  })

  it('counts shell sections, unused definitions and removed definitions on the correct side', async () => {
    const raw = await emptyDiff()
    raw.modelB = { ...raw.modelB, frames: raw.modelB.frames.filter((f) => f.section !== 'BR1') }
    raw.diff.tables.frameSections = { added: [], removed: ['BR1'], modified: { unused: [change('t')] } }
    raw.diff.tables.shellSections = modified('Slab8', [change('thickness')])
    const vm = toViewModel(raw)
    const usage = (id: string) => vm.summary.groups.find((g) => g.rowIds.includes(vm.rows.find((r) => r.elementId === id)!.id))!.usedBy
    expect(usage('BR1')).toBe(2)
    expect(usage('Slab8')).toBe(6)
    expect(usage('unused')).toBe(0)
  })
})
