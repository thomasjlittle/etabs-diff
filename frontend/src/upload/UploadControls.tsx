// Header controls to compare two real ETABS exports via POST /api/diff, or go back to the bundled sample.
import { useState } from 'react'
import { loadFromApi, type RawResult } from '../shared/load'

const ACCEPT = '.e2k,.$et'

interface Props {
  /** Called with the backend result once both files are compared. */
  onLoaded: (raw: RawResult) => void
  /** Switch back to the bundled sample. */
  onUseSample: () => void
  /** True while the sample is on screen; hides "Use sample". */
  usingSample: boolean
}

export function UploadControls({ onLoaded, onUseSample, usingSample }: Props) {
  const [before, setBefore] = useState<File | null>(null)
  const [after, setAfter] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function compare() {
    if (!before || !after) return
    setBusy(true)
    setError(null)
    try {
      onLoaded(await loadFromApi(before, after))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ml-auto flex items-center gap-2 text-xs">
      <FileSlot label="Before" file={before} onChange={setBefore} disabled={busy} />
      <FileSlot label="After" file={after} onChange={setAfter} disabled={busy} />
      <button
        type="button"
        onClick={compare}
        disabled={!before || !after || busy}
        className="rounded bg-slate-800 px-2 py-1 text-white disabled:opacity-40"
      >
        {busy ? 'Comparing…' : 'Compare'}
      </button>
      {!usingSample && (
        <button type="button" onClick={onUseSample} disabled={busy} className="rounded border border-slate-300 px-2 py-1">
          Use sample
        </button>
      )}
      {error && (
        <p role="alert" className="max-w-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

function FileSlot({ label, file, onChange, disabled }: {
  label: string
  file: File | null
  onChange: (f: File | null) => void
  disabled: boolean
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="font-medium">{label}</span>
      <input
        type="file"
        accept={ACCEPT}
        aria-label={`${label} model file`}
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="max-w-[12rem] text-xs file:mr-1 file:rounded file:border file:border-slate-300 file:bg-white file:px-1"
      />
    </label>
  )
}
