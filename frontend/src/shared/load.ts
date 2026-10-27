// Load the team reference case from ../fixtures (schema.py format). No backend needed.
// Later the same shape comes from POST /api/diff, so only this file changes.
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
