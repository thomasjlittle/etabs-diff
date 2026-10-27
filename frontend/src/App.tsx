// Vantage: review two revisions of a structural model. Frontend only; reads committed diffs and fixtures.
import { lazy, Suspense, useCallback, useEffect, useReducer, useState, type ReactNode } from 'react';
import type { Result } from './vantageTypes';
import { type ColorBy, type ViewMode, reducer } from './data';
import { ChangeTable, DetailPanel, StoryStrip, SummaryList } from './Panels';
import type { CameraMode } from './Viewer';
import type { Diff, Model } from './types';
import { adapt } from './adapter';
import { adaptEngine, type EngineDiff } from './engineAdapter';
import manifest from '../demo_viewer/diffs/manifest.json';
import { RevisionLog } from './RevisionLog';
import { UploadStart } from './UploadStart';

// Loaded separately so tests (no WebGL) never import three.js.
const Viewer = lazy(() => import('./Viewer'));

// Mock files are bundled from src/mock and loaded lazily, so a missing file fails like a real load.
const MOCKS = import.meta.glob('./mock/*.json');

// Data sources in the top-bar dropdown. "team-fixture" is the team's reference case in schema.py format.
const SOURCES: [string, string][] = [
  ['e2k-upload', 'Your models (.e2k / .$et)'],
  ['diff-file', 'Dev: open a diff file (.json from diff_engine)'],
  ['hack-models', 'Sample: Hack models, real ETABS (pick two)'],
  ['seeded-demo', 'Sample: Seeded demo, 8 stories (engine output)'],
  ['team-fixture', 'Dev: team fixture (fixtures/*.json)'],
  ['mock-result', 'Dev: Vantage mock'],
];

// Real ETABS models from frontend/demo_viewer/models/, diffed by the engine for every ordered pair
// (diff_engine.demo_diffs). The manifest lists the models; each pair is diffs/<original>__<second>.json.
export const MODELS: string[] = manifest.models;
const PAIRS = import.meta.glob('../demo_viewer/diffs/*__*.json');
export interface Pair { original: string; second: string }

export async function loadScenario(name: string, pair: Pair = { original: MODELS[0], second: MODELS[1] }): Promise<Result> {
  if (name === 'hack-models') {
    const load = PAIRS[`../demo_viewer/diffs/${pair.original}__${pair.second}.json`];
    if (!load) throw new Error(`No precomputed diff for ${pair.original} → ${pair.second} in frontend/demo_viewer/diffs/.`);
    return adaptEngine(((await load()) as { default: EngineDiff }).default, { mock: false });
  }
  if (name === 'seeded-demo') {
    // Synthetic pair (same as `just demo-seeded`), committed by the engine owner.
    const d = await import('../../fixtures/demo/diff.json');
    return adaptEngine(d.default as unknown as EngineDiff, { mock: true });
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

export const MAKE_DIFF = 'python3 -m diff_engine before.e2k after.e2k -o diff.json';

/** Open a diff written by the engine CLI (MAKE_DIFF). Read in the browser only; nothing is sent anywhere. */
export async function openDiffFile(file: File): Promise<Result> {
  const notADiff = new Error(`${file.name} is not a diff_engine output file. Make one from backend/ with: ${MAKE_DIFF}`);
  // FileReader rather than file.text(): same result in browsers, and it also exists in jsdom for tests.
  const text = await new Promise<string>((ok, fail) => {
    const reader = new FileReader();
    reader.onload = () => ok(reader.result as string);
    reader.onerror = () => fail(new Error(`Could not read ${file.name}.`));
    reader.readAsText(file);
  });
  let d: EngineDiff;
  try {
    d = JSON.parse(text);
  } catch {
    throw notADiff; // e.g. the .e2k itself was picked
  }
  if (!d || !Array.isArray(d.elements) || !Array.isArray(d.stories) || !d.meta?.a || !d.tables) throw notADiff;
  return adaptEngine(d, { mock: false });
}

// Served by compareE2k.ts on the dev server (npm run dev); kept as a literal so node code stays out of the bundle.
const COMPARE_ROUTE = '/local/compare';

/** Diff two uploaded models with the engine, through the local dev server. Files go to 127.0.0.1 only. */
export async function compareModels(original: File, second: File): Promise<Result> {
  const body = new FormData();
  body.append('a', original);
  body.append('b', second);
  let res: Response;
  try {
    res = await fetch(COMPARE_ROUTE, { method: 'POST', body, headers: { 'x-vantage-compare': '1' } });
  } catch {
    throw new Error('The local dev server did not answer. Start it from frontend/ with: npm run dev');
  }
  if (res.status === 404) throw new Error('Uploading models needs the dev server. Start it from frontend/ with: npm run dev');
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`The dev server sent back something that is not JSON (status ${res.status}).`);
  }
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `The dev server returned status ${res.status}.`);
  return adaptEngine(data as EngineDiff, { mock: false });
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
          aria-pressed={value === v}
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
  const [source, setSource] = useState('e2k-upload');
  const [original, setOriginal] = useState(MODELS[0]);
  const [second, setSecond] = useState(MODELS[1]);
  const [diffFile, setDiffFile] = useState<File | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [revisedFile, setRevisedFile] = useState<File | null>(null);
  // The pair last sent to Compare. Picking files alone doesn't run anything.
  const [compared, setCompared] = useState<[File, File] | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const waitingForFile = (source === 'diff-file' && !diffFile) || (source === 'e2k-upload' && !compared);
  const [page, setPage] = useState<'review' | 'log'>('review');

  // Each load starts from a clean slate: previous result, selection and story filter are dropped.
  useEffect(() => {
    let current = true;
    dispatch({ type: 'load_start' });
    setStory(null);
    if (waitingForFile) return;
    const loading = source === 'diff-file' && diffFile ? openDiffFile(diffFile)
      : source === 'e2k-upload' && compared ? compareModels(...compared)
        : loadScenario(source, { original, second });
    loading
      .then((result) => current && dispatch({ type: 'load_ok', result }))
      .catch((e: Error) => current && dispatch({ type: 'load_fail', message: e.message }));
    return () => { current = false; }; // ignore a slow load that was superseded
  }, [source, original, second, diffFile, compared, retryTick, waitingForFile]);

  const modelSelect = (label: string, value: string, onChange: (v: string) => void) => (
    <label className="text-xs text-slate-500">{label}{' '}
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="rounded border px-1 text-slate-900">
        {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </label>
  );

  // File pickers remount empty when their source is shown again, so drop what they held.
  const changeSource = (v: string) => {
    setSource(v);
    setDiffFile(null);
    setOriginalFile(null);
    setRevisedFile(null);
    setCompared(null);
  };
  // From the revision log: review that pair of Hack models.
  const openPair = (a: string, b: string) => { changeSource('hack-models'); setOriginal(a); setSecond(b); setPage('review'); };

  const { load } = state;
  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-2">
        <h1 className="font-semibold">Vantage</h1>
        <Toggle label="Page" value={page} onChange={setPage} options={[['review', 'Review'], ['log', 'Revision log']]} />
        {/* Always visible: says whether what's on screen is synthetic or a real model. */}
        {/* Only once something is loaded: while waiting or comparing, there is no data to label. */}
        {load.status === 'ready' && (
          <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-bold tracking-wide text-white">
            {load.result.mock ? 'MOCK DATA' : 'REAL ETABS MODELS'}
          </span>
        )}
        <label className="text-xs text-slate-500">Source{' '}
          <select aria-label="Source" value={source} onChange={(e) => changeSource(e.target.value)} className="rounded border px-1 text-slate-900">
            {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {source === 'hack-models' && (
          <div className="flex items-center gap-2">
            {modelSelect('Original', original, setOriginal)}
            <span className="text-slate-400">→</span>
            {modelSelect('Revised', second, setSecond)}
          </div>
        )}
        {source === 'e2k-upload' && compared && (
          <span className="flex items-center gap-2 rounded bg-slate-100 px-2 py-0.5 text-xs">
            <span className="font-mono">{compared[0].name} → {compared[1].name}</span>
            <button className="text-blue-700 underline" onClick={() => setCompared(null)}>Change files</button>
          </span>
        )}
        {source === 'diff-file' && (
          <label className="text-xs text-slate-500">Diff file{' '}
            <input type="file" accept=".json" aria-label="Diff file" className="text-xs text-slate-900"
              onChange={(e) => setDiffFile(e.target.files?.[0] ?? null)} />
          </label>
        )}
        <Toggle label="Show" value={viewMode} onChange={setViewMode}
          options={[['baseline', 'Original'], ['overlay', 'Overlay'], ['revised', 'Revised']]} />
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
      {page === 'log' && <RevisionLog onOpen={openPair} />}
      {page === 'review' && source === 'e2k-upload' && load.status !== 'ready' && (
        <UploadStart original={originalFile} revised={revisedFile} onOriginal={setOriginalFile} onRevised={setRevisedFile}
          onCompare={() => originalFile && revisedFile && setCompared([originalFile, revisedFile])}
          onSample={() => changeSource('hack-models')}
          busy={!!compared && load.status === 'loading'} error={compared && load.status === 'error' ? load.message : null} />
      )}
      {page === 'review' && waitingForFile && source === 'diff-file' && (
        <p className="p-4 text-sm text-slate-500">
          Choose a diff file. Make one from <code>backend/</code> with <code>{MAKE_DIFF}</code>. The file is read in this
          browser only.
        </p>
      )}
      {page === 'review' && source !== 'e2k-upload' && load.status === 'loading' && !waitingForFile && (
        <p className="p-4 text-sm text-slate-500">Loading…</p>
      )}
      {page === 'review' && source !== 'e2k-upload' && load.status === 'error' && (
        <div role="alert" className="m-4 flex items-center gap-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>Could not load the comparison: {load.message}</span>
          <button className="rounded bg-white px-2 py-0.5 text-xs ring-1 ring-red-300 hover:bg-red-100"
            onClick={() => setRetryTick((t) => t + 1)}>Try again</button>
        </div>
      )}
      {page === 'review' && load.status === 'ready' && (
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
