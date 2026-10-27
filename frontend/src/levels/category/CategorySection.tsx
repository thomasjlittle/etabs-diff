// Level 2: category tree for the selected group. Clicking a category narrows the Element level.
// Placeholder layout; issue #17 builds this out.
import type { CategoryNode } from '../../shared/viewModel'
import { useUi } from '../../shared/uiState'

export function CategorySection({ categories }: { categories: CategoryNode[] }) {
  const { state, dispatch } = useUi()
  const shown = state.filter.groupId ? categories.filter((c) => c.groupId === state.filter.groupId) : categories

  const render = (nodes: CategoryNode[], depth: number) => nodes.map((n) => (
    <li key={n.id}>
      <button
        aria-pressed={state.filter.categoryId === n.id}
        onClick={() => dispatch({ type: 'filter_category', groupId: n.groupId, categoryId: n.id })}
        className="w-full px-3 py-1 text-left hover:bg-slate-50"
        style={{ paddingLeft: 12 + depth * 12 }}
      >
        {n.label}
      </button>
      {n.children.length > 0 && <ul>{render(n.children, depth + 1)}</ul>}
    </li>
  ))

  return (
    <section aria-label="Category" className="flex min-h-0 flex-col border-r border-slate-200">
      <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Category</h2>
      {shown.length === 0
        ? <p className="p-3 text-xs text-slate-400">No categories yet.</p>
        : <ul className="flex-1 overflow-y-auto text-xs">{render(shown, 0)}</ul>}
    </section>
  )
}
