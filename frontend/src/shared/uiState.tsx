// Shared selection and filter state. A click in Summary or Category sets the filter; Element shows
// only the rows that pass it. Any level can select a row; all levels read the same selection.
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import type { CategoryNode, ElementRow } from './viewModel'

export interface Filter {
  groupId: string | null      // set by Summary
  categoryId: string | null   // set by Category
}

export interface UiState {
  filter: Filter
  selectedRowId: string | null
}

export type UiAction =
  | { type: 'filter_group'; groupId: string | null }
  | { type: 'filter_category'; groupId: string; categoryId: string | null }
  | { type: 'select_row'; rowId: string | null }
  | { type: 'clear' }

export const initialUiState: UiState = { filter: { groupId: null, categoryId: null }, selectedRowId: null }

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'filter_group':
      // Changing group clears the category under it.
      return { ...state, filter: { groupId: action.groupId, categoryId: null } }
    case 'filter_category':
      return { ...state, filter: { groupId: action.groupId, categoryId: action.categoryId } }
    case 'select_row':
      return { ...state, selectedRowId: action.rowId }
    case 'clear':
      return initialUiState
  }
}

/** Rows that pass the filter. A category filter includes rows in its sub-categories. */
export function visibleRows(rows: ElementRow[], categories: CategoryNode[], filter: Filter): ElementRow[] {
  if (filter.categoryId) {
    const ids = new Set<string>()
    const collect = (n: CategoryNode) => { ids.add(n.id); n.children.forEach(collect) }
    const find = (ns: CategoryNode[]): CategoryNode | undefined =>
      ns.find((n) => n.id === filter.categoryId) ?? ns.map((n) => find(n.children)).find(Boolean)
    const node = find(categories)
    if (node) collect(node)
    return rows.filter((r) => ids.has(r.categoryId))
  }
  if (filter.groupId) return rows.filter((r) => r.groupId === filter.groupId)
  return rows
}

const UiContext = createContext<{ state: UiState; dispatch: Dispatch<UiAction> } | null>(null)

export function UiProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(uiReducer, initialUiState)
  return <UiContext.Provider value={{ state, dispatch }}>{children}</UiContext.Provider>
}

export function useUi() {
  const ctx = useContext(UiContext)
  if (!ctx) throw new Error('useUi must be used inside <UiProvider>')
  return ctx
}
