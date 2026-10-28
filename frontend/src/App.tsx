// keepTABS: review two revisions of a structural model. Frontend only; reads committed diffs and fixtures.
import {
  lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState, type ChangeEvent, type ReactNode,
} from 'react';
import type { Result } from './keeptabsTypes';
import { type ColorBy, reducer } from './data';
import { ChangeTable, DetailPanel, StoryStrip, SummaryList } from './Panels';
import type { CameraMode, CameraSync, ViewerProps } from './Viewer';
import type { Diff, Model } from './types';
import { adapt } from './adapter';
import { adaptEngine, type EngineDiff } from './engineAdapter';
import manifest from '../demo_viewer/diffs/manifest.json';
import { RevisionLog } from './RevisionLog';
import { categoryOf } from './categories';
import { UploadStart } from './UploadStart';
import { Splitter, clamp } from './Splitter';
import {
  comparisonKey, parseGridLines, readRegisterHistory, updateWorkbook, writeRegisterHistory,
  type DuplicateAction, type GridLine, type RegisterHistory,
} from './excelLog';
import { LoadDetails, LoadsControl } from './LoadPanel';
import { type LoadView, defaultLoadView } from './loads';

// Loaded separately so tests (no WebGL) never import three.js.
const Viewer = lazy(() => import('./Viewer'));

// Mock files are bundled from src/mock and loaded lazily, so a missing file fails like a real load.
const MOCKS = import.meta.glob('./mock/*.json');
const MODEL_TEXTS = import.meta.glob('../demo_viewer/models/*.e2k', { query: '?raw', import: 'default' });

// Data sources in the top-bar dropdown. "team-fixture" is the team's reference case in schema.py format.
const SOURCES: [string, string][] = [
  ['e2k-upload', 'Your models (.e2k / .$et)'],
  ['diff-file', 'Dev: open a diff file (.json from diff_engine)'],
  ['hack-models', 'Sample: Hack models, real ETABS (pick two)'],
  ['seeded-demo', 'Sample: Seeded demo, 8 stories (engine output)'],
  ['team-fixture', 'Dev: team fixture (fixtures/*.json)'],
  ['mock-result', 'Dev: keepTABS mock'],
];

// Real ETABS models from frontend/demo_viewer/models/, diffed by the engine for every ordered pair
// (diff_engine.demo_diffs). The manifest lists the models; each pair is diffs/<original>__<second>.json.
export const MODELS: string[] = manifest.models;

async function bundledGrids(file: string): Promise<GridLine[]> {
  const basename = file.replace(/^.*[\\/]/, '');
  const load = MODEL_TEXTS[`../demo_viewer/models/${basename}`];
  return load ? parseGridLines((await load()) as string) : [];
}

async function comparisonGrids(result: Result, source: string, originalFile: File | null, revisedFile: File | null): Promise<GridLine[]> {
  if (source === 'e2k-upload' && originalFile && revisedFile) {
    const [original, revised] = await Promise.all([originalFile.text(), revisedFile.text()]);
    const revisedGrids = parseGridLines(revised);
    return revisedGrids.length ? revisedGrids : parseGridLines(original);
  }
  const revisedGrids = await bundledGrids(result.meta.source.revised);
  return revisedGrids.length ? revisedGrids : bundledGrids(result.meta.source.baseline);
}
const PAIRS = import.meta.glob('../demo_viewer/diffs/*__*.json');
export interface Pair { original: string; second: string }

export async function loadScenario(name: string, pair: Pair = { original: MODELS[0], second: MODELS[1] }): Promise<Result> {
  if (name === 'hack-models') {
    const load = PAIRS[`../demo_viewer/diffs/${pair.original}__${pair.second}.json`];
    if (!load) throw new Error(`No precomputed diff for ${pair.original} → ${pair.second} in frontend/demo_viewer/diffs/.`);
    return adaptEngine(((await load()) as { default: EngineDiff }).default, { mock: false });
  }
  if (name === 'seeded-demo') {
    // Synthetic pair (fixtures/demo/, the pair the engine tests use), committed by the engine owner.
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
    res = await fetch(COMPARE_ROUTE, { method: 'POST', body, headers: { 'x-keeptabs-local': '1' } });
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
export function Workspace({ result, selectedId, onSelect, viewer, story, onStory, loadView, loadFocus }: {
  result: Result; selectedId: string | null; onSelect: (id: string | null) => void;
  viewer?: ReactNode; story?: string | null; onStory?: (s: string | null) => void;
  loadView?: LoadView | null; loadFocus?: string | null;
}) {
  const props = { result, selectedId, onSelect };
  // Category picked in the summary list; the table below lists only that category's changes.
  const [category, setCategory] = useState<string | null>(null);
  // A selection made elsewhere (3D, table) outside the picked category switches the table to its category.
  const selected = result.changes.find((c) => c.id === selectedId);
  const selectedCategory = selected && categoryOf(selected);
  useEffect(() => {
    if (category && selectedCategory && selectedCategory !== category) setCategory(selectedCategory);
  }, [selectedCategory]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pane sizes in px, set by dragging the splitters; each side pane can also be hidden.
  const [left, setLeft] = useState({ size: 320, open: true });
  const [right, setRight] = useState({ size: 352, open: true });
  const [bottom, setBottom] = useState({ size: 240, open: true });
  const resize = (set: typeof setLeft, max: number) => (d: number) =>
    set((p) => ({ ...p, size: clamp(p.size + d, 160, max) }));
  const toggle = (set: typeof setLeft) => () => set((p) => ({ ...p, open: !p.open }));
  // Picking a category lists it in the table, so bring the table back if it was hidden.
  const pick = (c: string | null) => {
    setCategory(c);
    if (c) setBottom((p) => ({ ...p, open: true }));
  };
  const maxHeight = typeof window === 'undefined' ? 800 : window.innerHeight * 0.7;
  return (
    // min-h-0 / min-w-0 throughout: the 3D canvas keeps its last pixel size, so without them the viewer
    // would not shrink and would spill over the other panes.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {left.open && (
          <aside data-testid="pane-summary" style={{ width: left.size }} className="min-h-0 shrink-0 overflow-hidden">
            <SummaryList result={result} category={category} onCategory={pick} />
          </aside>
        )}
        <Splitter dir="x" label="summary panel" onDrag={resize(setLeft, 640)}
          open={left.open} onToggle={toggle(setLeft)} arrows={['‹', '›']} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <StoryStrip result={result} story={story ?? null} onStory={onStory ?? (() => {})} />
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {viewer ?? <div className="flex h-full items-center justify-center text-sm text-slate-400">Viewer</div>}
          </div>
        </main>
        <Splitter dir="x" label="detail panel" onDrag={(d) => resize(setRight, 720)(-d)}
          open={right.open} onToggle={toggle(setRight)} arrows={['›', '‹']} />
        {right.open && (
          <aside data-testid="pane-detail" style={{ width: right.size }} className="min-h-0 shrink-0 overflow-y-auto">
            <DetailPanel {...props} />
            {loadView && result.loads && <LoadDetails result={result} view={loadView} focus={loadFocus ?? null} selectedId={selectedId} />}
          </aside>
        )}
      </div>
      <Splitter dir="y" label="change table" onDrag={(d) => resize(setBottom, maxHeight)(-d)}
        open={bottom.open} onToggle={toggle(setBottom)} arrows={['⌄', '⌃']} />
      {bottom.open && (
        <section data-testid="pane-table" style={{ height: bottom.size }} className="min-h-0 shrink-0">
          <ChangeTable {...props} category={category} onCategory={pick} />
        </section>
      )}
    </div>
  );
}

/** Model 1 and Model 2 side by side. With sync, orbiting one pane moves the other the same way. */
function SplitView({ sync, ...props }: Omit<ViewerProps, 'viewMode'>) {
  const box = useRef<HTMLDivElement>(null);
  const [share, setShare] = useState(50); // Model 1's share of the width, in percent
  const pane = (side: 'baseline' | 'revised') => (
    <div className="relative min-h-0 min-w-0 overflow-hidden" style={{ flex: side === 'baseline' ? share : 100 - share }}>
      <Viewer {...props} viewMode={side} sync={sync} legend={side === 'revised'} />
      <span className="pointer-events-none absolute left-2 top-2 rounded bg-white/90 px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
        {side === 'baseline' ? 'Model 1' : 'Model 2'}
      </span>
    </div>
  );
  return (
    <div ref={box} className="absolute inset-0 flex">
      {pane('baseline')}
      <Splitter dir="x" label="model panes" onDrag={(d) => setShare((s) => clamp(s + (100 * d) / (box.current?.clientWidth || 1), 15, 85))} />
      {pane('revised')}
    </div>
  );
}

// Text size: scales the root font size, and every size in the UI is in rem, so all text follows.
type TextSize = 'S' | 'M' | 'L';
const TEXT_PX: Record<TextSize, string> = { S: '14px', M: '16px', L: '18px' };
const TEXT_KEY = 'keeptabs.textSize';
function savedTextSize(): TextSize {
  try {
    const v = localStorage.getItem(TEXT_KEY);
    return v === 'S' || v === 'L' ? v : 'M';
  } catch {
    return 'M';
  }
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
  // Model 1 and Model 2 side by side, cameras linked unless the user unlinks them.
  const [linked, setLinked] = useState(true);
  const sync = useRef<CameraSync>({ driver: null, version: 0, position: [0, 0, 0], target: [0, 0, 0], zoom: 1 }).current;
  const [cameraMode, setCameraMode] = useState<CameraMode>('3d');
  const [textSize, setTextSize] = useState<TextSize>(savedTextSize);
  useEffect(() => {
    document.documentElement.style.fontSize = TEXT_PX[textSize];
    try { localStorage.setItem(TEXT_KEY, textSize); } catch { /* storage blocked: size just isn't remembered */ }
  }, [textSize]);
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
  const [duplicate, setDuplicate] = useState<{ result: Result; grids: GridLine[] } | null>(null);
  const [pendingWorkbook, setPendingWorkbook] = useState<{
    result: Result; grids: GridLine[]; action: 'append' | DuplicateAction; history: RegisterHistory;
  } | null>(null);
  const [registerMessage, setRegisterMessage] = useState('');
  // Applied loads: on by default, back to the default pick for each new pair; the element last hovered or
  // clicked shows its loads in the details panel.
  const [loadView, setLoadView] = useState<LoadView | null>(null);
  const [loadFocus, setLoadFocus] = useState<string | null>(null);

  // Each load starts from a clean slate: previous result, selection and story filter are dropped.
  useEffect(() => {
    let current = true;
    dispatch({ type: 'load_start' });
    setStory(null);
    setLoadView(null); // another pair may not have the same patterns
    setLoadFocus(null);
    if (waitingForFile) return;
    const loading = source === 'diff-file' && diffFile ? openDiffFile(diffFile)
      : source === 'e2k-upload' && compared ? compareModels(...compared)
        : loadScenario(source, { original, second });
    loading
      .then((result) => {
        if (!current) return;
        dispatch({ type: 'load_ok', result });
        setLoadView(result.loads ? defaultLoadView(result.loads) : null);
      })
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
  const viewerProps = load.status === 'ready' ? {
    result: load.result, selectedId: state.selectedChangeId, onSelect: select,
    cameraMode, colorBy, storyFilter: story, zoomTick, resetTick, loadView, onLoadFocus: setLoadFocus,
  } : null;

  const downloadRegister = (bytes: Uint8Array, version: string) => {
    const workbook = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(workbook).set(bytes);
    const blob = new Blob([workbook], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Analysis Register - ${version.replace(/[\\/:*?"<>|]/g, '-')}.xlsx`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const appendToWorkbook = (
    input: Uint8Array, result: Result, grids: GridLine[], action: 'append' | DuplicateAction, history: RegisterHistory,
  ) => {
    const update = updateWorkbook(input, result, grids, history, action);
    writeRegisterHistory(update.history);
    downloadRegister(update.bytes, update.block.version);
    setRegisterMessage(`${action === 'replace' ? 'Replaced' : action === 'new' ? 'Logged another entry for' : 'Added'} `
      + `${result.meta.source.baseline} → ${result.meta.source.revised}; downloaded Analysis Register - ${update.block.version}.xlsx.`);
  };

  const beginAppend = (
    result: Result, grids: GridLine[], action: 'append' | DuplicateAction, history: RegisterHistory,
  ) => {
    if (Object.keys(history).length > 0) {
      setPendingWorkbook({ result, grids, action, history });
      setRegisterMessage('Choose the latest Analysis Register workbook so edits made after downloading it are preserved.');
      return;
    }

    void fetch(`${import.meta.env.BASE_URL}analysis-register-template.xlsx`)
      .then((response) => {
        if (!response.ok) throw new Error('The Analysis Register template could not be loaded.');
        return response.arrayBuffer();
      })
      .then((buffer) => appendToWorkbook(new Uint8Array(buffer), result, grids, action, history))
      .catch((error: unknown) => setRegisterMessage(error instanceof Error ? error.message : 'Could not create the Analysis Register.'));
  };

  const startAppend = async () => {
    if (load.status !== 'ready' || load.result.mock || !['hack-models', 'e2k-upload'].includes(source)) return;
    setRegisterMessage('');
    try {
      const history = readRegisterHistory();
      const grids = await comparisonGrids(load.result, source, originalFile, revisedFile);
      if (history[comparisonKey(load.result)]?.length) {
        setDuplicate({ result: load.result, grids });
        return;
      }
      beginAppend(load.result, grids, 'append', history);
    } catch (error) {
      setRegisterMessage(error instanceof Error ? error.message : 'Could not prepare the Analysis Register.');
    }
  };

  const handleRegisterFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const pending = pendingWorkbook;
    setPendingWorkbook(null);
    if (!pending) return;
    if (!file) {
      setRegisterMessage('No workbook selected; no changes were made.');
      return;
    }
    void file.arrayBuffer()
      .then((buffer) => appendToWorkbook(
        new Uint8Array(buffer), pending.result, pending.grids, pending.action, pending.history,
      ))
      .catch((error: unknown) => setRegisterMessage(error instanceof Error ? error.message : 'Could not append to the selected workbook.'));
  };

  const resolveDuplicate = (action: DuplicateAction | 'reject') => {
    const selected = duplicate;
    setDuplicate(null);
    if (!selected || action === 'reject') return;
    try {
      beginAppend(selected.result, selected.grids, action, readRegisterHistory());
    } catch (error) {
      setRegisterMessage(error instanceof Error ? error.message : 'Could not read the saved Analysis Register history.');
    }
  };
  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-2">
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <img src="/keeptabs-icon.png" alt="" className="h-8 w-auto" />
          <span><span className="text-slate-800">keep</span><span className="text-blue-700">TABS</span></span>
        </h1>
        <Toggle label="Page" value={page} onChange={setPage} options={[['review', 'Review'], ['log', 'Revision log']]} />
        <Toggle label="Text" value={textSize} onChange={setTextSize} options={[['S', 'S'], ['M', 'M'], ['L', 'L']]} />
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
            {modelSelect('Model 1', original, setOriginal)}
            <span className="text-slate-400">→</span>
            {modelSelect('Model 2', second, setSecond)}
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
        <button aria-pressed={linked} onClick={() => setLinked((l) => !l)}
          className={`rounded px-2 py-0.5 text-xs ${linked ? 'bg-slate-800 text-white' : 'bg-slate-100 hover:bg-slate-200'}`}>
          {linked ? 'Views linked' : 'Views unlinked'}
        </button>
        <Toggle label="View" value={cameraMode} onChange={setCameraMode}
          options={[['3d', '3D'], ['plan', 'Plan'], ['N', 'N'], ['S', 'S'], ['E', 'E'], ['W', 'W']]} />
        <Toggle label="Color by" value={colorBy} onChange={setColorBy}
          options={[['change', 'Change type'], ['property', 'Section/Material']]} />
        <button className="rounded bg-slate-100 px-2 py-0.5 text-xs hover:bg-slate-200 disabled:opacity-40"
          disabled={!state.selectedChangeId} onClick={() => setZoomTick((t) => t + 1)}>Zoom to selected</button>
        <button className="rounded bg-slate-100 px-2 py-0.5 text-xs hover:bg-slate-200"
          onClick={() => setResetTick((t) => t + 1)}>Reset view</button>
        <button
          className="rounded bg-blue-700 px-3 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={page !== 'review' || load.status !== 'ready' || load.result.mock || !['hack-models', 'e2k-upload'].includes(source)}
          onClick={startAppend}
        >
          Append Excel Log
        </button>
        {load.status === 'ready' && load.result.loads && <LoadsControl loads={load.result.loads} view={loadView} onChange={setLoadView} />}
        {load.status === 'ready' && (
          <span className="ml-auto text-xs text-slate-500">
            {load.result.meta.source.baseline} → {load.result.meta.source.revised} · {load.result.meta.units.length}, {load.result.meta.units.force}
          </span>
        )}
      </header>
      {registerMessage && <p role="status" className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">{registerMessage}</p>}
      {pendingWorkbook && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="register-file-title"
            className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl">
            <h2 id="register-file-title" className="text-base font-semibold">Choose the latest Analysis Register</h2>
            <p className="text-sm text-slate-600">Selecting the latest downloaded workbook preserves prior log entries and your edits.</p>
            <label className="block text-sm text-slate-700">Excel workbook
              <input type="file" accept=".xlsx" className="mt-1 block w-full text-sm" onChange={handleRegisterFile} />
            </label>
            <div className="flex justify-end">
              <button className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
                onClick={() => { setPendingWorkbook(null); setRegisterMessage('No changes were made.'); }}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {duplicate && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="duplicate-title"
            className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl">
            <h2 id="duplicate-title" className="text-base font-semibold">This comparison is already in the register</h2>
            <p className="text-sm text-slate-600">
              {duplicate.result.meta.source.baseline} → {duplicate.result.meta.source.revised}
            </p>
            <p className="text-sm text-slate-600">Reject this append, replace the previous generated entry, or log it as a new entry.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => resolveDuplicate('reject')}>Reject</button>
              <button className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => resolveDuplicate('replace')}>Replace</button>
              <button className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white hover:bg-blue-800" onClick={() => resolveDuplicate('new')}>Log new entry</button>
            </div>
          </section>
        </div>
      )}
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
      {page === 'review' && viewerProps && (
        <Workspace
          result={viewerProps.result}
          selectedId={state.selectedChangeId}
          onSelect={select}
          story={story}
          onStory={setStory}
          loadView={loadView}
          loadFocus={loadFocus}
          viewer={
            <Suspense fallback={<div className="p-4 text-sm text-slate-400">Loading viewer…</div>}>
              <SplitView {...viewerProps} sync={linked ? sync : null} />
            </Suspense>
          }
        />
      )}
    </div>
  );
}
