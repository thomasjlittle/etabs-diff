// Adapter: diff_engine output (frontend/demo_viewer/contract.ts, schemaVersion 0.2) -> keepTABS Result.
// Every source in the app goes through it: uploads, the Hack model pairs, the seeded demo and diff files.
//
// Element-level changes are split by category (categories.ts). "affected" elements carry their
// upstream definition's changes; those are reported once, as the table (definition) change, with
// every member whose `via` names it. Areas (floors, walls) are listed as changes but not drawn.
import type { Change as EChange, DiffOutput, ElementDiff as EElement, TableDiff } from '../demo_viewer/contract';
import type { Change, Member, Node, Result, Side, Value, Vec3 } from './keeptabsTypes';
import { fieldCategory, tableCategory } from './categories';
import { loadField, loadValue } from './loads';

export type EngineDiff = DiffOutput;

// engine table -> subject prefix
const TABLES: Record<string, string> = {
  stories: 'Story', materials: 'Material', frameSections: 'Section', shellSections: 'Shell section',
  pointSprings: 'Point spring', lineSprings: 'Line spring', areaSprings: 'Area spring',
  loadPatterns: 'Load pattern', loadSets: 'Load set', loadCases: 'Load case', combos: 'Combo',
  massSource: 'Mass source', functions: 'Function',
};

/** The `via` reference the engine writes for a table entry: materials + NAME -> "material:NAME". */
const viaRef = (table: string, name: string) => `${table.replace(/ies$/, 'y').replace(/s$/, '')}:${name}`;

function toValue(v: unknown): Value {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'number')) return v as number[];
    return v.map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x))).join(', ');
  }
  return JSON.stringify(v);
}

function withValueUnits(value: unknown, units: Record<string, string | null>, path = ''): unknown {
  if (Array.isArray(value)) return value.map((v, i) => withValueUnits(v, units, path ? `${path}.${i}` : String(i)));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, v]) => [key, withValueUnits(v, units, path ? `${path}.${key}` : key)]));
  return typeof value === 'number' && units[path] ? `${value} ${units[path]}` : value;
}
const changeValue = (c: EChange, side: 'before' | 'after') => toValue(withValueUnits(c[side], c.valueUnits?.[side] ?? {}));
const changeUnits = (cs: EChange[], field: (c: EChange) => string) => cs.some((c) => c.unit)
  ? { units: Object.fromEntries(cs.filter((c) => c.unit).map((c) => [field(c), c.unit!])) } : {};

const dist = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const key = (p: Vec3) => `N(${p.join(',')})`;
const sideOf = (s: EElement['status']): Side => (s === 'added' ? 'revised' : s === 'removed' ? 'baseline' : 'both');
const KINDS = new Set(['beam', 'column', 'brace']);

export function adaptEngine(d: EngineDiff, opts: { mock: boolean }): Result {
  const byKey = new Map(d.elements.map((e) => [e.key, e]));
  const frames = d.elements.filter((e) => e.kind === 'frame' && e.geometry.length === 2);
  const members: Member[] = frames.map((e) => ({
    id: e.key,
    kind: (KINDS.has(e.subtype) ? e.subtype : 'beam') as Member['kind'],
    end_nodes: [key(e.geometry[0]), key(e.geometry[1])],
    label: e.label,
    story: e.story,
    grid: e.grid ?? undefined,
    side: sideOf(e.status),
  }));
  const draft: Omit<Change, 'id'>[] = [];
  const subjectOf = (e: EElement) => `${e.kind === 'point' ? 'Joint' : e.subtype[0].toUpperCase() + e.subtype.slice(1)} ${e.label} at ${e.story}`;

  // ---- linked moves: one change per removed/added pair ----
  // Story elevation changes, keyed by baseline elevation. A move is measured relative to its story,
  // so a member that only rose with its story is not "moved" (CLAUDE.md); the shift is reported apart.
  const lift = new Map(d.stories.filter((s) => s.elevA !== null && s.elevB !== null).map((s) => [s.elevA!, s.elevB! - s.elevA!]));
  const lifted = (p: Vec3): Vec3 => [p[0], p[1], p[2] + (lift.get(p[2]) ?? 0)];

  const inMove = new Set<string>();
  for (const old of d.elements.filter((e) => e.status === 'removed' && e.movedTo)) {
    const now = byKey.get(old.movedTo!);
    if (!now || old.geometry.length !== 2 || now.geometry.length !== 2) continue;
    inMove.add(old.key).add(now.key);
    // Pair ends the way that moves them least (end order may differ between files).
    const [a0, a1] = old.geometry.map(lifted);
    const swap = dist(a0, now.geometry[1]) + dist(a1, now.geometry[0]) < dist(a0, now.geometry[0]) + dist(a1, now.geometry[1]);
    const [b0, b1] = swap ? [now.geometry[1], now.geometry[0]] : now.geometry;
    const raw = old.geometry; // drawn positions stay as in the files
    const ends = ([['end_i', a0, b0, raw[0]], ['end_j', a1, b1, raw[1]]] as [string, Vec3, Vec3, Vec3][])
      .filter(([, p, q]) => dist(p, q) > 1e-9);
    if (ends.length === 0) continue; // only the story moved
    const shift = Math.max(...old.geometry.map((p) => lift.get(p[2]) ?? 0));
    draft.push({
      type: 'modified', category: 'objects', member_ids: [old.key, now.key],
      extent: { members: 1, distance: Math.max(...ends.map(([, p, q]) => dist(p, q))) },
      before: Object.fromEntries(ends.map(([k, , , r]) => [k, r])),
      after: { ...Object.fromEntries(ends.map(([k, , q]) => [k, q])), ...(shift ? { story_shift: shift } : {}) },
      units: { ...Object.fromEntries(ends.map(([k]) => [k, 'length'])), story_shift: 'length' },
    });
  }

  // ---- element changes ----
  for (const e of d.elements) {
    if (inMove.has(e.key) || e.status === 'unchanged' || e.status === 'affected') continue;
    const drawn = e.kind === 'frame';
    if (e.status === 'added' || e.status === 'removed') {
      draft.push({
        type: e.status, category: 'objects', member_ids: drawn ? [e.key] : [],
        extent: { members: drawn ? 1 : 0, distance: 0 }, before: null, after: null,
        ...(drawn ? {} : { subject: subjectOf(e) }),
      });
      continue;
    }
    // modified: one change per category of fields, a rename on its own
    const byCategory = new Map<string, EChange[]>();
    // "material:4Ksi.name" etc. belong to a definition: reported once as its table change, with this member.
    for (const c of e.changes.filter((x) => !isDefinitionField(x.field))) {
      const k = c.kind === 'renamed' && c.field === 'label' ? 'rename' : fieldCategory(c.field);
      byCategory.set(k, [...(byCategory.get(k) ?? []), c]);
    }
    for (const [category, cs] of byCategory) {
      // A frame's SECTION reads as a reassignment ("section"); an area's stays a plain field change.
      const field = (c: EChange) => (drawn && category === 'sectionAssign' ? 'section' : loadField(c.field) ?? c.field);
      // Load fields read as words with their own units (kip/ft, psf), so they carry no separate unit.
      const value = (c: EChange, side: 'before' | 'after') => loadValue(c.field, e.kind, c[side]) ?? changeValue(c, side);
      draft.push({
        type: category === 'rename' ? 'label_only' : 'modified', category: category === 'rename' ? 'labelOnly' : category,
        member_ids: drawn ? [e.key] : [],
        extent: { members: drawn ? 1 : 0, distance: 0 },
        before: Object.fromEntries(cs.map((c) => [field(c), value(c, 'before')])),
        after: Object.fromEntries(cs.map((c) => [field(c), value(c, 'after')])),
        ...changeUnits(cs.filter((c) => !loadField(c.field)), field),
        ...(drawn ? {} : { subject: subjectOf(e) }),
      });
    }
  }

  // ---- definition (table) changes, with every member that uses the definition ----
  const users = (table: string, name: string) =>
    frames.filter((e) => e.via?.includes(viaRef(table, name))).map((e) => e.key);
  for (const [table, t] of Object.entries(d.tables) as [string, TableDiff][]) {
    const prefix = TABLES[table] ?? table;
    const category = tableCategory(table);
    for (const name of t.added) draft.push({ ...defChange('added', [], null, null), category, subject: `${prefix} ${name}` });
    for (const name of t.removed) draft.push({ ...defChange('removed', [], null, null), category, subject: `${prefix} ${name}` });
    for (const [name, cs] of Object.entries(t.modified)) {
      const ids = table === 'stories' ? [] : users(table, name); // story moves are not member changes
      draft.push({
        ...defChange(cs.every((c) => c.kind === 'renamed') ? 'label_only' : 'modified', ids,
          Object.fromEntries(cs.map((c) => [defField(c.field), changeValue(c, 'before')])),
          Object.fromEntries(cs.map((c) => [defField(c.field), changeValue(c, 'after')]))),
        ...changeUnits(cs, (c) => defField(c.field)),
        category,
        subject: `${prefix} ${name}`,
        ...(table === 'stories' && !cs.some((c) => c.unit)
          ? { units: Object.fromEntries(cs.filter((c) => ['height', 'elevation'].includes(c.field)).map((c) => [c.field, 'length'])) } : {}),
      });
    }
  }

  // ---- assemble ----
  const changes: Change[] = draft.map((c, n) => ({ id: `C${String(n + 1).padStart(2, '0')}`, ...c }));

  // Nodes: every frame end, plus joints the engine lists (restraints, springs, loads).
  const nodes = new Map<string, Node>();
  const addNode = (p: Vec3, side: Side) => {
    const prev = nodes.get(key(p));
    nodes.set(key(p), { id: key(p), xyz: p, side: prev && prev.side !== side ? 'both' : side });
  };
  frames.forEach((e) => e.geometry.forEach((p) => addNode(p, sideOf(e.status))));
  d.elements.filter((e) => e.kind === 'point').forEach((e) => addNode(e.geometry[0], sideOf(e.status)));

  return {
    mock: opts.mock,
    meta: {
      source: { baseline: d.meta.a.file, revised: d.meta.b.file },
      units: { length: d.meta.lengthUnit, force: d.meta.forceUnit ?? 'kip' },
    },
    stories: d.stories.map((s) => ({
      name: s.name, elevation: (s.elevB ?? s.elevA)!,
      side: s.elevA !== null && s.elevB !== null ? 'both' : s.elevB !== null ? 'revised' : 'baseline',
    })),
    nodes: [...nodes.values()],
    members,
    changes,
    // Applied loads as the engine writes them (0.2), for drawing a pattern, case or combo.
    loads: {
      elements: d.elements.filter((e) => e.loads).map((e) => ({
        key: e.key, kind: e.kind, subtype: e.subtype, label: e.label, story: e.story, geometry: e.geometry, loads: e.loads!,
      })),
      definitions: d.loadDefinitions ?? null,
    },
  };
}

/** A definition's field carried onto an element, e.g. "material:4Ksi.name"; not a load like "load:LIVE.FZ". */
const DEFINITION_REFS = new Set(Object.keys(TABLES).map((t) => viaRef(t, '').slice(0, -1)));
const isDefinitionField = (f: string) => f.includes(':') && DEFINITION_REFS.has(f.split(':')[0]);

/** "material:A992Fy50.Fy" -> "Fy"; the subject already names the definition. */
const defField = (f: string) => f.replace(/^[A-Za-z]+:[^.]*\./, '');

function defChange(type: Change['type'], ids: string[], before: Change['before'], after: Change['after']): Omit<Change, 'id' | 'category'> {
  return { type, member_ids: ids, extent: { members: ids.length, distance: 0 }, before, after };
}
