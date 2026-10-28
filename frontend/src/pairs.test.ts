// Model-pair picker: every committed diff in frontend/demo_viewer/diffs/ loads, and known pairs give
// the expected changes. v01a -> v02 was checked line by line against the two .e2k files.
import { describe, expect, it } from 'vitest';
import { loadScenario, MODELS } from './App';
import { describeChange, headlineCounts } from './data';

const pair = (original: string, second: string) => loadScenario('hack-models', { original, second });

describe('model pairs', () => {
  it('the manifest lists the eight committed hackathon models', () => {
    expect(MODELS).toEqual(['Hack_v01', 'Hack_v01a', 'Hack_v02', 'Hack_v02a', 'Hack_v03', 'Hack_v04', 'Hack_v05', 'Hack_v06']);
  });

  it('every ordered pair loads and every change points at drawn members', async () => {
    for (const a of MODELS) for (const b of MODELS) {
      const r = await pair(a, b);
      const ids = new Set(r.members.map((m) => m.id));
      for (const c of r.changes) for (const m of c.member_ids) expect(ids.has(m), `${a}->${b} ${c.id} -> ${m}`).toBe(true);
    }
  });

  it('a model against itself shows no changes', async () => {
    expect(headlineCounts(await pair('Hack_v03', 'Hack_v03'))).toEqual({ added: 0, removed: 0, modified: 0, label_only: 0 });
  });

  it('v02 -> v02a (same model exported in lb/ft instead of kip/in) shows no changes', async () => {
    const r = await pair('Hack_v02', 'Hack_v02a');
    expect(r.changes).toHaveLength(0);
  });

  it('v01 -> v01a: definition renames read as renames, not reversed member ends', async () => {
    const r = await pair('Hack_v01', 'Hack_v01a');
    expect(r.changes.filter((c) => c.type === 'label_only').map((c) => describeChange(c, r))).toEqual([
      'Material 4Ksi was renamed from 4000Psi to 4Ksi. Label only, not a physical change.',
      'Load case LL was renamed from Live to LL. Label only, not a physical change.',
    ]);
  });

  it('v01a -> v02: the three changes verified against the .e2k text', async () => {
    const r = await pair('Hack_v01a', 'Hack_v02');
    expect(r.changes.map((c) => [c.category, describeChange(c, r)])).toEqual([
      ['releases', 'Column C1 at Story1: ANG changed from 0.0 deg to 90.0 deg.'],
      ['sectionAssign', 'Column C3 at Story1 was reassigned from section W10X60 to W16X36.'],
      ['frameSections', 'Section Conc16x10: MATERIAL changed from 4Ksi to 6Ksi. 1 member uses it.'],
    ]);
  });

  it('v01a -> v04: Story2 framing added, B1 extended to B7, plus the three v02 changes', async () => {
    const r = await pair('Hack_v01a', 'Hack_v04');
    // 12 frames + floor F2 added. B1 -> B7 is a linked move, alongside C1, C3, Conc16x10 edits.
    expect(headlineCounts(r)).toEqual({ added: 13, removed: 0, modified: 4, label_only: 0 });
    expect(r.changes.filter((c) => c.category === 'objects' && c.member_ids.length === 2)).toHaveLength(1);
  });

  it('original -> second direction matters: v04 -> v01a removes what v01a -> v04 adds', async () => {
    expect(headlineCounts(await pair('Hack_v04', 'Hack_v01a'))).toMatchObject({ added: 0, removed: 13, modified: 4 });
  });
});
