// Shared selection and filter state. A click in Summary (a group) or Category (a category or
// subcategory) sets the filter; Element shows only the rows that pass it. One filter is active at a
// time. Any level can select a row; all levels read the same selection.
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import type { ChangeGroup, ChangeRow } from './viewModel'

export interface Filter {
  groupId: string | null        // set by Summary
  categoryId: string | null     // set by Category
  subcategoryId: string | null  // set by Category
}

export interface UiState {
  filter: Filter
  selectedRowId: string | null
}

export type UiAction =
  | { type: 'filter_group'; groupId: string | null }
  | { type: 'filter_category'; categoryId: string | null }
  | { type: 'filter_subcategory'; categoryId: string; subcategoryId: string | null }
  | { type: 'select_row'; rowId: string | null }
  | { type: 'clear' }

const noFilter: Filter = { groupId: null, categoryId: null, subcategoryId: null }

export const initialUiState: UiState = { filter: noFilter, selectedRowId: null }

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'filter_group':
      return { ...state, filter: { ...noFilter, groupId: action.groupId } }
    case 'filter_category':
      return { ...state, filter: { ...noFilter, categoryId: action.categoryId } }
    case 'filter_subcategory':
      return { ...state, filter: { ...noFilter, categoryId: action.categoryId, subcategoryId: action.subcategoryId } }
    case 'select_row':
      return { ...state, selectedRowId: action.rowId }
    case 'clear':
      return initialUiState
  }
}

/** Rows that pass the filter: a group's rows, or the rows in a category or subcategory. */
export function visibleRows(rows: ChangeRow[], groups: ChangeGroup[], filter: Filter): ChangeRow[] {
  if (filter.subcategoryId) return rows.filter((r) => r.subcategoryId === filter.subcategoryId)
  if (filter.categoryId) return rows.filter((r) => r.categoryId === filter.categoryId)
  if (filter.groupId) {
    const ids = new Set(groups.find((g) => g.id === filter.groupId)?.rowIds ?? [])
    return rows.filter((r) => ids.has(r.id))
  }
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
