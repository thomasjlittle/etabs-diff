import { useEffect, useState } from 'react'
import type { Model, Diff } from './types'

function App() {
  const [data, setData] = useState<{ modelA: Model; modelB: Model; diff: Diff } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadFixtures = async () => {
      try {
        const [modelARes, modelBRes, diffRes] = await Promise.all([
          fetch('/fixtures/model-a.json'),
          fetch('/fixtures/model-b.json'),
          fetch('/fixtures/diff.json'),
        ])

        const modelA = (await modelARes.json()) as unknown as Model
        const modelB = (await modelBRes.json()) as unknown as Model
        const diff = (await diffRes.json()) as unknown as Diff

        setData({ modelA, modelB, diff })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load fixtures')
      }
    }

    loadFixtures()
  }, [])

  if (error) {
    return <div style={{ color: 'red', padding: '20px' }}>Error: {error}</div>
  }

  if (!data) {
    return <div style={{ padding: '20px' }}>Loading fixtures...</div>
  }

  const { diff } = data
  const frameChanges = {
    added: diff.frames.added.length,
    removed: diff.frames.removed.length,
    modified: Object.keys(diff.frames.modified).length,
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui' }}>
      <h1>ETABS Model Diff</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
        <div style={{ border: '1px solid #ccc', padding: '15px' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{frameChanges.added}</div>
          <div style={{ color: '#666' }}>Frames Added</div>
        </div>
        <div style={{ border: '1px solid #ccc', padding: '15px' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{frameChanges.removed}</div>
          <div style={{ color: '#666' }}>Frames Removed</div>
        </div>
        <div style={{ border: '1px solid #ccc', padding: '15px' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{frameChanges.modified}</div>
          <div style={{ color: '#666' }}>Frames Modified</div>
        </div>
      </div>
    </div>
  )
}

export default App
