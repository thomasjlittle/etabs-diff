// Level 2: the 7 categories and their subcategories with counts. Clicking one narrows the Element level.
// Placeholder layout; issue #17 builds this out.
import type { CategoryNode } from '../../shared/viewModel'
import { useUi } from '../../shared/uiState'

export function CategorySection({ categories }: { categories: CategoryNode[] }) {
  const { state, dispatch } = useUi()
  const { categoryId, subcategoryId } = state.filter

  return (
    <section aria-label="Category" className="flex min-h-0 flex-col border-r border-slate-200">
      <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Category</h2>
      <ul className="flex-1 overflow-y-auto text-xs">
        {categories.map((c) => (
          <li key={c.id}>
            <button
              aria-pressed={categoryId === c.id && !subcategoryId}
              onClick={() => dispatch({ type: 'filter_category', categoryId: c.id })}
              className="flex w-full justify-between px-3 py-1 text-left font-medium hover:bg-slate-50"
            >
              <span>{c.label}</span><span>{c.count}</span>
            </button>
            <ul>
              {c.subcategories.map((s) => (
                <li key={s.id}>
                  <button
                    aria-pressed={subcategoryId === s.id}
                    onClick={() => dispatch({ type: 'filter_subcategory', categoryId: c.id, subcategoryId: s.id })}
                    className="flex w-full justify-between py-1 pl-6 pr-3 text-left hover:bg-slate-50"
                  >
                    <span>{s.label}</span><span>{s.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}
