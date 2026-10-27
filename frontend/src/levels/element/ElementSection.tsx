// Level 3: one line per individual change that passes the Summary / Category filter, in the order
// #15 sorted them (story top to bottom, then label). Shows the active filter with a way to clear it.
// Clicking a row selects it.
import type { CategoryNode, ChangeGroup, ChangeKind, ChangeRow } from '../../shared/viewModel'
import { useUi, visibleRows, type Filter } from '../../shared/uiState'

const kindClass: Record<ChangeKind, string> = {
  added: 'bg-green-100 text-green-800',
  removed: 'bg-red-100 text-red-800',
  modified: 'bg-amber-100 text-amber-800',
  moved: 'bg-blue-100 text-blue-800',
  renamed: 'bg-slate-100 text-slate-700',
}

const withUnit = (value: string, unit?: string) => (unit && value !== '—' ? `${value} ${unit}` : value)

/** Labels for categories and subcategories by id. */
function categoryLabels(categories: CategoryNode[]) {
  const labels = new Map<string, string>()
  for (const c of categories) {
    labels.set(c.id, c.label)
    for (const s of c.subcategories) labels.set(s.id, s.label)
  }
  return labels
}

/** What the active filter is, in words, or null when nothing is filtered. */
function describeFilter(filter: Filter, groups: ChangeGroup[], labels: Map<string, string>): string | null {
  if (filter.subcategoryId) return `${labels.get(filter.categoryId ?? '') ?? ''} › ${labels.get(filter.subcategoryId) ?? filter.subcategoryId}`
  if (filter.categoryId) return labels.get(filter.categoryId) ?? filter.categoryId
  if (filter.groupId) {
    const g = groups.find((x) => x.id === filter.groupId)
    return g ? `${g.count} ${g.count === 1 ? g.elementType : `${g.elementType}s`} · ${g.property}` : 'Selected group'
  }
  return null
}

export function ElementSection({ rows, groups, categories }: { rows: ChangeRow[]; groups: ChangeGroup[]; categories: CategoryNode[] }) {
  const { state, dispatch } = useUi()
  const shown = visibleRows(rows, groups, state.filter)
  const labels = categoryLabels(categories)
  const filterText = describeFilter(state.filter, groups, labels)

  return (
    <section aria-label="Element" className="flex min-h-0 flex-col">
      <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Element</h2>
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-1 text-xs text-slate-500">
        <span>Showing {shown.length} of {rows.length} {rows.length === 1 ? 'change' : 'changes'}</span>
        {filterText && (
          <>
            <span aria-label="Active filter" className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800">{filterText}</span>
            <button onClick={() => dispatch({ type: 'filter_group', groupId: null })} className="underline hover:text-slate-900">
              Clear filter
            </button>
          </>
        )}
      </div>
      {shown.length === 0
        ? <p className="p-3 text-xs text-slate-400">No element changes to show.</p>
        : (
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white text-slate-500">
                <tr>
                  {['Change', 'Element', 'Story', 'Category', 'Property', 'Before', 'After'].map((h) => (
                    <th key={h} scope="col" className="border-b border-slate-200 px-3 py-1 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const selected = state.selectedRowId === r.id
                  return (
                    <tr
                      key={r.id}
                      aria-selected={selected}
                      tabIndex={0}
                      onClick={() => dispatch({ type: 'select_row', rowId: r.id })}
                      onKeyDown={(e) => { if (e.key === 'Enter') dispatch({ type: 'select_row', rowId: r.id }) }}
                      className={`cursor-pointer border-b border-slate-100 ${selected ? 'bg-blue-100' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-3 py-1"><span className={`rounded px-1.5 py-0.5 ${kindClass[r.kind]}`}>{r.kind}</span></td>
                      <td className="px-3 py-1">{r.elementType} {r.label}</td>
                      <td className="px-3 py-1">{r.story ?? '—'}{r.grid && ` · ${r.grid}`}</td>
                      <td className="px-3 py-1">{labels.get(r.categoryId) ?? r.categoryId} › {labels.get(r.subcategoryId) ?? r.subcategoryId}</td>
                      <td className="px-3 py-1">{r.property}</td>
                      <td className="px-3 py-1">{withUnit(r.before, r.unit)}</td>
                      <td className="px-3 py-1">{withUnit(r.after, r.unit)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
    </section>
  )
}
