// Adapter checks against the team reference case (fixtures/model-a.json, model-b.json, diff.json).
// Expected values are read off fixtures/diff.json by hand; see the table in the PR description.
import { describe, expect, it } from 'vitest';
import modelA from '../../fixtures/model-a.json';
import modelB from '../../fixtures/model-b.json';
import diffJson from '../../fixtures/diff.json';
import type { Diff, Model } from './types';
import { adapt, frameFieldGroup } from './adapter';
import { describeChange, headlineCounts, isPhysical, memberStyles, moves } from './data';

const r = adapt({ modelA: modelA as unknown as Model, modelB: modelB as unknown as Model, diff: diffJson as unknown as Diff });
const bySubject = (s: string) => r.changes.find((c) => c.subject === s)!;
const byMember = (id: string) => r.changes.filter((c) => c.member_ids.includes(id));
const groupOf = (id: string) => r.changes.filter((c) => c.group === id);

describe('adapter: team fixture -> Vantage', () => {
  it('headline counts: 3 added, 1 removed, 14 modified, 1 label-only', () => {
    // added: frame D3@L3, load 5@L3|Live|Force|Gravity, combo 0.9D+E
    // modified: 6 frame changes less the rename (5) + 9 table changes
    expect(headlineCounts(r)).toEqual({ added: 3, removed: 1, modified: 14, label_only: 1 });
  });

  it('every change lands in the planning-board group for its field', () => {
    expect(groupOf('G1').length).toBe(4);          // D3 added, B7 removed, D2 moved, L3 elevation
    expect(byMember('C2@L1')[0].group).toBe('1A'); // section W14X90 -> W14X120
    expect(bySubject('Section BR1').group).toBe('1B');
    expect(bySubject('Material 4000Psi').group).toBe('1C');
    expect(byMember('B1@L1')[0].group).toBe('1D'); // modI33
    expect(byMember('B5@L2')[0].group).toBe('1E'); // releaseI and releaseJ, one change
    expect(bySubject('Node 3@Base').group).toBe('2A');
    expect(groupOf('2B').length).toBe(2);          // one load added, one modified
    expect(byMember('B4@L3')[0].group).toBe('T3'); // lineMass: mass is tables-only on the board
  });

  it('rename B4 -> B9 at L1 is label-only, drawn as unchanged geometry', () => {
    const c = byMember('B9@L1')[0];
    expect(c.type).toBe('label_only');
    expect(isPhysical(c)).toBe(false);
    expect(describeChange(c, r)).toBe('Beam at L1 was renamed from B4 to B9. Label only, not a physical change.');
    expect(r.members.find((m) => m.id === 'B9@L1')!.side).toBe('both');
    expect(memberStyles(r, 'change').get('B9@L1')).toBeUndefined();
    expect(r.members.some((m) => m.id.startsWith('B4@L1'))).toBe(false); // old label is not drawn as removed
  });

  it('brace D2 at L2: j end moved 360 in, drawn as old (baseline) and new (revised)', () => {
    const c = byMember('D2@L2~A')[0];
    expect(c.before).toEqual({ end_j: [360, 0, 288] });
    expect(c.after).toEqual({ end_j: [720, 0, 288] });
    expect(c.extent.distance).toBe(360);
    expect(moves(r)).toEqual([{ change: c.id, from: [360, 0, 288], to: [720, 0, 288] }]);
    expect(describeChange(c, r)).toContain('a shift of 360.0 in');
  });

  it('added and removed frames take their own side', () => {
    expect(r.members.find((m) => m.id === 'D3@L3')!.side).toBe('revised');
    expect(r.members.find((m) => m.id === 'B7@L1~A')!.side).toBe('baseline');
  });

  it('story elevation change is one G1 change with no members flagged', () => {
    const c = bySubject('Story L3');
    expect(c.member_ids).toEqual([]);
    expect(describeChange(c, r)).toBe('Story L3: elev changed from 432.0 in to 444.0 in.');
  });

  it('section definition change lists the members using that section', () => {
    const c = bySubject('Section BR1');
    expect(c.member_ids.sort()).toEqual(['D1@L1', 'D2@L2~B', 'D3@L3']) // moved D2 -> its revised member;
    expect(describeChange(c, r)).toBe('Section BR1: t changed from 0.349 to 0.465. 3 members use it.');
  });

  it('every member id a change points at is a drawn member', () => {
    const ids = new Set(r.members.map((m) => m.id));
    for (const c of r.changes) for (const m of c.member_ids) expect(ids.has(m), `${c.id} -> ${m}`).toBe(true);
  });

  it('draws every fixture frame at exactly its fixture coordinates (B side, A for removed / old position)', () => {
    const xyz = new Map(r.nodes.map((n) => [n.id, n.xyz]));
    const drawn = (id: string) => r.members.find((m) => m.id === id)!.end_nodes.map((n) => xyz.get(n));
    const ends = (f: { i: number[]; j: number[] }) => [f.i, f.j].sort((p, q) => String(p).localeCompare(String(q)));
    const sorted = (e: unknown[]) => [...e].sort((p, q) => String(p).localeCompare(String(q)));
    for (const f of (modelB as unknown as Model).frames) {
      const id = r.members.some((m) => m.id === f.id) ? f.id : `${f.id}~B`;
      expect(sorted(drawn(id)), f.id).toEqual(ends(f));
    }
    for (const id of ['B7@L1', 'D2@L2']) {
      const f = (modelA as unknown as Model).frames.find((x) => x.id === id)!;
      expect(sorted(drawn(`${id}~A`)), id).toEqual(ends(f));
    }
    // 41 B frames, +1 for D2's old position, +1 for removed B7
    expect(r.members.length).toBe(43);
  });

  it('small values keep their precision', () => {
    expect(describeChange(bySubject('Load F1@L2|SDL|Uniform|Gravity'), r)).toContain('(0.000139) to (0.000208)');
  });

  it('unparsed sections show as seen, not compared', () => {
    expect(r.warnings.coverage.filter((c) => c.status === 'seen_not_compared').map((c) => c.record).sort())
      .toEqual(['DESIGN PREFERENCES', 'FUNCTIONS']);
  });

  it('field mapping', () => {
    expect(['label', 'nodes', 'section', 'props.lineMass', 'props.releaseI', 'props.modI33'].map(frameFieldGroup))
      .toEqual(['LO', 'G1', '1A', 'T3', '1E', '1D']);
  });
});
