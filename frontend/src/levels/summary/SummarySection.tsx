// Level 1: the two models, the total, every change group and the file sections not compared yet.
// Clicking a group filters the Element level to exactly its rows; clicking it again clears that.
import type { ChangeRow, Summary, ViewModel } from '../../shared/viewModel'
import { useUi } from '../../shared/uiState'
import { describeGroup, orderGroups, plural } from './describe'

export function SummarySection({ meta, summary, rows }: { meta: ViewModel['meta']; summary: Summary; rows: ChangeRow[] }) {
  const { state, dispatch } = useUi()
  const labels = new Map(rows.map((r) => [r.id, r.label]))
  const groups = orderGroups(summary.groups)

  return (
    <section aria-label="Summary" className="flex min-h-0 flex-col border-r border-slate-200">
      <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Summary</h2>
      <div className="flex-1 overflow-y-auto text-xs">
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-b border-slate-200 px-3 py-2">
          <dt className="text-slate-500">Baseline</dt>
          <dd>{meta.baseline.file} · ETABS {meta.baseline.etabsVersion}</dd>
          <dt className="text-slate-500">Revised</dt>
          <dd>{meta.revised.file} · ETABS {meta.revised.etabsVersion}</dd>
        </dl>

        <p className="px-3 py-2 text-sm font-semibold">{summary.total} {plural(summary.total, 'change')}</p>

        {groups.length === 0
          ? <p className="px-3 pb-2 text-slate-400">No changes found.</p>
          : (
            <ul aria-label="Change groups">
              {groups.map((g) => {
                const active = state.filter.groupId === g.id
                return (
                  <li key={g.id}>
                    <button
                      aria-pressed={active}
                      onClick={() => dispatch({ type: 'filter_group', groupId: active ? null : g.id })}
                      className={`w-full px-3 py-1 text-left ${active ? 'bg-blue-100' : 'hover:bg-slate-50'}`}
                    >
                      {describeGroup(g, labels.get(g.rowIds[0]))}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

        {meta.notCompared.length > 0 && (
          <>
            <h3 className="border-t border-slate-200 px-3 pt-2 font-semibold text-slate-500">Not compared</h3>
            <ul aria-label="Not compared" className="pb-2">
              {meta.notCompared.map((s) => <li key={s} className="px-3 py-0.5 text-slate-500">{s}: not compared</li>)}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
