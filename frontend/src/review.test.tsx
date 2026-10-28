// Issue #19, ported from PR #45 onto the engine-backed app: every change seeded into fixtures/demo
// (seeded-changes.json) shows once in the review UI, under the category a reviewer expects, with a
// hand-written sentence. backend/diff_engine/tests/test_demo_pair.py checks the same list against the engine.
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import seeded from '../../fixtures/demo/seeded-changes.json';
import demo from '../../fixtures/demo/diff.json';
import { adaptEngine, type EngineDiff } from './engineAdapter';
import { describeChange, headlineCounts, isPhysical } from './data';
import { categoryOf } from './categories';
import { Workspace } from './App';

afterEach(cleanup);

const result = adaptEngine(demo as unknown as EngineDiff, { mock: true });

// ---------- expectations, written by hand ----------

/** Seeded change ("what") -> the [category, sentence] of each change the app lists for it. */
const EXPECTED: Record<string, [string, string][]> = {
  'Interior beam B24 removed at L5': [['objects', 'Beam B24 at L5 was removed.']],
  'Brace D9 added at L2 in a new bay on grid Y=0': [['objects', 'Brace D9 at L2 was added.']],
  'Infill beam B36 at L4 moved 24 in along X (redrawn as B44)': [['objects',
    'Beam B36 at L4 had both endpoints moved, a shift of 24.0 in relative to its story. The story itself also moved 12.0 in, reported separately.']],
  'L4 story height 156 in to 168 in. Shows once per story in the stories table, no element changes': [
    ['stories', 'Story L4: elevation changed from 492.0 in to 504.0 in; height changed from 156.0 in to 168.0 in.'],
    ['stories', 'Story L5: elevation changed from 648.0 in to 660.0 in.'],
    ['stories', 'Story L6: elevation changed from 804.0 in to 816.0 in.'],
    ['stories', 'Story L7: elevation changed from 960.0 in to 972.0 in.'],
    ['stories', 'Story Roof: elevation changed from 1116.0 in to 1128.0 in.'],
  ],
  'Column C7 at L3 reassigned W14X120 to W14X132': [['sectionAssign', 'Column C7 at L3 was reassigned from section W14X120 to W14X132.']],
  'User section BOX16 walls 0.75 in to 1 in (corner columns L2, L3)': [['frameSections',
    'Section BOX16: TF changed from 0.75 in to 1.0 in; TW changed from 0.75 in to 1.0 in. 8 members use it.']],
  'User section GIRDER-USER material A992Fy50 to A572Gr50 (L2 girders on grid Y=0)': [['frameSections',
    'Section GIRDER-USER: MATERIAL changed from A992Fy50 to A572Gr50. 4 members use it.']],
  "Material LW3000 f'c 3 to 4 ksi and unit weight 110 to 115 pcf (roof slab)": [['materials',
    'Material LW3000: FC changed from 3.0 ksi to 4.0 ksi; WEIGHTPERVOLUME changed from 0.00006365740741 kip/in^3 to 0.00006655092593 kip/in^3.']],
  'Section W12X26 I3 modifier 1 to 1.4 (roof infill beams)': [['frameSections', 'Section W12X26: I3MOD changed from 1.0 to 1.4. 12 members use it.']],
  'Column C8 at L2 gets member modifiers I22 and I33 of 0.7 (cracked section)': [['modifiers',
    'Column C8 at L2: PROPMODI22 changed from — to 0.7; PROPMODI33 changed from — to 0.7.']],
  'Beam B27 at L6 end releases removed (now a moment connection)': [['releases', 'Beam B27 at L6: RELEASE changed from M2I M3I M2J M3J to —.']],
  'Girder B6 at L3 insertion point 8 (top center) to 2 (bottom center)': [['releases', 'Beam B6 at L3: CARDINALPT changed from 8.0 to 2.0.']],
  'Column C13 at L6 rotated 90 degrees (local axis, 0 to 90)': [['releases', 'Column C13 at L6: ANG changed from 0.0 deg to 90.0 deg.']],
  'Bare joint 25 at L3 (infill beam end) assigned to diaphragm D1': [['diaphragms', 'Joint 25 at L3: DIAPH changed from — to D1.']],
  'Base support at point 20 pinned to fixed': [['restraints', 'Joint 20 at Base: RESTRAINT changed from UX UY UZ to UX UY UZ RX RY RZ.']],
  'Point spring Pad vertical stiffness 500 to 650 kip/in (bearing pad under point 3)': [['linkProps',
    'Point spring Pad: UZ changed from 500.0 kip/in to 650.0 kip/in.']],
  'Roof unit load at point 8 12 to 18 kip': [['appliedLoads',
    'Joint 8 at Roof: SDL loads changed from Joint load FZ -12 kip to Joint load FZ -18 kip.']],
  'Cladding line load on B2 at L5 400 to 600 plf': [['appliedLoads',
    'Beam B2 at L5: SDL loads changed from Uniform 0.4 kip/ft gravity to Uniform 0.6 kip/ft gravity.']],
  'Floor F6 at L3 live load 50 to 125 psf (storage)': [['appliedLoads',
    'Floor F6 at L3: Live loads changed from Uniform 50 psf gravity to Uniform 125 psf gravity.']],
  'Mass source MsSrc1 adds 25% of Live': [['massSource', 'Mass source MsSrc1: LOADPAT:Live changed from — to 0.25.']],
  'Seismic pattern EQX response modification R 6 to 8': [['loadPatterns', 'Load pattern EQX: SEISMIC:R changed from 6.0 to 8.0.']],
  'Wind pattern WX basic wind speed 115 to 120': [['loadPatterns', 'Load pattern WX: WIND:VB changed from 115.0 to 120.0.']],
  'Load case Live no longer double counts roof live Lr (it has its own case)': [['loadCases', 'Load case Live: LOADPAT:Lr changed from 1.0 to —.']],
  'Response spectrum case RSX scale factor up 10% (base shear scaling)': [['loadCases',
    'Load case RSX: ACCEL:U1 changed from {"FUNC":"DemoRS","SF":"386.09 in/s^2"} to {"FUNC":"DemoRS","SF":"424.699 in/s^2"}.']],
  'Combo 1.2D+1.6L+0.5Lr gets its missing 0.5 Lr term': [['combos', 'Combo 1.2D+1.6L+0.5Lr: LOADCASE:Lr changed from — to 0.5.']],
  'Concrete wall W1 added at L2 on grid X=1440 between Y=0 and Y=300': [['objects', 'Wall W1 at L2 was added.']],
  'Floor slab F8 removed at L7 (new stair opening)': [['objects', 'Floor F8 at L7 was removed.']],
  'Floor F3 at L2 moved from rigid diaphragm D1 to semi-rigid D2': [['diaphragms', 'Floor F3 at L2: DIAPH changed from D1 to D2.']],
  'Response spectrum function DemoRS long-period ordinates up (site class revision)': [['functions',
    'Function DemoRS: TIMEVAL changed from (0.0, 0.4, 0.2, 1.0, 0.6, 1.0, 1.0, 0.6, 2.0, 0.3) to (0.0, 0.4, 0.2, 1.0, 0.6, 1.0, 1.0, 0.65, 2.0, 0.325).']],
};

const expected = Object.values(EXPECTED).flat();
const sorted = <T,>(xs: T[]) => [...xs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const rows = () => screen.queryAllByTestId(/^row-C\d+$/);

function Review() {
  const [selected, setSelected] = useState<string | null>(null);
  return <Workspace result={result} selectedId={selected} onSelect={setSelected} />;
}

describe('review UI on the seeded demo', () => {
  it('has a hand-written expectation for every seeded change, and none left over', () => {
    expect(sorted(Object.keys(EXPECTED))).toEqual(sorted(seeded.changes.map((c) => c.what)));
  });

  it('lists every physical change once, in the expected category, with the expected sentence', () => {
    const got = result.changes.filter(isPhysical).map((c) => [categoryOf(c), describeChange(c, result)]);
    expect(sorted(got)).toEqual(sorted(expected));
  });

  it('lists every seeded rename once, as label-only', () => {
    const got = result.changes.filter((c) => !isPhysical(c)).map((c) => {
      expect(categoryOf(c)).toBe('labelOnly');
      const [, story, before, after] = /at (\S+) was renamed from (\S+) to (\S+)\. Label only/.exec(describeChange(c, result))!;
      return [before, after, story];
    });
    expect(sorted(got)).toEqual(sorted(seeded.renames.map((r) => [r.before, r.after, r.story])));
  });

  it('agrees on the totals: headline counts, the summary panel and the change table', () => {
    render(<Review />);
    const n = expected.length + seeded.renames.length;
    expect(headlineCounts(result)).toEqual({ added: 2, removed: 2, modified: expected.length - 4, label_only: seeded.renames.length });
    expect(screen.getByTestId('pane-summary').textContent).toContain(`2 added · 2 removed · ${expected.length - 4} modified`);
    expect(rows()).toHaveLength(n);
  });

  it('each category lists exactly its expected changes, and selecting one shows its sentence', () => {
    render(<Review />);
    const select = (row: HTMLElement) => {
      fireEvent.click(row);
      return screen.getByTestId('detail').textContent ?? '';
    };
    for (const category of new Set(expected.map(([c]) => c))) {
      fireEvent.click(screen.getByTestId(`category-${category}`));
      const sentences = rows().map(select);
      for (const [c, sentence] of expected.filter(([c]) => c === category))
        expect(sentences.filter((text) => text.includes(sentence)), `${c}: ${sentence}`).toHaveLength(1);
      expect(sentences).toHaveLength(expected.filter(([c]) => c === category).length);
      fireEvent.click(screen.getByTestId(`category-${category}`)); // back to every category
    }
  });
});
