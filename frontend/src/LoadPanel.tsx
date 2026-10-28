// Applied loads UI outside the 3D view: the top-bar control and the loads section of the details panel.
import type { Result } from './keeptabsTypes';
import {
  type LoadPick, type LoadSide, type LoadView, type LoadedElement, type ModelLoads, defaultLoadView, describeLoad,
  loadChanged, loadsFor, pickFactors, pickOptions,
} from './loads';

const KIND_TITLE: Record<LoadPick['kind'], string> = { pattern: 'Patterns', case: 'Cases', combo: 'Combos' };
const MODEL: Record<LoadSide, string> = { a: 'Model 1', b: 'Model 2' };

/** On by default. Pick a pattern, case or combo and the arrow scale; each pane draws its own model's loads. */
export function LoadsControl({ loads, view, onChange }: {
  loads: ModelLoads; view: LoadView | null; onChange: (v: LoadView | null) => void;
}) {
  const options = pickOptions(loads);
  // Self-weight is not an element load, so it is never drawn; say so when the pick includes it.
  const selfWeight = view ? [...new Set((['a', 'b'] as const).flatMap((side) => {
    const f = pickFactors(loads.definitions?.[side], view.pick);
    return 'factors' in f ? Object.keys(f.factors).filter((p) => loads.definitions?.[side].patterns[p]?.selfWeight) : [];
  }))] : [];
  return (
    <div className="flex items-center gap-2 text-xs">
      <label className="flex items-center gap-1 text-slate-500">
        <input type="checkbox" aria-label="Show loads" checked={!!view}
          onChange={(e) => onChange(e.target.checked ? defaultLoadView(loads) : null)} />
        Loads
      </label>
      {view && (
        <>
          <select aria-label="Load pick" value={`${view.pick.kind}:${view.pick.name}`} className="rounded border px-1 text-slate-900"
            onChange={(e) => {
              const [kind, ...name] = e.target.value.split(':');
              onChange({ ...view, pick: { kind: kind as LoadPick['kind'], name: name.join(':') } });
            }}>
            {(['pattern', 'case', 'combo'] as const).filter((k) => options[k].length).map((k) => (
              <optgroup key={k} label={KIND_TITLE[k]}>
                {options[k].map((n) => <option key={n} value={`${k}:${n}`}>{n}</option>)}
              </optgroup>
            ))}
          </select>
          <label className="flex items-center gap-1 text-slate-500">Scale
            <input type="range" aria-label="Load scale" min={0.25} max={4} step={0.25} value={view.scale}
              onChange={(e) => onChange({ ...view, scale: Number(e.target.value) })} />
          </label>
          {selfWeight.length > 0 && <span className="text-slate-500">Self-weight ({selfWeight.join(', ')}) not drawn</span>}
        </>
      )}
    </div>
  );
}

const elementName = (e: LoadedElement) =>
  `${e.kind === 'point' ? 'Joint' : e.subtype[0].toUpperCase() + e.subtype.slice(1)} ${e.label} at ${e.story}`;

/** Loads on the hovered or selected element, both models, with values and units. */
export function LoadDetails({ result, view, focus, selectedId }: {
  result: Result; view: LoadView; focus: string | null; selectedId: string | null;
}) {
  const loads = result.loads!;
  const selected = result.changes.find((c) => c.id === selectedId)?.member_ids ?? [];
  const el = loads.elements.find((e) => e.key === focus) ?? loads.elements.find((e) => selected.includes(e.key));
  if (!el) return <p className="px-4 pb-4 text-xs text-slate-500">Hover or click a loaded element to see its loads.</p>;
  const changed = loadChanged(el, view.pick, loads.definitions);
  return (
    <div className="space-y-2 border-t border-slate-200 p-4 text-xs" data-testid="load-detail">
      <div>
        <h3 className="font-semibold text-slate-700">Loads on {elementName(el)}</h3>
        <p className="text-slate-500">
          {view.pick.name} ({view.pick.kind}) · {changed
            ? <span className="font-semibold text-red-700">differs between models</span> : 'same in both models'}
        </p>
      </div>
      {(['a', 'b'] as const).map((side) => {
        const ls = loadsFor(el, side, view.pick, loads.definitions);
        const factors = pickFactors(loads.definitions?.[side], view.pick);
        return (
          <div key={side}>
            <div className="font-semibold text-slate-800">{MODEL[side]}</div>
            {'reason' in factors ? <p className="text-amber-700">not drawn: {factors.reason}</p> : (
              <ul className={changed ? 'text-red-700' : 'text-slate-700'}>
                {ls.length ? ls.map((l, i) => <li key={i}>{describeLoad(l, el.kind)}</li>) : <li className="text-slate-400">none</li>}
              </ul>
            )}
            {view.pick.kind !== 'pattern' && 'factors' in factors && (
              <ul className="text-slate-500">
                {Object.entries(factors.factors).map(([p, f]) => (
                  <li key={p}>
                    {f} × {p}: {(el.loads[side][p] ?? []).map((l) => describeLoad(l, el.kind)).join('; ') || 'none'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
