// View-model types for the three review levels. Level components read only these, never the raw
// diff. The raw input is the team contract ({ modelA, modelB, diff } per ../types.ts, mirroring
// backend schema.py); toViewModel() converts it. Units: kip and inch throughout.

export type Affects = 'geometry' | 'stiffness' | 'mass' | 'load'

/** moved: a linked removed/added pair or changed end nodes. renamed: same element, new label. */
export type ChangeKind = 'added' | 'removed' | 'modified' | 'moved' | 'renamed'

// ---------- Level 3: Element ----------

/** One individual change: one element (or definition) and one property. An element with several
 *  changes has several rows, so each row sits in exactly one subcategory. */
export interface ChangeRow {
  id: string            // unique row id
  elementId: string     // id in the raw diff, e.g. 'C2@L1' or '4000Psi'
  elementType: string   // 'beam', 'column', 'brace', 'wall', 'slab', 'joint', 'link', or a definition type, e.g. 'material'
  label: string         // ETABS label, e.g. 'C2'
  story?: string
  grid?: string         // filled once the engine reports it (#21)
  kind: ChangeKind
  categoryId: string    // CATEGORIES id, e.g. 'assignments'
  subcategoryId: string // e.g. 'assignments/section'
  property: string      // e.g. 'Section', 'I33 modifier'
  before: string        // formatted for display, '—' when absent
  after: string
  unit?: string         // filled once the engine reports it (#22)
  affects: Affects[]
  matchedBy?: 'label' | 'geometry'
  groupId?: string      // ChangeGroup this row belongs to
}

// ---------- Level 1: Summary ----------

/** Identical changes across elements, e.g. 312 beams: Section W18X35 -> W21X44. A single change is a
 *  group of 1. Same (subcategoryId, elementType, property, before, after) means same group. */
export interface ChangeGroup {
  id: string
  categoryId: string
  subcategoryId: string
  kind: ChangeKind
  elementType: string
  property: string
  before: string
  after: string
  unit?: string
  count: number
  stories: string[]     // top to bottom
  rowIds: string[]
  usedBy?: number       // definition changes only: elements using the definition
}

export interface Summary {
  total: number         // number of ChangeRows
  groups: ChangeGroup[]
}

// ---------- Level 2: Category ----------

export interface SubcategoryNode {
  id: string
  categoryId: string
  label: string
  count: number         // 0 when nothing changed; always present
  rowIds: string[]
}

/** One of the 7 categories (or Other). Two levels only: category -> subcategory. */
export interface CategoryNode {
  id: string
  label: string
  count: number         // sum of its subcategories
  subcategories: SubcategoryNode[]
}

// ---------- whole view model ----------

export interface ModelInfo {
  file: string
  etabsVersion: string
}

export interface ViewModel {
  meta: {
    baseline: ModelInfo
    revised: ModelInfo
    units: { length: 'in'; force: 'kip' }
    notCompared: string[] // file sections not parsed yet; shown as "not compared", never as 0
  }
  summary: Summary
  categories: CategoryNode[]
  rows: ChangeRow[]
}
