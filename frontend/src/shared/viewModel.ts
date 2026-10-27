// View-model types for the three review levels. Level components read only these, never the raw
// diff. The raw input is the team contract ({ modelA, modelB, diff } per ../types.ts, mirroring
// backend schema.py); toViewModel() converts it. Units: kip and inch throughout.

export type Affects = 'geometry' | 'stiffness' | 'mass' | 'load'

/** label_only: a rename or reversed end order. Reported, but never counted as a physical change. */
export type ChangeKind = 'added' | 'removed' | 'modified' | 'label_only'

/** Planning-board tier for a group. */
export type Tier = 'MVP' | '2nd pass' | '3rd pass' | 'Stretch' | 'Info'

/** compared: diffed. seen_not_compared: in the file but not diffed yet (shown as such, never as zero). */
export type Coverage = 'compared' | 'seen_not_compared' | 'none'

export type Counts = Record<ChangeKind, number>

// ---------- Level 1: Summary ----------

/** One line per planning-board group (G1 geometry, 1A section reassigned, ...), in board order. */
export interface SummaryGroup {
  id: string            // e.g. 'G1', '1A', 'T3'
  title: string
  tier: Tier
  counts: Counts
  coverage: Coverage
}

// ---------- Level 2: Category ----------

/** Tree under a group: group -> record type (frames, materials, ...) -> optional sub-levels. */
export interface CategoryNode {
  id: string            // unique across the tree, e.g. 'G1/frames'
  groupId: string       // SummaryGroup.id this node belongs to
  label: string
  counts: Counts
  children: CategoryNode[]
  rowIds: string[]      // ElementRow ids directly under this node
}

// ---------- Level 3: Element ----------

export interface FieldChange {
  field: string         // e.g. 'section', 'modI33', 'E'
  before: string        // formatted for display, '—' when absent
  after: string
  unit?: string
}

/** One changed element or definition (a frame, a material, a load, ...). */
export interface ElementRow {
  id: string            // unique row id
  elementId: string     // id in the raw diff, e.g. 'C2@L1' or '4000Psi'
  label: string         // display name, e.g. 'Column C2 @ L1' or 'Material 4000Psi'
  story?: string
  kind: ChangeKind
  groupId: string
  categoryId: string
  fields: FieldChange[]
  affects: Affects[]
  matchedBy?: 'label' | 'geometry'
}

// ---------- whole view model ----------

export interface ViewModel {
  meta: {
    baseline: string    // source file names
    revised: string
    units: { length: 'in'; force: 'kip' }
  }
  summary: SummaryGroup[]
  categories: CategoryNode[]
  rows: ElementRow[]
}

export const emptyCounts = (): Counts => ({ added: 0, removed: 0, modified: 0, label_only: 0 })
