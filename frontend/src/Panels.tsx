// Summary list, detail panel and change table. All three read the same selectedId and call the
// same onSelect, so a click in any of them selects the same change everywhere.
import { useEffect, useRef, useState } from 'react';
import type { Change, Result } from './keeptabsTypes';
import {
  byExtent, describeChange, fmt, headlineCounts, memberMap, memberName, storyChangeCounts, unitFor,
} from './data';
import { CATEGORY_TITLE, SECTIONS, categoryOf } from './categories';

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

/** Count badge, shaded from light to dark blue as the count nears the largest in this comparison; 0 stays gray. */
function CountBadge({ n, max }: { n: number; max: number }) {
  if (n === 0) return <span className="min-w-6 rounded-full bg-slate-100 px-1.5 text-center text-[11px] text-slate-400">0</span>;
  const t = n / Math.max(1, max);
  const light = 90 - 52 * t; // 90% (few) to 38% (most)
  return (
    <span className="min-w-6 rounded-full px-1.5 text-center text-[11px] font-semibold"
      style={{ background: `hsl(217 80% ${light}%)`, color: light < 62 ? 'white' : 'hsl(217 80% 25%)' }}>
      {n}
    </span>
  );
}

/** Headline counts, then the model categories in collapsible sections. Clicking a category lists its changes in the table below. */
export function SummaryList({ result, category, onCategory }: {
  result: Result; category: string | null; onCategory: (c: string | null) => void;
}) {
  const counts = headlineCounts(result);
  const perCategory = new Map<string, number>();
  for (const c of result.changes) perCategory.set(categoryOf(c), (perCategory.get(categoryOf(c)) ?? 0) + 1);
  const max = Math.max(0, ...perCategory.values());
  const notCompared = result.warnings.coverage.filter((c) => c.status === 'seen_not_compared').length;
  // Sections with changes start open, empty ones closed; a click flips that.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const flip = (title: string) => setFlipped((f) => {
    const next = new Set(f);
    if (!next.delete(title)) next.add(title);
    return next;
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-3">
        <div className="text-sm text-slate-700">
          {counts.added} added · {counts.removed} removed · {counts.modified} modified
        </div>
        <div className="text-xs text-slate-500">{counts.label_only} label-only (not physical)</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {SECTIONS.map((sec) => {
          const total = sec.items.reduce((n, c) => n + (perCategory.get(c.id) ?? 0), 0);
          const open = (total > 0) !== flipped.has(sec.title);
          return (
            <section key={sec.title} className="border-b border-slate-200">
              <button
                data-testid={`section-${sec.title}`}
                aria-expanded={open}
                onClick={() => flip(sec.title)}
                className="flex w-full items-center gap-2 bg-slate-50 px-3 py-1.5 text-left hover:bg-slate-100"
              >
                <span className="w-3 text-[10px] text-slate-500">{open ? '▾' : '▸'}</span>
                <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-slate-800">{sec.title}</span>
                {sec.items.some((c) => c.compared) && <CountBadge n={total} max={max} />}
              </button>
              {open && sec.items.map((c) => {
                const n = perCategory.get(c.id) ?? 0;
                const active = category === c.id;
                return (
                  <button
                    key={c.id}
                    data-testid={`category-${c.id}`}
                    aria-pressed={active}
                    disabled={n === 0}
                    onClick={() => onCategory(active ? null : c.id)}
                    className={`flex w-full items-center gap-2 py-1 pl-8 pr-3 text-left disabled:cursor-default ${
                      active ? 'bg-slate-100 ring-1 ring-inset ring-slate-400' : 'enabled:hover:bg-slate-50'}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block text-xs ${c.compared ? 'text-slate-800' : 'text-slate-400'}`}>{c.title}</span>
                      {c.compared && c.note && <span className="block text-[10px] italic text-slate-400">{c.note}</span>}
                    </span>
                    {c.compared ? <CountBadge n={n} max={max} />
                      : <span className="text-[10px] italic text-slate-400">Not compared</span>}
                  </button>
                );
              })}
              {open && sec.title === 'Other' && notCompared > 0 && (
                <p className="py-1 pl-8 pr-3 text-[11px] italic text-slate-400">
                  {notCompared} record type{notCompared === 1 ? '' : 's'} seen in the file, not compared
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- detail panel ----------------

export function DetailPanel({ result, selectedId }: PanelProps) {
  const change = result.changes.find((c) => c.id === selectedId);
  if (!change) return <p className="p-4 text-sm text-slate-500">Select a change to see its details.</p>;
  const members = memberMap(result);
  const fields = [...new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})])];

  return (
    <div className="space-y-4 p-4 text-sm" data-testid="detail">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-base font-semibold">{change.id}</h2>
          <Badge>{TYPE_LABEL[change.type]}</Badge>
        </div>
        <p className="text-xs text-slate-500">{CATEGORY_TITLE[categoryOf(change)]}</p>
        <p className="mt-2">{describeChange(change, result, members)}</p>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500"><th>Field</th><th>Model 1</th><th>Model 2</th></tr>
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
        {/* Plain text until member-level focus in the viewer exists: a link that does nothing reads as broken. */}
        <ul className="mt-1 max-h-32 overflow-y-auto text-xs">
          {change.member_ids.map((id) => (
            <li key={id}>
              <span className="text-slate-800">{memberName(members.get(id))}</span>
            </li>
          ))}
        </ul>
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

type SortKey = 'id' | 'type' | 'category' | 'extent';

export function ChangeTable({ result, selectedId, onSelect, category, onCategory }: PanelProps & {
  category: string | null; onCategory: (c: string | null) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'extent', asc: false });
  const [typeFilter, setTypeFilter] = useState('');
  const members = memberMap(result);

  const rows = result.changes
    .filter((c) => (!typeFilter || c.type === typeFilter) && (!category || categoryOf(c) === category))
    .sort((a, b) => {
      const d = sort.key === 'extent' ? -byExtent(a, b) : sortValue(a, sort.key).localeCompare(sortValue(b, sort.key));
      return sort.asc ? d : -d;
    });

  const header = (key: SortKey, label: string) => (
    <th className="px-2 py-1" aria-sort={sort.key === key ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
      <button className="hover:text-slate-800"
        onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}>
        {label}{sort.key === key ? (sort.asc ? ' ▲' : ' ▼') : ''}
      </button>
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
        <label>Category{' '}
          <select value={category ?? ''} onChange={(e) => onCategory(e.target.value || null)} className="border">
            <option value="">All</option>
            {[...new Set(result.changes.map(categoryOf))].map((id) => <option key={id} value={id}>{CATEGORY_TITLE[id]}</option>)}
          </select>
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-white text-slate-500">
            <tr>
              {header('id', 'ID')}{header('type', 'Type')}{header('category', 'Category')}
              <th className="px-2 py-1">Member(s)</th><th className="px-2 py-1">Model 1</th><th className="px-2 py-1">Model 2</th>
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

const sortValue = (c: Change, key: Exclude<SortKey, 'extent'>) => (key === 'category' ? CATEGORY_TITLE[categoryOf(c)] : c[key]);

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
      <td className="px-2 py-1">{CATEGORY_TITLE[categoryOf(c)]}</td>
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
