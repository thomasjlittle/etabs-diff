// Adapter: diff_engine output (frontend/demo_viewer/contract.ts, schemaVersion 0.2) -> keepTABS Result.
// This is what `just demo` feeds Thomas's viewer, so real .e2k pairs can be reviewed in keepTABS.
//
// Element-level changes go to the planning-board group for their field. "affected" elements carry
// their upstream definition's changes; those are reported once, as the table (definition) change,
// with every member whose `via` names it. Not available from engine output: source line
// evidence, ambiguous matches. Areas (floors, walls) are listed as changes but not drawn.
import type { Change, Coverage, Group, Member, Node, Result, Side, Value, Vec3 } from './keeptabsTypes';
import { GROUPS } from './adapter';
import { fieldCategory, tableCategory } from './categories';

// ---- engine contract (subset this adapter reads) ----
interface EChange { field: string; before: unknown; after: unknown; affects: string[]; kind?: 'renamed' }
interface EElement {
  key: string; kind: 'point' | 'frame' | 'area'; subtype: string; label: string; story: string;
  status: 'unchanged' | 'added' | 'removed' | 'modified' | 'affected';
  geometry: Vec3[]; changes: EChange[]; via?: string[]; movedTo?: string; movedFrom?: string;
}
interface ETable { added: string[]; removed: string[]; modified: Record<string, EChange[]> }
export interface EngineDiff {
  schemaVersion: string;
  meta: { a: { file: string }; b: { file: string }; lengthUnit: string; forceUnit?: string; tolerance: number };
  stories: { name: string; elevA: number | null; elevB: number | null }[];
  elements: EElement[];
  tables: Record<string, ETable>;
}

/** Group for an element field (e2k keyword, any case). */
export function engineFieldGroup(field: string): string {
  const f = field.toUpperCase();
  if (f === 'SECTION') return '1A';
  if (/^(ANG|CARDINALPT|RELEASE|OFFSET|LENGTHOFFI|LENGTHOFFJ|INSERTION|LOCALAXIS)/.test(f)) return '1E';
  if (/^DIAPH/.test(f)) return 'ST'; // diaphragm assigns are Stretch on the planning board
  if (/^(RESTRAINT|SPRING)/.test(f)) return '2A';
  if (/^LOAD/.test(f)) return '2B';
  if (/MASS/.test(f)) return 'T3';
  return '1D'; // property modifiers and other frame assigns
}

// engine table -> [group, record name, subject prefix]
const TABLES: Record<string, [string, string, string]> = {
  stories: ['G1', 'Stories', 'Story'],
  materials: ['1C', 'Materials', 'Material'],
  frameSections: ['1B', 'Frame section definitions', 'Section'],
  shellSections: ['ST', 'Shell section definitions', 'Shell section'],
  pointSprings: ['2A', 'Point springs', 'Point spring'],
  lineSprings: ['2A', 'Line springs', 'Line spring'],
  areaSprings: ['2A', 'Area springs', 'Area spring'],
  loadPatterns: ['T3', 'Load patterns', 'Load pattern'],
  loadSets: ['2B', 'Load sets', 'Load set'],
  loadCases: ['T3', 'Load cases', 'Load case'],
  combos: ['T3', 'Load combinations', 'Combo'],
  massSource: ['T3', 'Mass source', 'Mass source'],
  functions: ['ST', 'Functions (spectrum, time history)', 'Function'],
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
      type: 'modified', group: 'G1', category: 'objects', member_ids: [old.key, now.key],
      extent: { members: 1, distance: Math.max(...ends.map(([, p, q]) => dist(p, q))) },
      before: Object.fromEntries(ends.map(([k, , , r]) => [k, r])),
      after: { ...Object.fromEntries(ends.map(([k, , q]) => [k, q])), ...(shift ? { story_shift: shift } : {}) },
      units: { ...Object.fromEntries(ends.map(([k]) => [k, 'length'])), story_shift: 'length' },
      evidence: [],
    });
  }

  // ---- element changes ----
  for (const e of d.elements) {
    if (inMove.has(e.key) || e.status === 'unchanged' || e.status === 'affected') continue;
    const drawn = e.kind === 'frame';
    if (e.status === 'added' || e.status === 'removed') {
      draft.push({
        type: e.status, group: e.kind === 'area' ? 'ST' : 'G1', category: 'objects', member_ids: drawn ? [e.key] : [],
        extent: { members: drawn ? 1 : 0, distance: 0 }, before: null, after: null, evidence: [],
        ...(drawn ? {} : { subject: subjectOf(e) }),
      });
      continue;
    }
    // modified: one change per group and category of fields
    const byGroup = new Map<string, EChange[]>();
    // "material:4Ksi.name" etc. belong to a definition: reported once as its table change, with this member.
    for (const c of e.changes.filter((x) => !isDefinitionField(x.field))) {
      const g = c.kind === 'renamed' && c.field === 'label' ? 'rename' : e.kind === 'area' ? 'ST' : engineFieldGroup(c.field.split(':')[0]);
      const k = `${g}|${fieldCategory(c.field)}`;
      byGroup.set(k, [...(byGroup.get(k) ?? []), c]);
    }
    for (const [k, cs] of byGroup) {
      const [group, category] = k.split('|');
      const field = (c: EChange) => (group === '1A' ? 'section' : c.field);
      draft.push({
        type: group === 'rename' ? 'label_only' : 'modified', group: group === 'rename' ? 'G1' : group, category,
        member_ids: drawn ? [e.key] : [],
        extent: { members: drawn ? 1 : 0, distance: 0 },
        before: Object.fromEntries(cs.map((c) => [field(c), toValue(c.before)])),
        after: Object.fromEntries(cs.map((c) => [field(c), toValue(c.after)])),
        evidence: [],
        ...(drawn ? {} : { subject: subjectOf(e) }),
      });
    }
  }

  // ---- definition (table) changes, with every member that uses the definition ----
  const users = (table: string, name: string) =>
    frames.filter((e) => e.via?.includes(viaRef(table, name))).map((e) => e.key);
  for (const [table, t] of Object.entries(d.tables)) {
    const [group, , prefix] = TABLES[table] ?? ['T3', table, table];
    const category = tableCategory(table);
    for (const name of t.added) draft.push({ ...defChange('added', group, [], null, null), category, subject: `${prefix} ${name}` });
    for (const name of t.removed) draft.push({ ...defChange('removed', group, [], null, null), category, subject: `${prefix} ${name}` });
    for (const [name, cs] of Object.entries(t.modified)) {
      const ids = table === 'stories' ? [] : users(table, name); // story moves are not member changes
      draft.push({
        ...defChange(cs.every((c) => c.kind === 'renamed') ? 'label_only' : 'modified', group, ids,
          Object.fromEntries(cs.map((c) => [defField(c.field), toValue(c.before)])),
          Object.fromEntries(cs.map((c) => [defField(c.field), toValue(c.after)]))),
        category,
        subject: `${prefix} ${name}`,
        ...(table === 'stories' ? { units: Object.fromEntries(cs.map((c) => [c.field, 'length'])) } : {}),
      });
    }
  }

  // ---- assemble ----
  const changes: Change[] = draft.map((c, n) => ({ id: `C${String(n + 1).padStart(2, '0')}`, ...c }));
  const groups: Group[] = GROUPS.map(([id, title]) => ({
    id, title, change_ids: changes.filter((c) => c.group === id).map((c) => c.id),
  }));
  const coverage: Coverage[] = [
    { group: 'G1', record: 'Frame members', status: 'compared' },
    { group: '2A', record: 'Joints (restraints, springs, loads)', status: 'compared' },
    { group: 'ST', record: 'Area objects: listed, not drawn', status: 'compared' },
    ...Object.keys(d.tables).map((t) => ({ group: (TABLES[t] ?? ['T3'])[0], record: (TABLES[t] ?? ['', t])[1], status: 'compared' as const })),
  ];

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
      schema_version: `keeptabs-0.1 (adapted from engine ${d.schemaVersion})`,
      source: { baseline: d.meta.a.file, revised: d.meta.b.file },
      units: { length: d.meta.lengthUnit, force: d.meta.forceUnit ?? 'kip' },
      coordinate_system: { axes: 'X, Y plan; Z up', aligned: true, offset: [0, 0, 0] },
      match_tolerance: d.meta.tolerance,
      mock: opts.mock,
    },
    stories: d.stories.map((s) => ({
      name: s.name, elevation: (s.elevB ?? s.elevA)!,
      side: s.elevA !== null && s.elevB !== null ? 'both' : s.elevB !== null ? 'revised' : 'baseline',
    })),
    nodes: [...nodes.values()],
    members,
    changes,
    groups,
    warnings: { coverage, ambiguous: [], error: null },
  };
}

/** A definition's field carried onto an element, e.g. "material:4Ksi.name"; not a load like "load:LIVE.FZ". */
const DEFINITION_REFS = new Set(Object.keys(TABLES).map((t) => viaRef(t, '').slice(0, -1)));
const isDefinitionField = (f: string) => f.includes(':') && DEFINITION_REFS.has(f.split(':')[0]);

/** "material:A992Fy50.Fy" -> "Fy"; the subject already names the definition. */
const defField = (f: string) => f.replace(/^[A-Za-z]+:[^.]*\./, '');

function defChange(type: Change['type'], group: string, ids: string[], before: Change['before'], after: Change['after']): Omit<Change, 'id'> {
  return { type, group, member_ids: ids, extent: { members: ids.length, distance: 0 }, before, after, evidence: [] };
}
