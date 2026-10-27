import { useState, useMemo } from 'react'
import type { Model, Diff } from './types'
import modelAData from '../../fixtures/model-a.json'
import modelBData from '../../fixtures/model-b.json'
import diffData from '../../fixtures/diff.json'

function App() {
  const [error] = useState<string | null>(null)

  const data = useMemo(() => {
    try {
      const modelA = modelAData as unknown as Model
      const modelB = modelBData as unknown as Model
      const diff = diffData as unknown as Diff
      return { modelA, modelB, diff }
    } catch (err) {
      return null
    }
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
