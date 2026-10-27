// Raw team contract -> view model. Foundations only: the planning-board groups are listed with
// zero counts and no rows. Mapping fields to groups and categories is issue #15.
import type { RawResult } from './load'
import { emptyCounts, type SummaryGroup, type Tier, type ViewModel } from './viewModel'

// Planning-board groups in board order.
export const GROUPS: [string, string, Tier][] = [
  ['G1', 'Geometry / level changes', 'MVP'],
  ['1A', 'Section reassigned', 'MVP'],
  ['1B', 'Section definition edited', 'MVP'],
  ['1C', 'Material edited', 'MVP'],
  ['1D', 'Property modifiers', '2nd pass'],
  ['1E', 'End releases / end offsets / insertion point / local axis', '2nd pass'],
  ['2A', 'Supports and springs', '2nd pass'],
  ['2B', 'Applied loads', '2nd pass'],
  ['T3', 'Tables only: mass, load patterns, load cases, combos', '3rd pass'],
  ['ST', 'Stretch: walls/slabs, diaphragm assigns, spectrum/time history', 'Stretch'],
  ['LO', 'Label-only / not physical', 'Info'],
]

export function toViewModel(raw: RawResult): ViewModel {
  const summary: SummaryGroup[] = GROUPS.map(([id, title, tier]) => ({
    id, title, tier, counts: emptyCounts(), coverage: 'none',
  }))
  return {
    meta: {
      baseline: raw.modelA.meta.file,
      revised: raw.modelB.meta.file,
      units: { length: 'in', force: 'kip' },
    },
    summary,
    categories: [], // TODO(#15): group -> record type tree
    rows: [],       // TODO(#15): one row per changed element / definition
  }
}
