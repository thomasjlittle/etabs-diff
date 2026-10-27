// Load the team reference case from ../fixtures (schema.py format). No backend needed.
// Two real exports come from POST /api/diff (loadFromApi) in the same shape.
import type { Diff, Model } from '../types'

export interface RawResult {
  modelA: Model
  modelB: Model
  diff: Diff
}

export async function loadFixtures(): Promise<RawResult> {
  // Imported (bundled), not fetched: Vite does not serve ../fixtures over HTTP.
  const [a, b, d] = await Promise.all([
    import('../../../fixtures/model-a.json'),
    import('../../../fixtures/model-b.json'),
    import('../../../fixtures/diff.json'),
  ])
  const raw = {
    modelA: a.default as unknown as Model,
    modelB: b.default as unknown as Model,
    diff: d.default as unknown as Diff,
  }
  checkShape(raw)
  return raw
}

/** Fail with a readable message instead of a blank screen when a file has the wrong shape. */
export function checkShape(raw: RawResult) {
  for (const side of ['modelA', 'modelB'] as const) {
    if (!Array.isArray(raw[side]?.frames)) throw new Error(`${side} has no frames list; is it schema.py format?`)
  }
  if (!raw.diff?.frames || !raw.diff?.tables) throw new Error('diff has no frames/tables; is it schema.py format?')
}

/** Send two ETABS exports to the local backend (POST /api/diff) and return its { modelA, modelB, diff }. */
export async function loadFromApi(before: File, after: File): Promise<RawResult> {
  const form = new FormData()
  form.append('a', before)
  form.append('b', after)

  let res: Response
  try {
    res = await fetch('/api/diff', { method: 'POST', body: form })
  } catch {
    throw new Error("Could not reach the backend; the backend isn't running on localhost:8000.")
  }
  if (!res.ok) {
    const detail = await errorText(res)
    throw new Error(`The backend returned ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${detail ? `: ${detail}` : ''}`)
  }

  let raw: RawResult
  try {
    raw = (await res.json()) as RawResult
  } catch {
    throw new Error('The backend response is not JSON; is it schema.py format?')
  }
  if (!raw || typeof raw !== 'object') throw new Error('The backend response is empty; is it schema.py format?')
  checkShape(raw)
  // The parser only sees file contents, so fill in the names the user picked when it leaves them blank.
  if (raw.modelA.meta && !raw.modelA.meta.file) raw.modelA.meta.file = before.name
  if (raw.modelB.meta && !raw.modelB.meta.file) raw.modelB.meta.file = after.name
  return raw
}

/** FastAPI errors are JSON { detail }; anything else is shown as plain text. */
async function errorText(res: Response): Promise<string> {
  const text = (await res.text().catch(() => '')).trim()
  try {
    const detail = (JSON.parse(text) as { detail?: unknown }).detail
    if (detail !== undefined) return typeof detail === 'string' ? detail : JSON.stringify(detail)
  } catch {
    // not JSON
  }
  return text.slice(0, 300)
}
