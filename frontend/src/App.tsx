import { useEffect, useState } from 'react'
import { loadFixtures } from './shared/load'
import { toViewModel } from './shared/toViewModel'
import type { ViewModel } from './shared/viewModel'
import { UiProvider } from './shared/uiState'
import { SummarySection } from './levels/summary/SummarySection'
import { CategorySection } from './levels/category/CategorySection'
import { ElementSection } from './levels/element/ElementSection'

/** The three review levels side by side, sharing one selection/filter state. */
export function Shell({ vm }: { vm: ViewModel }) {
  return (
    <UiProvider>
      <div className="grid min-h-0 flex-1 grid-cols-[18rem_18rem_1fr]">
        <SummarySection groups={vm.summary} />
        <CategorySection categories={vm.categories} />
        <ElementSection rows={vm.rows} categories={vm.categories} />
      </div>
    </UiProvider>
  )
}

type Load = { status: 'loading' } | { status: 'ready'; vm: ViewModel } | { status: 'error'; message: string }

function App() {
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    loadFixtures()
      .then((raw) => setLoad({ status: 'ready', vm: toViewModel(raw) }))
      .catch((err) => setLoad({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load fixtures' }))
  }, [])

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-2">
        <h1 className="font-semibold">ETABS Model Diff</h1>
        {load.status === 'ready' && (
          <span className="text-xs text-slate-500">
            {load.vm.meta.baseline} → {load.vm.meta.revised} · {load.vm.meta.units.length}, {load.vm.meta.units.force}
          </span>
        )}
      </header>
      {load.status === 'loading' && <p className="p-4 text-sm text-slate-500">Loading fixtures…</p>}
      {load.status === 'error' && <p role="alert" className="p-4 text-sm">Could not load the comparison: {load.message}</p>}
      {load.status === 'ready' && <Shell vm={load.vm} />}
    </div>
  )
}

export default App
