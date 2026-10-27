// Level 2: the 7 categories and their subcategories, each with its change count (0 when nothing
// changed; nothing is hidden). Other appears only when something landed in it. Clicking a category or
// subcategory narrows the Element level; clicking the active one again clears it.
import { OTHER } from '../../shared/categories'
import type { CategoryNode, ChangeGroup, ChangeRow } from '../../shared/viewModel'
import { useUi } from '../../shared/uiState'

/** Changed definitions in a subcategory, once each, with how many elements use them. */
function changedDefinitions(subcategoryId: string, groups: ChangeGroup[], labels: Map<string, string>) {
  const byName = new Map<string, number>()
  for (const g of groups) {
    if (g.subcategoryId !== subcategoryId || g.usedBy === undefined) continue
    const name = labels.get(g.rowIds[0]) ?? g.elementType
    byName.set(name, Math.max(byName.get(name) ?? 0, g.usedBy))
  }
  return [...byName]
}

const countClass = (n: number) => (n === 0 ? 'text-slate-400' : 'font-medium')

export function CategorySection({ categories, groups, rows }: { categories: CategoryNode[]; groups: ChangeGroup[]; rows: ChangeRow[] }) {
  const { state, dispatch } = useUi()
  const { categoryId, subcategoryId } = state.filter
  const labels = new Map(rows.map((r) => [r.id, r.label]))
  const shown = categories.filter((c) => c.id !== OTHER.id || c.count > 0)

  return (
    <section aria-label="Category" className="flex min-h-0 flex-col border-r border-slate-200">
      <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Category</h2>
      <ul className="flex-1 overflow-y-auto text-xs">
        {shown.map((c) => {
          const catActive = categoryId === c.id && !subcategoryId
          return (
            <li key={c.id} className="border-b border-slate-100">
              <button
                aria-pressed={catActive}
                onClick={() => dispatch({ type: 'filter_category', categoryId: catActive ? null : c.id })}
                className={`flex w-full justify-between px-3 py-1 text-left font-semibold ${catActive ? 'bg-blue-100' : 'hover:bg-slate-50'}`}
              >
                <span>{c.label}</span><span className={countClass(c.count)}>{c.count}</span>
              </button>
              <ul aria-label={c.label}>
                {c.subcategories.map((s) => {
                  const subActive = subcategoryId === s.id
                  const definitions = changedDefinitions(s.id, groups, labels)
                  return (
                    <li key={s.id}>
                      <button
                        aria-pressed={subActive}
                        onClick={() => dispatch(subActive
                          ? { type: 'filter_category', categoryId: null }
                          : { type: 'filter_subcategory', categoryId: c.id, subcategoryId: s.id })}
                        className={`flex w-full justify-between py-1 pl-6 pr-3 text-left ${subActive ? 'bg-blue-100' : 'hover:bg-slate-50'}`}
                      >
                        <span>{s.label}</span><span className={countClass(s.count)}>{s.count}</span>
                      </button>
                      {definitions.length > 0 && (
                        <ul aria-label={`${s.label} changed`} className="pb-1">
                          {definitions.map(([name, usedBy]) => (
                            <li key={name} className="py-0.5 pl-9 pr-3 text-slate-500">
                              {name}: used by {usedBy} {usedBy === 1 ? 'element' : 'elements'}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
