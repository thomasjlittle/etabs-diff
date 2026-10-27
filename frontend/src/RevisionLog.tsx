// Revision log page: one row per model version, newest first, with a branch graph like `git log --graph`.
// Click a row to review it against its first parent; tick two rows to compare those two.
import { useEffect, useMemo, useState } from 'react';
import { AddVersion } from './AddVersion';
import { layoutGraph, modelName, REVISIONS, type GraphRow, type Revision } from './revisions';

type Counts = Record<'added' | 'removed' | 'modified' | 'affected', number>;
const DIFFS = import.meta.glob('../demo_viewer/diffs/*__*.json');
const LANE = 16; // px per lane
const NODE_Y = 18; // px from the row top to the node
const COLORS = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#7c3aed'];
const x = (lane: number) => lane * LANE + LANE / 2;

/** Element counts from the engine's precomputed diff of `child` against `parent`. */
async function loadCounts(parent: string, child: string): Promise<Counts | null> {
  const load = DIFFS[`../demo_viewer/diffs/${modelName(parent)}__${modelName(child)}.json`];
  return load ? ((await load()) as { default: { summary: Counts } }).default.summary : null;
}

function Graph({ row, width }: { row: GraphRow; width: number }) {
  const { rev, lane, above, below } = row;
  const color = (i: number) => COLORS[i % COLORS.length];
  return (
    // Absolutely placed so the row height comes from the text and the lanes stretch to fill it.
    <div className="relative shrink-0" style={{ width }}><svg width={width} className="absolute inset-0 h-full" aria-hidden="true">
      {above.map((f, i) => f && (f === rev.file
        ? <line key={`in${i}`} x1={x(i)} y1={0} x2={x(lane)} y2={NODE_Y} stroke={color(i)} strokeWidth={2} />
        : <line key={`by${i}`} x1={x(i)} y1={0} x2={x(i)} y2="100%" stroke={color(i)} strokeWidth={2} />))}
      {rev.parents.map((p, n) => {
        const j = n === 0 ? lane : below.indexOf(p); // the first parent always continues the node's lane
        return <line key={`out${p}`} x1={x(lane)} y1={NODE_Y} x2={x(j)} y2="100%" stroke={color(j)} strokeWidth={2} />;
      })}
      <circle cx={x(lane)} cy={NODE_Y} r={5} fill="white" stroke={color(lane)} strokeWidth={2.5} />
    </svg></div>
  );
}

function CountChips({ counts }: { counts: Counts | null | undefined }) {
  if (counts === undefined) return <span className="text-xs text-slate-400">…</span>;
  if (counts === null) return <span className="text-xs text-slate-400">root</span>;
  const chip = (n: number, label: string, cls: string) =>
    <span className={`rounded px-1.5 py-0.5 ${n ? cls : 'bg-slate-50 text-slate-400'}`}>{n} {label}</span>;
  return (
    <span className="flex gap-1 text-[0.6875rem]">
      {chip(counts.added, 'added', 'bg-green-100 text-green-800')}
      {chip(counts.removed, 'removed', 'bg-red-100 text-red-800')}
      {chip(counts.modified, 'modified', 'bg-amber-100 text-amber-800')}
      {chip(counts.affected, 'affected', 'bg-sky-100 text-sky-800')}
    </span>
  );
}

const showDate = (d: string) => (d ? d.replace('T', ' ') : 'date unknown');

export function RevisionLog({ onOpen, revisions = REVISIONS }: {
  onOpen: (original: string, second: string) => void; revisions?: Revision[];
}) {
  const rows = useMemo(() => layoutGraph(revisions), [revisions]);
  const width = (Math.max(1, ...rows.map((r) => Math.max(r.above.length, r.below.length, r.lane + 1))) * LANE) + 4;
  const [counts, setCounts] = useState<Record<string, Counts | null>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    let current = true;
    Promise.all(revisions.map(async (r) => [r.file, r.parents.length ? await loadCounts(r.parents[0], r.file) : null] as const))
      .then((all) => current && setCounts(Object.fromEntries(all)));
    return () => { current = false; };
  }, [revisions]);

  // Keep at most two picks; a third replaces the older pick.
  const pick = (file: string) => setPicked((p) => (p.includes(file) ? p.filter((f) => f !== file) : [...p, file].slice(-2)));
  const order = (f: string) => revisions.findIndex((r) => r.file === f);
  const compare = () => {
    const [a, b] = [...picked].sort((p, q) => order(p) - order(q)); // older one is the original
    onOpen(modelName(a), modelName(b));
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2 text-xs text-slate-500">
        <span>{revisions.length} revisions. Click one to review it against its parent, or tick two to compare.</span>
        <button className="rounded bg-slate-800 px-2 py-0.5 text-white disabled:opacity-40"
          disabled={picked.length !== 2} onClick={compare}>Compare selected</button>
      </div>
      <AddVersion revisions={revisions} />
      <ol>
        {rows.map((row) => {
          const { rev } = row;
          const parent = rev.parents[0];
          const expanded = open.has(rev.file);
          return (
            <li key={rev.file} className="flex border-b border-slate-100 hover:bg-slate-50">
              <div className="flex pl-3"><Graph row={row} width={width} /></div>
              <input type="checkbox" className="mx-2 mt-3 self-start" aria-label={`Select ${rev.file}`}
                checked={picked.includes(rev.file)} onChange={() => pick(rev.file)} />
              <div className="min-w-0 flex-1 py-2 pr-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button className="text-left text-sm font-medium hover:underline disabled:no-underline"
                    disabled={!parent} title={parent ? `Review against ${parent}` : 'First revision, nothing to compare against'}
                    onClick={() => parent && onOpen(modelName(parent), modelName(rev.file))}>
                    {rev.summary}
                  </button>
                  {rev.body && (
                    <button className="text-xs text-blue-700 underline" aria-expanded={expanded}
                      onClick={() => setOpen((s) => { const n = new Set(s); if (!n.delete(rev.file)) n.add(rev.file); return n; })}>
                      {expanded ? 'less' : 'more'}
                    </button>
                  )}
                  <span className="ml-auto"><CountChips counts={counts[rev.file]} /></span>
                </div>
                <div className="text-xs text-slate-500">
                  <span className="font-mono text-slate-700">{rev.file}</span>
                  {rev.parents.length > 0 && <> · from {rev.parents.join(', ')}</>} · {rev.author} · {showDate(rev.date)}
                </div>
                {expanded && <p className="mt-1 max-w-3xl whitespace-pre-line text-sm text-slate-700">{rev.body}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
