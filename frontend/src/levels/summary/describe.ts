// Text and ordering for Summary lines. Kept apart from the component so it can be tested on its own.
import { CATEGORIES, OTHER } from '../../shared/categories'
import type { ChangeGroup } from '../../shared/viewModel'

const categoryRank = new Map([...CATEGORIES, OTHER].map((c, i) => [c.id, i]))

/** Groups in the 7-category order, then largest first. Ties keep their incoming order. */
export function orderGroups(groups: ChangeGroup[]): ChangeGroup[] {
  const rank = (g: ChangeGroup) => categoryRank.get(g.categoryId) ?? categoryRank.size
  return [...groups].sort((a, b) => rank(a) - rank(b) || b.count - a.count)
}

export const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`)

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const withUnit = (value: string, unit?: string) => (unit && value !== '—' ? `${value} ${unit}` : value)

/** Stories top to bottom: up to three listed, more shown as a range. */
export function storyRange(stories: string[]): string {
  if (stories.length <= 3) return stories.join(', ')
  return `${stories[0]}–${stories[stories.length - 1]} (${stories.length} stories)`
}

/** One Summary line, e.g. "312 beams, L3, L4, L5: Section W18X35 → W21X44" or
 *  "Material 4000Psi: E 3605 → 4030 ksi, used by 840 elements". `label` names a group of one. */
export function describeGroup(g: ChangeGroup, label?: string): string {
  const who = g.count === 1 && label
    ? `${capitalize(g.elementType)} ${label}`
    : `${g.count} ${plural(g.count, g.elementType)}`
  const where = g.stories.length > 0 ? `, ${storyRange(g.stories)}` : ''
  const change = `${withUnit(g.before, g.unit)} → ${withUnit(g.after, g.unit)}`
  const what =
    g.kind === 'modified' ? `${g.property} ${change}`
    : g.kind === 'renamed' ? `renamed ${change}`
    : g.kind
  const usedBy = g.usedBy !== undefined ? `, used by ${g.usedBy} ${plural(g.usedBy, 'element')}` : ''
  return `${who}${where}: ${what}${usedBy}`
}
