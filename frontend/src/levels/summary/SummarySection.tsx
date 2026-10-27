// Level 1: total, change groups and not-compared items. Clicking a group filters the Element level.
// Placeholder layout; issue #16 builds this out.
import type { Summary, ViewModel } from '../../shared/viewModel'
import { useUi } from '../../shared/uiState'

export function SummarySection({ meta, summary }: { meta: ViewModel['meta']; summary: Summary }) {
  const { state, dispatch } = useUi()
  return (
    <section aria-label="Summary" className="flex min-h-0 flex-col border-r border-slate-200">
      <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Summary</h2>
      <p className="px-3 py-1 text-xs">{summary.total} changes</p>
      <ul className="flex-1 overflow-y-auto text-xs">
        {summary.groups.map((g) => {
          const active = state.filter.groupId === g.id
          return (
            <li key={g.id}>
              <button
                aria-pressed={active}
                onClick={() => dispatch({ type: 'filter_group', groupId: active ? null : g.id })}
                className={`w-full px-3 py-1 text-left ${active ? 'bg-blue-100' : 'hover:bg-slate-50'}`}
              >
                {g.count} {g.elementType}: {g.property} {g.before} → {g.after}
              </button>
            </li>
          )
        })}
        {meta.notCompared.map((s) => <li key={s} className="px-3 py-1 text-slate-400">{s}: not compared</li>)}
      </ul>
    </section>
  )
}
