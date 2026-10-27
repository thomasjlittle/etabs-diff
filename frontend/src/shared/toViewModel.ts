import type { RawResult } from './load'
import type { Change, SetDiff } from '../types'
import { emptyCategories } from './categories'
import { definitionTables, displayValue, propertyLabel, subcategoryFor, tableElementTypes } from './changeMapping'
import { definitionUsers, modelIndex, storyRanks, type Entity } from './modelContext'
import type { Affects, ChangeGroup, ChangeKind, ChangeRow, ViewModel } from './viewModel'

export function toViewModel(raw: RawResult): ViewModel {
  const { modelA, modelB, diff } = raw
  const baseline = modelIndex(modelA)
  const revised = modelIndex(modelB)
  const usersA = definitionUsers(modelA)
  const usersB = definitionUsers(modelB)
  const ranks = storyRanks(modelA, modelB)
  const rows: ChangeRow[] = []
  const rowUsers = new Map<string, Set<string>>()

  const addRow = (table: string, elementId: string, kind: ChangeKind, change?: Change, index = 0) => {
    const a = baseline.get(table)?.get(elementId)
    const b = revised.get(table)?.get(elementId)
    const entity = (kind === 'removed' ? a : b ?? a) ?? {}
    // Loads retain their own id; use the target element's type, label and story in the UI.
    let target: Entity = entity
    let targetTable = table
    if (table === 'loads' && typeof entity.on === 'string') {
      for (const objectTable of ['nodes', 'frames', 'areas']) {
        const object = (kind === 'removed' ? baseline : revised).get(objectTable)?.get(entity.on)
          ?? baseline.get(objectTable)?.get(entity.on)
        if (object) { target = object; targetTable = objectTable; break }
      }
    }
    const subcategoryId = subcategoryFor(table, change?.field)
    const id = JSON.stringify([table, elementId, kind, change?.field ?? '$entity', index])
    const affects: Affects[] = change?.affects ?? (
      ['frames', 'areas'].includes(table) ? ['geometry', 'stiffness', 'mass']
        : table === 'nodes' ? ['geometry']
          : definitionTables.has(table) ? ['stiffness', 'mass']
            : ['loads', 'loadPatterns', 'loadCases', 'combos'].includes(table) ? ['load']
              : table === 'massSource' ? ['mass'] : table === 'stories' ? ['geometry'] : []
    )
    rows.push({
      id, elementId,
      elementType: String(target.kind ?? tableElementTypes.get(targetTable) ?? table),
      label: String(target.label ?? target.name ?? elementId),
      story: typeof target.story === 'string' ? target.story : table === 'stories' ? elementId : undefined,
      kind,
      categoryId: subcategoryId.split('/')[0], subcategoryId,
      property: change ? propertyLabel(change.field) : definitionTables.has(table) ? 'Definition' : 'Object',
      before: displayValue(change ? change.before : kind === 'removed' ? a ?? elementId : null),
      after: displayValue(change ? change.after : kind === 'added' ? b ?? elementId : null),
      affects: [...affects],
      matchedBy: table === 'frames' ? diff.frames.matchedBy[elementId] : undefined,
    })
    if (definitionTables.has(table)) {
      // Current usage for added/modified definitions; baseline usage for removed definitions.
      rowUsers.set(id, (kind === 'removed' ? usersA : usersB).get(JSON.stringify([table, elementId])) ?? new Set())
    }
  }

  const mapSet = (table: string, set: SetDiff) => {
    for (const id of set.added) addRow(table, id, 'added')
    for (const id of set.removed) addRow(table, id, 'removed')
    for (const [id, changes] of Object.entries(set.modified)) {
      changes.forEach((change, index) => {
        const object = ['frames', 'nodes', 'areas', 'links'].includes(table)
        const kind = object && change.field === 'label' ? 'renamed'
          : object && ['nodes', 'xyz', 'i', 'j', 'corners', 'story'].includes(change.field) ? 'moved' : 'modified'
        addRow(table, id, kind, change, index)
      })
    }
  }
  mapSet('frames', diff.frames)
  for (const [table, set] of Object.entries(diff.tables)) mapSet(table, set)

  const rank = (story?: string) => ranks.get(story) ?? Number.MAX_SAFE_INTEGER
  rows.sort((a, b) => rank(a.story) - rank(b.story)
    || (a.story ?? '').localeCompare(b.story ?? '')
    || a.label.localeCompare(b.label, undefined, { numeric: true }) || a.id.localeCompare(b.id))

  const categories = emptyCategories()
  const subcategories = new Map(categories.flatMap((c) => c.subcategories.map((s) => [s.id, s] as const)))
  const groups = new Map<string, ChangeGroup>()
  const groupUsers = new Map<string, Set<string>>()
  for (const row of rows) {
    subcategories.get(row.subcategoryId)!.rowIds.push(row.id)
    const key = JSON.stringify([row.subcategoryId, row.elementType, row.property, row.before, row.after])
    let group = groups.get(key)
    if (!group) {
      group = {
        id: `group:${key}`, categoryId: row.categoryId, subcategoryId: row.subcategoryId,
        kind: row.kind, elementType: row.elementType, property: row.property,
        before: row.before, after: row.after, count: 0, stories: [], rowIds: [],
      }
      groups.set(key, group)
    }
    row.groupId = group.id
    group.count++
    group.rowIds.push(row.id)
    if (row.story && !group.stories.includes(row.story)) group.stories.push(row.story)
    const users = rowUsers.get(row.id)
    if (users) {
      if (!groupUsers.has(key)) groupUsers.set(key, new Set())
      for (const user of users) groupUsers.get(key)!.add(user)
      group.usedBy = groupUsers.get(key)!.size
    }
  }
  for (const category of categories) {
    for (const sub of category.subcategories) sub.count = sub.rowIds.length
    category.count = category.subcategories.reduce((sum, sub) => sum + sub.count, 0)
  }
  return {
    meta: {
      baseline: { file: modelA.meta.file, etabsVersion: modelA.meta.etabsVersion },
      revised: { file: modelB.meta.file, etabsVersion: modelB.meta.etabsVersion },
      units: { length: 'in', force: 'kip' },
      notCompared: [...new Set([...(modelA.unparsed ?? []), ...(modelB.unparsed ?? [])])],
    },
    summary: { total: rows.length, groups: [...groups.values()] },
    categories,
    rows,
  }
}
