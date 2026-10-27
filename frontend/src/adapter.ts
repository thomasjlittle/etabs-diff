// Adapter: team contract ({modelA, modelB, diff} per backend schema.py / types.ts) -> Vantage Result.
// Same shape as POST /api/diff returns, so this works for the fixtures now and the API later.
//
// Field -> group mapping follows the team planning board. Judgment calls (see README / PR):
//   props.lineMass and other mass fields -> T3 (mass is "tables only, 3rd pass" on the board)
//   story elevation change -> G1, one change with no members (members are compared relative to story)
// Not available from schema.py: source line evidence, ambiguous matches. Those stay empty.
import type { Diff, Frame, Model, SetDiff } from './types';
import type { Change, Coverage, Group, Member, Node, Result, Side, Value, Vec3 } from './vantageTypes';

export interface TeamResult { modelA: Model; modelB: Model; diff: Diff }

// Planning-board groups, in board order (same list as src/mock/make_mock.py).
export const GROUPS: [string, string, string][] = [
  ['G1', 'Geometry / level changes', 'MVP'],
  ['1A', 'Section reassigned', 'MVP'],
  ['1B', 'Section definition edited', 'MVP'],
  ['1C', 'Material edited', 'MVP'],
  ['1D', 'Property modifiers', '2nd pass'],
  ['1E', 'End releases / end offsets / insertion point / local axis', '2nd pass'],
  ['2A', 'Supports and springs', '2nd pass'],
  ['2B', 'Applied loads', '2nd pass'],
  ['T3', 'Tables only: mass, load patterns, load cases, combos', '3rd pass'],
  ['ST', 'Stretch: walls/slabs, diaphragm assigns, spectrum/time history', 'Stretch'],
  ['LO', 'Label-only / not physical', 'Info'],
];

// diff.tables key -> [group, record name shown in coverage, subject prefix]
const TABLES: Record<string, [string, string, string]> = {
  stories: ['G1', 'Stories', 'Story'],
  nodes: ['2A', 'Point restraints and springs', 'Node'],
  areas: ['ST', 'Shell objects (walls, slabs)', 'Area'],
  loads: ['2B', 'Applied loads', 'Load'],
  materials: ['1C', 'Materials', 'Material'],
  frameSections: ['1B', 'Frame section definitions', 'Section'],
  shellSections: ['ST', 'Shell section definitions', 'Shell section'],
  loadPatterns: ['T3', 'Load patterns', 'Load pattern'],
  loadCases: ['T3', 'Load cases', 'Load case'],
  combos: ['T3', 'Load combinations', 'Combo'],
  massSource: ['T3', 'Mass source', 'Mass source'],
};

/** Group for one changed frame field. */
export function frameFieldGroup(field: string): string {
  if (field === 'label') return 'LO';
  if (field === 'nodes' || field === 'i' || field === 'j') return 'G1';
  if (field === 'section') return '1A';
  if (/mass/i.test(field)) return 'T3';
  if (/release|offset|cardinal|insertion|angle|axis/i.test(field)) return '1E';
  return '1D'; // modifiers and any other frame property
}

/** schema.py values are loosely typed; Vantage shows numbers, strings and number lists. */
function toValue(v: unknown): Value {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (Array.isArray(v)) return v.every((x) => typeof x === 'number') ? (v as number[]) : v.join(', ');
  return JSON.stringify(v);
}

const fieldName = (f: string) => f.replace(/^props\./, '');
const dist = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const same = (p: Vec3, q: Vec3) => dist(p, q) === 0;

export function adapt({ modelA, modelB, diff }: TeamResult): Result {
  const framesA = new Map(modelA.frames.map((f) => [f.id, f]));
  const framesB = new Map(modelB.frames.map((f) => [f.id, f]));
  const members: Member[] = [];
  const draft: Omit<Change, 'id'>[] = [];

  const addMember = (f: Frame, side: Side, id = f.id) => {
    members.push({ id, kind: f.kind, end_nodes: [key(f.i), key(f.j)], label: f.label, story: f.story, side });
    return id;
  };

  // ---- frames: draw B's frames, plus A-only ones; moved frames get one member per side ----
  const added = new Set(diff.frames.added);
  const moved = new Map<string, Frame>(); // B id -> A frame, for frames whose ends changed position
  for (const [id, changes] of Object.entries(diff.frames.modified)) {
    const fb = framesB.get(id);
    const fa = framesA.get(id);
    if (fb && fa && changes.some((c) => c.field === 'nodes') && !(same(fa.i, fb.i) && same(fa.j, fb.j))) moved.set(id, fa);
  }
  // Vantage member id for a B frame: a moved frame is drawn as two members, use the revised one.
  const mid = (id: string) => (moved.has(id) ? `${id}~B` : id);
  for (const f of modelB.frames) {
    if (added.has(f.id)) addMember(f, 'revised');
    else if (moved.has(f.id)) {
      addMember(moved.get(f.id)!, 'baseline', `${f.id}~A`);
      addMember(f, 'revised', `${f.id}~B`);
    } else addMember(f, 'both');
  }
  for (const id of diff.frames.removed) {
    const f = framesA.get(id);
    if (f) addMember(f, 'baseline', `${id}~A`);
  }

  // ---- frame changes ----
  for (const id of diff.frames.added)
    draft.push(change('added', 'G1', [id], 1, 0, null, null));
  for (const id of diff.frames.removed)
    draft.push(change('removed', 'G1', [`${id}~A`], 1, 0, framesA.get(id) ? { section: framesA.get(id)!.section } : null, null));

  for (const id of Object.keys(diff.frames.modified).sort()) {
    const fb = framesB.get(id)!;
    const byGroup = new Map<string, typeof diff.frames.modified[string]>();
    for (const c of diff.frames.modified[id]) byGroup.set(frameFieldGroup(c.field), [...(byGroup.get(frameFieldGroup(c.field)) ?? []), c]);

    for (const [group, cs] of byGroup) {
      if (group === 'G1') {
        const fa = moved.get(id);
        if (fa) {
          // A move: report each end that changed position.
          const ends = (['i', 'j'] as const).filter((e) => !same(fa[e], fb[e]));
          const before = Object.fromEntries(ends.map((e) => [`end_${e}`, fa[e]]));
          const after = Object.fromEntries(ends.map((e) => [`end_${e}`, fb[e]]));
          const d = Math.max(...ends.map((e) => dist(fa[e], fb[e])));
          draft.push({ ...change('modified', 'G1', [`${id}~A`, `${id}~B`], 1, d, before, after),
            units: Object.fromEntries(ends.map((e) => [`end_${e}`, 'length'])) });
        } else {
          // Node list changed but positions did not: reversed end order, not physical.
          draft.push(change('label_only', 'LO', [mid(id)], 0, 0,
            { end_order: toValue(cs[0].before) }, { end_order: toValue(cs[0].after) }));
        }
        continue;
      }
      const before = Object.fromEntries(cs.map((c) => [fieldName(c.field), toValue(c.before)]));
      const after = Object.fromEntries(cs.map((c) => [fieldName(c.field), toValue(c.after)]));
      draft.push(change(group === 'LO' ? 'label_only' : 'modified', group, [mid(id)], group === 'LO' ? 0 : 1, 0, before, after));
    }
  }

  // ---- table changes ----
  const sectionUsers = (name: string) => modelB.frames.filter((f) => f.section === name).map((f) => mid(f.id));
  const materialUsers = (name: string) => modelB.frames
    .filter((f) => modelB.frameSections[f.section]?.material === name).map((f) => mid(f.id));

  for (const [table, set] of Object.entries(diff.tables) as [string, SetDiff][]) {
    const [group, , prefix] = TABLES[table] ?? ['T3', table, table];
    const users = (name: string) => table === 'frameSections' ? sectionUsers(name) : table === 'materials' ? materialUsers(name) : [];
    for (const name of set.added) {
      if (table === 'stories') {
        const ids = modelB.frames.filter((f) => f.story === name && added.has(f.id)).map((f) => f.id);
        const elev = modelB.stories.find((s) => s.name === name)?.elev ?? null;
        draft.push({ ...change('added', 'G1', ids, ids.length, 0, null, { story: name, elevation: elev }), units: { elevation: 'length' } });
      } else draft.push({ ...change('added', group, users(name), users(name).length, 0, null, null), subject: `${prefix} ${name}` });
    }
    for (const name of set.removed)
      draft.push({ ...change('removed', group, [], 0, 0, null, null), subject: `${prefix} ${name}` });
    for (const [name, cs] of Object.entries(set.modified)) {
      const before = Object.fromEntries(cs.map((c) => [fieldName(c.field), toValue(c.before)]));
      const after = Object.fromEntries(cs.map((c) => [fieldName(c.field), toValue(c.after)]));
      const u = users(name);
      draft.push({
        ...change('modified', group, u, u.length, 0, before, after),
        subject: `${prefix} ${name}`,
        ...(table === 'stories' ? { units: { elev: 'length' } } : {}),
      });
    }
  }

  // ---- assemble ----
  const changes: Change[] = draft.map((c, n) => ({ id: `C${String(n + 1).padStart(2, '0')}`, ...c }));
  const groups: Group[] = GROUPS.map(([id, title, tier]) => ({
    id, title, tier, change_ids: changes.filter((c) => c.group === id).map((c) => c.id),
  }));
  const coverage: Coverage[] = [
    { group: 'G1', record: 'Frame members', status: 'compared' },
    ...Object.keys(diff.tables).map((t) => ({ group: (TABLES[t] ?? ['T3'])[0], record: (TABLES[t] ?? ['', t])[1], status: 'compared' as const })),
    ...[...new Set([...modelA.unparsed, ...modelB.unparsed])].map((u) => ({ group: 'ST', record: u.replace(/^\$\s*/, ''), status: 'seen_not_compared' as const })),
  ];

  const storyNames = new Set([...modelA.stories, ...modelB.stories].map((s) => s.name));
  const stories = [...storyNames].map((name) => {
    const a = modelA.stories.find((s) => s.name === name);
    const b = modelB.stories.find((s) => s.name === name);
    return { name, elevation: (b ?? a)!.elev, side: (a && b ? 'both' : b ? 'revised' : 'baseline') as Side };
  });

  return {
    mock: true, // fixtures are synthetic; the MOCK DATA badge stays on
    meta: {
      schema_version: 'vantage-0.1 (adapted from schema.py)',
      source: { baseline: modelA.meta.file, revised: modelB.meta.file },
      units: { length: 'in', force: 'kip' }, // parsers normalize to kip and inch (CLAUDE.md)
      coordinate_system: { axes: 'X, Y plan; Z up', aligned: true, offset: [0, 0, 0] },
      match_tolerance: 0.5, // CLAUDE.md: geometry match within 0.5 in
      mock: true,
    },
    stories,
    nodes: nodesFor(members, [...framesA.values(), ...framesB.values()]),
    members,
    changes,
    groups,
    warnings: { coverage, ambiguous: [], error: null },
  };
}

// Node ids are coordinate keys, so a node shared by both models is one node.
const key = (p: Vec3) => `N(${p.join(',')})`;

/** One node per distinct member end; side is "both" when used by members on both sides. */
function nodesFor(members: Member[], frames: Frame[]): Node[] {
  const xyz = new Map<string, Vec3>();
  frames.forEach((f) => { xyz.set(key(f.i), f.i); xyz.set(key(f.j), f.j); });
  const sides = new Map<string, Set<Side>>();
  members.forEach((m) => m.end_nodes.forEach((n) => sides.set(n, (sides.get(n) ?? new Set()).add(m.side))));
  return [...sides].map(([id, s]) => ({
    id, xyz: xyz.get(id)!, side: s.has('both') || (s.has('baseline') && s.has('revised')) ? 'both' : [...s][0],
  }));
}

function change(
  type: Change['type'], group: string, member_ids: string[], members: number, distance: number,
  before: Change['before'], after: Change['after'],
): Omit<Change, 'id'> {
  return { type, group, member_ids, extent: { members, distance }, before, after, evidence: [] };
}
