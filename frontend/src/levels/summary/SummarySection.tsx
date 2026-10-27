// Level 1: one line per planning-board group. Clicking a group filters the Element level.
// Placeholder layout; issue #16 builds this out.
import type { SummaryGroup } from '../../shared/viewModel'
import { useUi } from '../../shared/uiState'

export function SummarySection({ groups }: { groups: SummaryGroup[] }) {
  const { state, dispatch } = useUi()
  return (
    <section aria-label="Summary" className="flex min-h-0 flex-col border-r border-slate-200">
      <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Summary</h2>
      <ul className="flex-1 overflow-y-auto text-xs">
        {groups.map((g) => {
          const active = state.filter.groupId === g.id
          const total = g.counts.added + g.counts.removed + g.counts.modified
          return (
            <li key={g.id}>
              <button
                aria-pressed={active}
                onClick={() => dispatch({ type: 'filter_group', groupId: active ? null : g.id })}
                className={`flex w-full justify-between gap-2 px-3 py-1 text-left ${active ? 'bg-blue-100' : 'hover:bg-slate-50'}`}
              >
                <span>{g.id} {g.title}</span>
                <span className="text-slate-500">{g.coverage === 'seen_not_compared' ? 'seen, not compared' : total}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
