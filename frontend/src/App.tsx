// Vantage: review two revisions of a structural model. Frontend only; synthetic data only.
import { lazy, Suspense, useCallback, useEffect, useReducer, useState, type ReactNode } from 'react';
import type { Result } from './vantageTypes';
import { type ColorBy, type ViewMode, reducer } from './data';
import { ChangeTable, DetailPanel, StoryStrip, SummaryList } from './Panels';
import type { CameraMode } from './Viewer';
import type { Diff, Model } from './types';
import { adapt } from './adapter';
import { adaptEngine, type EngineDiff } from './engineAdapter';

// Loaded separately so tests (no WebGL) never import three.js.
const Viewer = lazy(() => import('./Viewer'));

// Mock files are bundled from src/mock and loaded lazily, so a missing file fails like a real load.
const MOCKS = import.meta.glob('./mock/*.json');

// Data sources in the top-bar dropdown. "team-fixture" is the team's reference case in schema.py format.
const SOURCES: [string, string][] = [
  ['team-fixture', 'Team fixture (fixtures/*.json)'],
  ['seeded-demo', 'Seeded demo, 8 stories (engine output)'],
  ['hack-local', 'Hack pair, real ETABS (local only)'],
  ['mock-result', 'Vantage mock'],
];

// Engine output from real models lives in frontend/local-data/ (gitignored), never in the repo.
// Generate it with: PYTHONPATH=backend python3 -m diff_engine <before.e2k> <after.e2k> -o frontend/local-data/hack-diff.json
const LOCAL = import.meta.glob('../local-data/*.json');

export async function loadScenario(name: string): Promise<Result> {
  if (name === 'seeded-demo') {
    // Synthetic pair, regenerated from latest main (same as `just demo-seeded`); equals main's fixtures/demo/diff.json.
    const load = LOCAL['../local-data/seeded-diff.json'];
    if (!load) throw new Error('frontend/local-data/seeded-diff.json not found. Run the engine on fixtures/demo/before.e2k and after.e2k (see App.tsx).');
    return adaptEngine(((await load()) as { default: EngineDiff }).default, { mock: true });
  }
  if (name === 'hack-local') {
    const load = LOCAL['../local-data/hack-diff.json'];
    if (!load) throw new Error('frontend/local-data/hack-diff.json not found. Run the engine on the hack pair first (see App.tsx).');
    return adaptEngine(((await load()) as { default: EngineDiff }).default, { mock: false });
  }
  if (name === 'team-fixture') {
    const [a, b, d] = await Promise.all([
      import('../../fixtures/model-a.json'), import('../../fixtures/model-b.json'), import('../../fixtures/diff.json'),
    ]);
    return adapt({ modelA: a.default as unknown as Model, modelB: b.default as unknown as Model, diff: d.default as unknown as Diff });
  }
  const load = MOCKS[`./mock/${name}.json`];
  if (!load) throw new Error(`Mock file ${name}.json was not found.`);
  const data = ((await load()) as { default: Result }).default;
  if (data.warnings?.error) throw new Error(data.warnings.error);
  if (data.mock !== true) throw new Error('This file is not marked "mock": true, so it was not loaded.');
  return data;
}

/** The review panels, sharing one selected change. The viewer is passed in so tests can leave it out. */
export function Workspace({ result, selectedId, onSelect, viewer, story, onStory }: {
  result: Result; selectedId: string | null; onSelect: (id: string | null) => void;
  viewer?: ReactNode; story?: string | null; onStory?: (s: string | null) => void;
}) {
  const props = { result, selectedId, onSelect };
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[20rem_1fr_22rem] grid-rows-[1fr_15rem]">
      <aside className="min-h-0 overflow-hidden border-r border-slate-200"><SummaryList {...props} /></aside>
      <main className="flex min-h-0 flex-col">
        <StoryStrip result={result} story={story ?? null} onStory={onStory ?? (() => {})} />
        <div className="min-h-0 flex-1">
          {viewer ?? <div className="flex h-full items-center justify-center text-sm text-slate-400">Viewer</div>}
        </div>
      </main>
      <aside className="min-h-0 overflow-y-auto border-l border-slate-200"><DetailPanel {...props} /></aside>
      <section className="col-span-3 min-h-0 border-t border-slate-200"><ChangeTable {...props} /></section>
    </div>
  );
}

/** A labelled group of toggle buttons for the top bar. */
function Toggle<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-slate-500">{label}</span>
      {options.map(([v, text]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded px-2 py-0.5 ${value === v ? 'bg-slate-800 text-white' : 'bg-slate-100 hover:bg-slate-200'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, { load: { status: 'loading' }, selectedChangeId: null });
  const select = useCallback((id: string | null) => dispatch({ type: 'select', id }), []);
  const [viewMode, setViewMode] = useState<ViewMode>('overlay');
  const [cameraMode, setCameraMode] = useState<CameraMode>('3d');
  const [colorBy, setColorBy] = useState<ColorBy>('change');
  const [story, setStory] = useState<string | null>(null);
  const [zoomTick, setZoomTick] = useState(0);
  const [resetTick, setResetTick] = useState(0);
  const [source, setSource] = useState('team-fixture');

  // Each load starts from a clean slate: previous result, selection and story filter are dropped.
  useEffect(() => {
    let current = true;
    dispatch({ type: 'load_start' });
    setStory(null);
    loadScenario(source)
      .then((result) => current && dispatch({ type: 'load_ok', result }))
      .catch((e: Error) => current && dispatch({ type: 'load_fail', message: e.message }));
    return () => { current = false; }; // ignore a slow load that was superseded
  }, [source]);

  const { load } = state;
  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-2">
        <h1 className="font-semibold">Vantage</h1>
        {/* Always visible: says whether what's on screen is synthetic or a real model. */}
        <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-bold tracking-wide text-white">
          {load.status === 'ready' && !load.result.mock ? 'REAL MODEL · LOCAL ONLY' : 'MOCK DATA'}
        </span>
        <label className="text-xs text-slate-500">Data{' '}
          <select value={source} onChange={(e) => setSource(e.target.value)} className="rounded border px-1 text-slate-900">
            {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <Toggle label="Show" value={viewMode} onChange={setViewMode}
          options={[['baseline', 'Baseline'], ['overlay', 'Overlay'], ['revised', 'Revised']]} />
        <Toggle label="View" value={cameraMode} onChange={setCameraMode}
          options={[['3d', '3D'], ['plan', 'Plan'], ['N', 'N'], ['S', 'S'], ['E', 'E'], ['W', 'W']]} />
        <Toggle label="Color by" value={colorBy} onChange={setColorBy}
          options={[['change', 'Change type'], ['property', 'Section/Material']]} />
        <button className="rounded bg-slate-100 px-2 py-0.5 text-xs hover:bg-slate-200 disabled:opacity-40"
          disabled={!state.selectedChangeId} onClick={() => setZoomTick((t) => t + 1)}>Zoom to selected</button>
        <button className="rounded bg-slate-100 px-2 py-0.5 text-xs hover:bg-slate-200"
          onClick={() => setResetTick((t) => t + 1)}>Reset view</button>
        {load.status === 'ready' && (
          <span className="ml-auto text-xs text-slate-500">
            {load.result.meta.source.baseline} → {load.result.meta.source.revised} · {load.result.meta.units.length}, {load.result.meta.units.force}
          </span>
        )}
      </header>
      {load.status === 'loading' && <p className="p-4 text-sm text-slate-500">Loading…</p>}
      {load.status === 'error' && <p role="alert" className="p-4 text-sm">Could not load the comparison: {load.message}</p>}
      {load.status === 'ready' && (
        <Workspace
          result={load.result}
          selectedId={state.selectedChangeId}
          onSelect={select}
          story={story}
          onStory={setStory}
          viewer={
            <Suspense fallback={<div className="p-4 text-sm text-slate-400">Loading viewer…</div>}>
              <Viewer result={load.result} selectedId={state.selectedChangeId} onSelect={select}
                viewMode={viewMode} cameraMode={cameraMode} colorBy={colorBy} storyFilter={story}
                zoomTick={zoomTick} resetTick={resetTick} />
            </Suspense>
          }
        />
      )}
    </div>
  );
}
