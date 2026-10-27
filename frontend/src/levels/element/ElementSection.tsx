// Level 3: changed elements that pass the Summary / Category filter. Clicking a row selects it.
// Placeholder layout; issue #18 builds this out.
import type { CategoryNode, ElementRow } from '../../shared/viewModel'
import { useUi, visibleRows } from '../../shared/uiState'

export function ElementSection({ rows, categories }: { rows: ElementRow[]; categories: CategoryNode[] }) {
  const { state, dispatch } = useUi()
  const shown = visibleRows(rows, categories, state.filter)
  return (
    <section aria-label="Element" className="flex min-h-0 flex-col">
      <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Element</h2>
      {shown.length === 0
        ? <p className="p-3 text-xs text-slate-400">No element changes to show.</p>
        : (
          <ul className="flex-1 overflow-y-auto text-xs">
            {shown.map((r) => (
              <li key={r.id}>
                <button
                  aria-current={state.selectedRowId === r.id}
                  onClick={() => dispatch({ type: 'select_row', rowId: r.id })}
                  className={`w-full px-3 py-1 text-left ${state.selectedRowId === r.id ? 'bg-blue-100' : 'hover:bg-slate-50'}`}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
