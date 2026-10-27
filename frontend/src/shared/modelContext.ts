import type { Model } from '../types'

export type Entity = Record<string, unknown>

const isEntity = (value: unknown): value is Entity => value !== null && typeof value === 'object' && !Array.isArray(value)

export function modelIndex(model: Model): Map<string, Map<string, Entity>> {
  return new Map(Object.entries(model as unknown as Record<string, unknown>).map(([table, value]) => {
    const entries: [string, Entity][] = Array.isArray(value)
      ? value.filter(isEntity).flatMap((item) => {
        const id = item.id ?? item.name
        return typeof id === 'string' ? [[id, item] as [string, Entity]] : []
      })
      : isEntity(value) ? Object.entries(value).filter((entry): entry is [string, Entity] => isEntity(entry[1])) : []
    return [table, new Map(entries)]
  }))
}

// Count unique physical elements, never section definitions or references to those elements.
export function definitionUsers(model: Model): Map<string, Set<string>> {
  const users = new Map<string, Set<string>>()
  const add = (table: string, name: unknown, element: string) => {
    if (typeof name !== 'string') return
    const key = JSON.stringify([table, name])
    if (!users.has(key)) users.set(key, new Set())
    users.get(key)!.add(element)
  }
  for (const [table, elements, sections] of [
    ['frames', model.frames, model.frameSections],
    ['areas', model.areas, model.shellSections],
    ['nodes', model.nodes, {}],
  ] as const) {
    for (const element of elements) {
      const key = JSON.stringify([table, element.id])
      add('materials', element.props.material, key)
      if ('section' in element) {
        add(table === 'frames' ? 'frameSections' : 'shellSections', element.section, key)
        add('materials', sections[element.section]?.material, key)
      }
    }
  }
  return users
}

export function storyRanks(modelA: Model, modelB: Model): Map<string, number> {
  // The contract stores stories top down. Insert baseline-only (removed) stories by elevation.
  const stories = [...modelB.stories]
  for (const story of modelA.stories) {
    if (stories.some((s) => s.name === story.name)) continue
    const next = stories.findIndex((s) => s.elev < story.elev)
    stories.splice(next < 0 ? stories.length : next, 0, story)
  }
  return new Map(stories.map((s, i) => [s.name, i]))
}
