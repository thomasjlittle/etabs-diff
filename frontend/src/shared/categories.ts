// The 7 ETABS categories and their subcategories, in display order (Define -> Draw -> Assign ->
// Load -> Analyze -> Design). The list is fixed: every category and subcategory is always shown,
// with 0 when nothing changed. Ids are stable; #15 maps each change onto one subcategory.
import type { CategoryNode } from './viewModel'

export interface CategoryDef {
  id: string
  label: string
  subcategories: { id: string; label: string }[]
}

const cat = (id: string, label: string, subs: [string, string][]): CategoryDef =>
  ({ id, label, subcategories: subs.map(([sub, subLabel]) => ({ id: `${id}/${sub}`, label: subLabel })) })

export const CATEGORIES: CategoryDef[] = [
  cat('modelSettings', 'Model Settings', [
    ['options', 'Units, codes and options'],
    ['storiesGrids', 'Stories & Grids'],
  ]),
  cat('definitions', 'Definitions', [
    ['materials', 'Materials'],
    ['frameSections', 'Frame Sections'],
    ['shellSections', 'Shell Sections'],
    ['linkProps', 'Link / Spring Properties'],
    ['functions', 'Functions'],
  ]),
  cat('objects', 'Objects', [
    ['joints', 'Joints'],
    ['frames', 'Frames'],
    ['shells', 'Shells'],
    ['links', 'Links'],
  ]),
  cat('assignments', 'Assignments', [
    ['section', 'Section assignment'],
    ['modifiers', 'Property modifiers'],
    ['releases', 'Releases, offsets, insertion points, local axes'],
    ['restraints', 'Restraints & springs'],
    ['diaphragms', 'Diaphragms'],
    ['meshing', 'Meshing'],
    ['labels', 'Pier / spandrel / group labels'],
  ]),
  cat('loading', 'Loading', [
    ['patterns', 'Load Patterns'],
    ['applied', 'Applied Loads'],
    ['massSource', 'Mass Source'],
  ]),
  cat('analysis', 'Analysis', [
    ['cases', 'Load Cases'],
    ['combos', 'Load Combinations'],
    ['options', 'Analysis Options'],
  ]),
  cat('design', 'Design', [
    ['preferences', 'Preferences / codes'],
    ['overwrites', 'Overwrites'],
    ['combosGroups', 'Design combos & groups'],
  ]),
]

/** Catch-all for changes #15 cannot map, so nothing is dropped. Shown only when its count is above 0. */
export const OTHER: CategoryDef = cat('other', 'Other', [['uncategorized', 'Not categorized']])

/** The full category tree with zero counts: the 7 categories, then Other. */
export function emptyCategories(): CategoryNode[] {
  return [...CATEGORIES, OTHER].map((c) => ({
    id: c.id,
    label: c.label,
    count: 0,
    subcategories: c.subcategories.map((s) => ({ id: s.id, categoryId: c.id, label: s.label, count: 0, rowIds: [] })),
  }))
}
