// Detail panel for the selected row's element: what it is, how it was matched, what its changes
// affect, and every change to it (all rows for its elementId, whatever the filter). The clicked
// change is highlighted. Close or Escape clears the selection.
import { useEffect } from 'react'
import type { Affects, ChangeRow } from '../../shared/viewModel'
import { useUi } from '../../shared/uiState'
import { withUnit } from './format'

const affectsOrder: Affects[] = ['geometry', 'stiffness', 'mass', 'load']

const matchedByText = { label: 'By label', geometry: 'By geometry' } as const

export function ElementDetail({ rows, labels }: { rows: ChangeRow[]; labels: Map<string, string> }) {
  const { state, dispatch } = useUi()
  const selected = rows.find((r) => r.id === state.selectedRowId)

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dispatch({ type: 'select_row', rowId: null }) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected, dispatch])

  if (!selected) return null

  const changes = rows.filter((r) => r.elementId === selected.elementId)
  const affects = affectsOrder.filter((a) => changes.some((r) => r.affects.includes(a)))
  const matchedBy = changes.find((r) => r.matchedBy)?.matchedBy

  return (
    <section aria-label="Element detail" className="max-h-[40%] overflow-auto border-t-2 border-slate-300 bg-slate-50 text-xs">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h3 className="font-semibold">{selected.elementType} {selected.label}</h3>
        <button onClick={() => dispatch({ type: 'select_row', rowId: null })} className="underline hover:text-slate-900">
          Close
        </button>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 px-3 py-2">
        <dt className="text-slate-500">Type</dt><dd>{selected.elementType}</dd>
        <dt className="text-slate-500">Label</dt><dd>{selected.label}</dd>
        <dt className="text-slate-500">Story</dt><dd>{selected.story ?? '—'}</dd>
        {selected.grid && <><dt className="text-slate-500">Grid</dt><dd>{selected.grid}</dd></>}
        <dt className="text-slate-500">Matched</dt><dd>{matchedBy ? matchedByText[matchedBy] : '—'}</dd>
        <dt className="text-slate-500">Affects</dt>
        <dd aria-label="Affects" className="flex flex-wrap gap-1">
          {affects.length === 0
            ? '—'
            : affects.map((a) => <span key={a} className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-700">{a}</span>)}
        </dd>
      </dl>
      <h4 className="px-3 pt-1 font-medium text-slate-500">
        {changes.length} {changes.length === 1 ? 'change' : 'changes'}
      </h4>
      <ul aria-label="Changes to this element" className="px-3 pb-2">
        {changes.map((r) => {
          const current = r.id === selected.id
          return (
            <li
              key={r.id}
              aria-current={current ? 'true' : undefined}
              className={`border-b border-slate-200 py-1 ${current ? 'bg-blue-100' : ''}`}
            >
              <span className="text-slate-500">{labels.get(r.categoryId) ?? r.categoryId} › {labels.get(r.subcategoryId) ?? r.subcategoryId}</span>
              {' · '}
              <span className="font-medium">{r.property}</span>
              {': '}
              {withUnit(r.before, r.unit)} → {withUnit(r.after, r.unit)}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
