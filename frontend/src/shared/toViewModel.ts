// Raw team contract -> view model. Stub for now: the full category tree with zero counts, no rows
// and no groups, so the levels render real structure. Mapping changes onto subcategories and
// grouping them is #15 PR 2.
import type { RawResult } from './load'
import { emptyCategories } from './categories'
import type { ViewModel } from './viewModel'

export function toViewModel(raw: RawResult): ViewModel {
  const { modelA, modelB } = raw
  return {
    meta: {
      baseline: { file: modelA.meta.file, etabsVersion: modelA.meta.etabsVersion },
      revised: { file: modelB.meta.file, etabsVersion: modelB.meta.etabsVersion },
      units: { length: 'in', force: 'kip' },
      notCompared: [...new Set([...(modelA.unparsed ?? []), ...(modelB.unparsed ?? [])])],
    },
    summary: { total: 0, groups: [] }, // TODO(#15): group identical changes
    categories: emptyCategories(),     // TODO(#15): counts and rowIds per subcategory
    rows: [],                          // TODO(#15): one row per individual change
  }
}
