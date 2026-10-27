// Summary list, detail panel and change table. All three read the same selectedId and call the
// same onSelect, so a click in any of them selects the same change everywhere.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Change, Result } from './vantageTypes';
import {
  byExtent, describeChange, fmt, groupCoverage, headlineCounts, memberMap, memberName, storyChangeCounts, unitFor,
} from './data';

export interface PanelProps {
  result: Result;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const TYPE_LABEL: Record<Change['type'], string> = {
  added: 'Added', removed: 'Removed', modified: 'Modified', label_only: 'Label only',
};

/** Scroll the selected element into view (guarded: jsdom has no scrollIntoView). */
function useScrollWhenSelected<T extends HTMLElement>(selected: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  return ref;
}

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
    {children}
  </span>
);

// ---------------- summary list ----------------

export function SummaryList({ result, selectedId, onSelect }: PanelProps) {
  const [zoomed, setZoomed] = useState(true);
  const byId = useMemo(() => new Map(result.changes.map((c) => [c.id, c])), [result]);
  const counts = headlineCounts(result);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-3">
        <div className="text-sm text-slate-700">
          {counts.added} added · {counts.removed} removed · {counts.modified} modified
        </div>
        <div className="text-xs text-slate-500">{counts.label_only} label-only (not physical)</div>
        <button
          className="mt-2 text-xs text-blue-700 underline"
          onClick={() => setZoomed((z) => !z)}
        >
          {zoomed ? 'Show high-level summary' : 'Show every change'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {result.groups.map((g) => {
          const items = g.change_ids.map((id) => byId.get(id)!).sort(byExtent);
          const coverage = groupCoverage(result, g.id);
          return (
            <section key={g.id} className="border-b border-slate-100 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-800">
                  {g.id === 'LO' ? '' : `${g.id} `}{g.title}
                </h3>
                <Badge>{g.tier}</Badge>
              </div>
              {coverage === 'seen_not_compared' ? (
                <p className="mt-1 text-xs italic text-slate-500">Seen, not compared</p>
              ) : !zoomed || items.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">
                  {items.length} change{items.length === 1 ? '' : 's'}
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {items.map((c) => (
                    <SummaryItem key={c.id} change={c} result={result} selected={c.id === selectedId} onSelect={onSelect} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SummaryItem({ change, result, selected, onSelect }: {
  change: Change; result: Result; selected: boolean; onSelect: (id: string) => void;
}) {
  const ref = useScrollWhenSelected<HTMLLIElement>(selected);
  const [open, setOpen] = useState(false);
  const members = memberMap(result);
  const isLevel = change.type === 'added' && change.after && 'story' in change.after;
  return (
    <li ref={ref}>
      <button
        data-testid={`summary-${change.id}`}
        aria-current={selected}
        onClick={() => onSelect(change.id)}
        className={`w-full rounded px-2 py-1 text-left text-xs ${selected ? 'bg-blue-100 ring-1 ring-blue-500' : 'hover:bg-slate-100'}`}
      >
        <span className="font-mono text-slate-500">{change.id}</span>{' '}
        {isLevel
          ? `Level ${change.after!.story} added, ${change.extent.members} members`
          : describeChange(change, result, members)}
      </button>
      {isLevel && (
        <div className="pl-2">
          <button className="text-[11px] text-blue-700 underline" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide members' : 'Show members'}
          </button>
          {open && (
            <ul className="text-[11px] text-slate-600">
              {change.member_ids.map((id) => <li key={id}>{memberName(members.get(id))}</li>)}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------- detail panel ----------------

export function DetailPanel({ result, selectedId, onSelect }: PanelProps) {
  const change = result.changes.find((c) => c.id === selectedId);
  if (!change) return <p className="p-4 text-sm text-slate-500">Select a change to see its details.</p>;
  const members = memberMap(result);
  const fields = [...new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})])];
  const group = result.groups.find((g) => g.id === change.group);

  return (
    <div className="space-y-4 p-4 text-sm" data-testid="detail">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-base font-semibold">{change.id}</h2>
          <Badge>{TYPE_LABEL[change.type]}</Badge>
        </div>
        <p className="text-xs text-slate-500">{group?.title}</p>
        <p className="mt-2">{describeChange(change, result, members)}</p>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500"><th>Field</th><th>Before</th><th>After</th></tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f} className="border-t border-slate-100">
              <td className="py-1 font-mono">{f}</td>
              <td>{fmt(change.before?.[f], unitFor(change, f, result))}</td>
              <td>{fmt(change.after?.[f], unitFor(change, f, result))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div>
        <h3 className="text-xs font-semibold text-slate-700">Affected members ({change.member_ids.length})</h3>
        {/* Clicking a member re-selects its change; member-level focus in the viewer comes with step 2. */}
        <ul className="mt-1 max-h-32 overflow-y-auto text-xs">
          {change.member_ids.map((id) => (
            <li key={id}>
              <button className="text-blue-700 hover:underline" onClick={() => onSelect(change.id)}>
                {memberName(members.get(id))}
              </button>
              <span className="ml-1 font-mono text-[10px] text-slate-400">{id}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-slate-700">Source evidence</h3>
        {change.evidence.length === 0 ? (
          <p className="mt-1 text-[11px] italic text-slate-500">Not available: this data source has no source line numbers.</p>
        ) : (
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(['baseline', 'revised'] as const).map((file) => {
            const ev = change.evidence.find((e) => e.file === file);
            return (
              <div key={file} className="rounded border border-slate-200 bg-slate-50 p-2">
                <div className="text-[10px] uppercase text-slate-500">
                  {file}: {file === 'baseline' ? result.meta.source.baseline : result.meta.source.revised}
                </div>
                {ev ? (
                  <pre className="mt-1 overflow-x-auto text-[10px] leading-4">
                    {ev.raw.map((line, i) => `${String(ev.lines[0] + i).padStart(4)}  ${line}`).join('\n')}
                  </pre>
                ) : (
                  <p className="mt-1 text-[10px] italic text-slate-400">Not present in this file</p>
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
}

// ---------------- story strip ----------------

/** One cell per story, bottom to top, shaded by how many changes touch it. Click to filter the viewer. */
export function StoryStrip({ result, story, onStory }: {
  result: Result; story: string | null; onStory: (s: string | null) => void;
}) {
  const counts = storyChangeCounts(result);
  const max = Math.max(1, ...Object.values(counts));
  const stories = [...result.stories].sort((a, b) => a.elevation - b.elevation);
  return (
    <div className="flex items-center gap-1 border-b border-slate-200 px-3 py-1 text-[11px]">
      <span className="mr-1 text-slate-500">Stories</span>
      {stories.map((s) => {
        const n = counts[s.name] ?? 0;
        const active = story === s.name;
        return (
          <button
            key={s.name}
            data-testid={`story-${s.name}`}
            onClick={() => onStory(active ? null : s.name)}
            title={`${s.name}: ${n} change${n === 1 ? '' : 's'}`}
            className={`min-w-12 rounded px-2 py-0.5 ${active ? 'ring-2 ring-blue-600' : 'ring-1 ring-slate-200'}`}
            style={{ background: `rgba(71, 85, 105, ${n ? 0.12 + 0.5 * (n / max) : 0})`, color: n / max > 0.6 ? 'white' : undefined }}
          >
            {s.name} · {n}
          </button>
        );
      })}
      {story && <button className="ml-2 text-blue-700 underline" onClick={() => onStory(null)}>Show all</button>}
    </div>
  );
}

// ---------------- change table ----------------

type SortKey = 'id' | 'type' | 'group' | 'extent';

export function ChangeTable({ result, selectedId, onSelect }: PanelProps) {
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'extent', asc: false });
  const [typeFilter, setTypeFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const members = memberMap(result);

  const rows = result.changes
    .filter((c) => (!typeFilter || c.type === typeFilter) && (!groupFilter || c.group === groupFilter))
    .sort((a, b) => {
      const d = sort.key === 'extent' ? -byExtent(a, b) : a[sort.key].localeCompare(b[sort.key]);
      return sort.asc ? d : -d;
    });

  const header = (key: SortKey, label: string) => (
    <th className="cursor-pointer px-2 py-1" onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}>
      {label}{sort.key === key ? (sort.asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-3 border-b border-slate-200 px-3 py-1 text-xs">
        <label>Type{' '}
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="border">
            <option value="">All</option>
            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Group{' '}
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="border">
            <option value="">All</option>
            {result.groups.map((g) => <option key={g.id} value={g.id}>{g.id} {g.title}</option>)}
          </select>
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-white text-slate-500">
            <tr>
              {header('id', 'ID')}{header('type', 'Type')}{header('group', 'Group')}
              <th className="px-2 py-1">Member(s)</th><th className="px-2 py-1">Before</th><th className="px-2 py-1">After</th>
              {header('extent', 'Extent')}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <Row key={c.id} change={c} result={result} members={members} selected={c.id === selectedId} onSelect={onSelect} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ change: c, result, members, selected, onSelect }: {
  change: Change; result: Result; members: ReturnType<typeof memberMap>; selected: boolean; onSelect: (id: string) => void;
}) {
  const ref = useScrollWhenSelected<HTMLTableRowElement>(selected);
  const values = (v: Change['before']) =>
    v ? Object.entries(v).map(([k, x]) => `${k} ${fmt(x, unitFor(c, k, result))}`).join('; ') : '—';
  const first = members.get(c.member_ids[0]);
  return (
    <tr
      ref={ref}
      data-testid={`row-${c.id}`}
      aria-selected={selected}
      onClick={() => onSelect(c.id)}
      className={`cursor-pointer border-t border-slate-100 ${selected ? 'bg-blue-100' : 'hover:bg-slate-50'}`}
    >
      <td className="px-2 py-1 font-mono">{c.id}</td>
      <td className="px-2 py-1">{TYPE_LABEL[c.type]}</td>
      <td className="px-2 py-1">{c.group}</td>
      <td className="px-2 py-1">
        {c.subject ?? (first ? `${first.label} @ ${first.story}` : '—')}
        {c.member_ids.length > 1 ? ` +${c.member_ids.length - 1}` : ''}
      </td>
      <td className="px-2 py-1">{values(c.before)}</td>
      <td className="px-2 py-1">{values(c.after)}</td>
      <td className="px-2 py-1">
        {c.extent.members} mbr{c.extent.distance ? `, ${fmt(c.extent.distance, result.meta.units.length)}` : ''}
      </td>
    </tr>
  );
}
