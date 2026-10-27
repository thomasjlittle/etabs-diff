// Display helpers shared by the Element table and its detail panel.
import type { CategoryNode } from '../../shared/viewModel'

export const withUnit = (value: string, unit?: string) => (unit && value !== '—' ? `${value} ${unit}` : value)

/** Labels for categories and subcategories by id. */
export function categoryLabels(categories: CategoryNode[]) {
  const labels = new Map<string, string>()
  for (const c of categories) {
    labels.set(c.id, c.label)
    for (const s of c.subcategories) labels.set(s.id, s.label)
  }
  return labels
}
