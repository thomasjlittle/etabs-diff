// Engine-output adapter checks. Expected values are read off frontend/demo_viewer/example-diff.json by hand
// (synthetic 3-story example) and checked for consistency on fixtures/demo/diff.json (seeded demo).
import { describe, expect, it } from 'vitest';
import example from '../demo_viewer/example-diff.json';
import demo from '../../fixtures/demo/diff.json';
import { adaptEngine, type EngineDiff } from './engineAdapter';
import { describeChange, headlineCounts, memberStyles, moves } from './data';

const ex = adaptEngine(example as unknown as EngineDiff, { mock: true });
const dm = adaptEngine(demo as unknown as EngineDiff, { mock: true });
const bySubject = (r: typeof ex, s: string) => r.changes.find((c) => c.subject === s)!;

describe('engine adapter: example-diff.json', () => {
  it('headline counts', () => {
    // added: brace D1, beam B99, floor F4, section W16X26 · removed: beam B9
    // modified: joint A1 restraint, beam B1 section, joint B2 load, material A992Fy50
    expect(headlineCounts(ex)).toEqual({ added: 4, removed: 1, modified: 4, label_only: 0 });
  });

  it('files each change under its category', () => {
    expect(bySubject(ex, 'Joint A1 at Base').category).toBe('restraints');
    expect(bySubject(ex, 'Joint B2 at Story3').category).toBe('appliedLoads');
    expect(bySubject(ex, 'Floor F4 at Story3').category).toBe('objects');
    expect(bySubject(ex, 'Section W16X26').category).toBe('frameSections');
    expect(ex.changes.find((c) => c.category === 'sectionAssign')!.after).toEqual({ section: 'W16X26' });
  });

  it('material edit is one change listing the 9 affected columns, not 9 changes', () => {
    const c = bySubject(ex, 'Material A992Fy50');
    expect(c.category).toBe('materials');
    expect(c.member_ids).toHaveLength(9);
    expect(describeChange(c, ex)).toBe('Material A992Fy50: Fy changed from 50.0 to 55.0. 9 members use it.');
    expect(ex.changes.filter((x) => x.category === 'materials')).toHaveLength(1);
  });

  it('section reassignment reads as a sentence', () => {
    const c = ex.changes.find((x) => x.category === 'sectionAssign')!;
    expect(describeChange(c, ex)).toBe('Beam B1 at Story2 was reassigned from section W14X22 to W16X26.');
  });

  it('added and removed frames are drawn on their own side', () => {
    const s = memberStyles(ex, 'change');
    const removed = ex.changes.find((c) => c.type === 'removed')!;
    expect(s.get(removed.member_ids[0])).toBe('removed');
    expect(ex.members.find((m) => m.id === removed.member_ids[0])!.side).toBe('baseline');
  });
});

describe('engine adapter: seeded demo (8 stories)', () => {
  it('draws every frame and every change points at drawn members', () => {
    const frames = (demo as unknown as EngineDiff).elements.filter((e) => e.kind === 'frame');
    expect(dm.members).toHaveLength(frames.length);
    const ids = new Set(dm.members.map((m) => m.id));
    for (const c of dm.changes) for (const m of c.member_ids) expect(ids.has(m), `${c.id} -> ${m}`).toBe(true);
  });

  it('the linked move is one change, measured relative to its story', () => {
    // B36 @ L4: both ends shift +24 in X; L4 also rose 12 in (492 -> 504), reported separately.
    const c = dm.changes.find((x) => x.type === 'modified' && x.category === 'objects' && x.member_ids.length === 2)!;
    expect(c.extent.distance).toBe(24);
    expect(c.after!.story_shift).toBe(12);
    expect(describeChange(c, dm)).toBe(
      'Beam B36 at L4 had both endpoints moved, a shift of 24.0 in relative to its story. The story itself also moved 12.0 in, reported separately.',
    );
    expect(moves(dm)).toHaveLength(2); // one arrow per moved end
    // engine summary: 3 added, 3 removed; B36 -> B44 is the move pair. Left: added brace D9 and
    // wall W1, removed beam B24 (drawn) and floor F8 (listed only).
    expect(headlineCounts(dm).added).toBe(2);
    expect(dm.changes.filter((c) => c.type === 'removed' && c.member_ids.length === 1)).toHaveLength(1);
  });

  it('reports each seeded label change separately from physical changes', () => {
    expect(headlineCounts(dm).label_only).toBe(104);
    const rename = dm.changes.find((c) => c.type === 'label_only' && c.before?.label === 'B38')!;
    expect(rename.after).toEqual({ label: 'B45' });
    expect(rename.category).toBe('labelOnly');
    expect(describeChange(rename, dm)).toContain('was renamed from B38 to B45');
  });
});

it('element changes do not say "uses it"; definitions do, with correct grammar', () => {
  const b1 = { ...ex.changes.find((c) => c.category === 'sectionAssign')!, before: { ANG: 0 }, after: { ANG: 90 } };
  expect(describeChange(b1, ex)).toBe('Beam B1 at Story2: ANG changed from 0.0 to 90.0.');
  const one = { ...bySubject(ex, 'Material A992Fy50'), member_ids: ['x'], extent: { members: 1, distance: 0 } };
  expect(describeChange(one, ex)).toContain('1 member uses it.');
});

it('structured values (load records) display as text, never [object Object]', () => {
  const d = structuredClone(example) as unknown as EngineDiff;
  const el = d.elements.find((e) => e.label === 'B1' && e.story === 'Story2')!;
  el.changes = [{ field: 'loads:SDL', before: [{ TYPE: 'UNIFLOAD', FGRAV: 0.1 }], after: [{ TYPE: 'UNIFLOAD', FGRAV: 0.2 }], affects: ['load'] }];
  const r = adaptEngine(d, { mock: true });
  const text = describeChange(r.changes.find((c) => c.category === 'appliedLoads' && c.member_ids.length === 1)!, r);
  expect(text).not.toContain('[object Object]');
  expect(text).toContain('"FGRAV":0.2');
});

it('a section change on an area reads as a field change on that area, not a member reassignment', () => {
  const d = structuredClone(example) as unknown as EngineDiff;
  const floor = d.elements.find((e) => e.kind === 'area')!;
  floor.status = 'modified';
  floor.changes = [{ field: 'SECTION', before: 'Slab6', after: 'Slab8', affects: ['stiffness'], unit: null }];
  const r = adaptEngine(d, { mock: true });
  const c = r.changes.find((x) => x.subject?.startsWith(`Floor ${floor.label} `))!;
  expect(describeChange(c, r)).toBe(`Floor ${floor.label} at ${floor.story}: SECTION changed from Slab6 to Slab8.`);
});

it('describes definition renames as names, not reversed member ends', () => {
  const d = structuredClone(example) as unknown as EngineDiff;
  d.tables.materials.modified = { Renamed: [{ field: 'name', before: 'A992Fy50', after: 'Renamed', affects: [], kind: 'renamed' }] };
  const result = adaptEngine(d, { mock: true });
  const renamed = result.changes.find((c) => c.subject === 'Material Renamed')!;
  expect(describeChange(renamed, result)).toBe('Material Renamed was renamed from A992Fy50 to Renamed. Label only, not a physical change.');
});

it('carries scalar units and renders mixed load units beside the correct values', () => {
  const d = structuredClone(example) as unknown as EngineDiff;
  const element = d.elements.find((e) => e.label === 'B1' && e.story === 'Story2')!;
  element.changes = [
    { field: 'ANG', before: 0, after: 90, affects: ['stiffness'], unit: 'deg' },
    { field: 'loads:SDL', before: [{ FVAL: 10, DIST: 20 }], after: [{ FVAL: 12, DIST: 30 }], affects: ['load'], unit: null,
      valueUnits: { before: { '0.FVAL': 'kip', '0.DIST': 'in' }, after: { '0.FVAL': 'kip', '0.DIST': 'in' } } },
  ];
  const result = adaptEngine(d, { mock: true });
  expect(describeChange(result.changes.find((c) => c.category === 'releases')!, result)).toContain('90.0 deg');
  const load = describeChange(result.changes.find((c) => c.category === 'appliedLoads' && c.member_ids.length)!, result);
  expect(load).toContain('12 kip');
  expect(load).toContain('30 in');
});
