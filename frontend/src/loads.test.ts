// Applied loads: factoring, change detection, and load -> arrow geometry.
import { describe, expect, it } from 'vitest';
import hack from '../demo_viewer/diffs/Hack_v04__Hack_v05.json';
import { adaptEngine, type EngineDiff } from './engineAdapter';
import {
  type AppliedLoad, type LoadDefinitions, type LoadedElement, areaAxes, describeLoad, direction, factoredLoads, frameAxes,
  glyphSegments, loadChanged, loadGlyphs, loadsFor, maxByClass, pickFactors, pickOptions,
} from './loads';

const defs: LoadDefinitions = {
  patterns: { Dead: { type: 'Dead', selfWeight: 0 }, Live: { type: 'Live', selfWeight: 0 } },
  cases: {
    Modal: { type: 'Modal - Eigen', patterns: {}, effective: { expandable: false, patterns: {}, reason: 'case Modal is Modal - Eigen, not a static case' } },
  },
  combos: {
    '1.2D+1.6L': { type: 'Linear Add', cases: {}, combos: {}, effective: { expandable: true, patterns: { Dead: 1.2, Live: 1.6 }, reason: null } },
  },
};

const beam = (a: Record<string, AppliedLoad[]>, b = a): LoadedElement => ({
  key: 'B1', kind: 'frame', subtype: 'beam', label: 'B1', story: 'Story1', geometry: [[0, 0, 144], [300, 0, 144]], loads: { a, b },
});
const unif = (v: number): AppliedLoad => ({ TYPE: 'UNIFF', DIR: 'GRAV', FVAL: v, DSTART: 0, DEND: 300, RDSTART: 0, RDEND: 1 });

describe('factoring', () => {
  it('a combo of two patterns on one member sums into one load', () => {
    const out = factoredLoads({ Dead: [unif(0.1)], Live: [unif(0.05)] }, { Dead: 1.2, Live: 1.6 });
    expect(out).toHaveLength(1);
    expect(out[0].FVAL).toBeCloseTo(0.2);
    expect(out[0].DEND).toBe(300);
  });

  it('loads at different positions stay separate, each factored', () => {
    const p = (v: number, d: number): AppliedLoad => ({ TYPE: 'POINTF', DIR: 'GRAV', FVAL: v, DIST: d });
    const out = factoredLoads({ Dead: [p(2, 100)], Live: [p(5, 120)] }, { Dead: 1.2, Live: 1.6 });
    expect(out.map((l) => [l.DIST, l.FVAL])).toEqual([[100, 2.4], [120, 8]]);
  });

  it('pattern, combo and non-expandable case factors', () => {
    expect(pickFactors(defs, { kind: 'pattern', name: 'Live' })).toEqual({ factors: { Live: 1 } });
    expect(pickFactors(defs, { kind: 'combo', name: '1.2D+1.6L' })).toEqual({ factors: { Dead: 1.2, Live: 1.6 } });
    expect(pickFactors(defs, { kind: 'case', name: 'Modal' })).toEqual({ reason: 'case Modal is Modal - Eigen, not a static case' });
    expect(pickFactors(defs, { kind: 'combo', name: 'Nope' })).toEqual({ reason: 'Combo Nope is not in this model.' });
  });
});

describe('change detection', () => {
  const d = { a: defs, b: defs };
  it('a changed value, position or presence is a change; equal loads are not', () => {
    expect(loadChanged(beam({ Live: [unif(0.05)] }), { kind: 'pattern', name: 'Live' }, d)).toBe(false);
    expect(loadChanged(beam({ Live: [unif(0.05)] }, { Live: [unif(0.1)] }), { kind: 'pattern', name: 'Live' }, d)).toBe(true);
    expect(loadChanged(beam({ Live: [unif(0.05)] }, { Live: [{ ...unif(0.05), DEND: 200 }] }), { kind: 'pattern', name: 'Live' }, d)).toBe(true);
    expect(loadChanged(beam({ Live: [unif(0.05)] }, {}), { kind: 'pattern', name: 'Live' }, d)).toBe(true);
  });

  it('only the picked patterns count', () => {
    const el = beam({ Dead: [unif(0.1)], Live: [unif(0.05)] }, { Dead: [unif(0.1)], Live: [unif(0.1)] });
    expect(loadChanged(el, { kind: 'pattern', name: 'Dead' }, d)).toBe(false);
    expect(loadChanged(el, { kind: 'combo', name: '1.2D+1.6L' }, d)).toBe(true);
  });
});

describe('directions and axes', () => {
  it('global directions map to world axes', () => {
    const ax = frameAxes([0, 0, 0], [1, 0, 0]);
    expect(direction('GRAV', ax)).toEqual({ v: [0, 0, -1], local: false });
    expect(direction('Y', ax)).toEqual({ v: [0, 1, 0], local: false });
    expect(direction('XPROJ', ax)?.v).toEqual([1, 0, 0]);
    expect(direction('9', ax)).toBeNull();
  });

  it('frame local axes: beam 2 up, column 2 along X, both right-handed', () => {
    const [b1, b2, b3] = frameAxes([0, 0, 0], [0, 10, 0]);
    expect([b1, b2, b3]).toEqual([[0, 1, 0], [0, 0, 1], [1, 0, 0]]);
    const [c1, c2, c3] = frameAxes([0, 0, 0], [0, 0, 10]);
    expect([c1, c2, c3]).toEqual([[0, 0, 1], [1, 0, 0], [0, 1, 0]]);
    expect(direction('2', frameAxes([0, 0, 0], [0, 10, 0]))).toEqual({ v: [0, 0, 1], local: true });
  });

  it('area axis 3 is the upward normal whatever the corner order', () => {
    for (const corners of [[[0, 0, 0], [0, 10, 0], [10, 10, 0]], [[0, 0, 0], [10, 0, 0], [10, 10, 0]]] as [number, number, number][][])
      areaAxes(corners)[2].forEach((x, k) => expect(x).toBeCloseTo([0, 0, 1][k]));
  });
});

describe('arrows', () => {
  it('point load: one arrow at DIST from the I end, head on the member, tail above for gravity', () => {
    const [gl] = loadGlyphs(beam({}), [{ TYPE: 'POINTF', DIR: 'GRAV', FVAL: 10, DIST: 120 }]);
    expect(gl.arrows).toEqual([{ at: [120, 0, 144], dir: [0, 0, -1], value: 10 }]);
    const [shaft] = glyphSegments(gl, maxByClass([gl]), 50);
    expect(shaft).toEqual([[120, 0, 194], [120, 0, 144]]);
  });

  it('trapezoid: a row of arrows over its extent, scaled by value, tails joined', () => {
    const [gl] = loadGlyphs(beam({}), [{ TYPE: 'TRAPF', DIR: 'GRAV', FSTART: 0, FEND: 2, DSTART: 0, DEND: 150 }]);
    expect(gl.arrows).toHaveLength(6); // half the member: 5 spaces
    expect(gl.arrows[0].at).toEqual([0, 0, 144]);
    expect(gl.arrows[5]).toMatchObject({ at: [150, 0, 144], value: 2 });
    const segs = glyphSegments(gl, maxByClass([gl]), 40);
    const tailLine = segs.slice(-5);
    expect(tailLine[0][0]).toEqual([0, 0, 144]); // zero-value end: tail on the member
    expect(tailLine[4][1]).toEqual([150, 0, 184]);
  });

  it('largest load in each class gets the full length', () => {
    const els = loadGlyphs(beam({}), [{ TYPE: 'POINTF', DIR: 'Z', FVAL: -4, DIST: 0 }, { TYPE: 'POINTF', DIR: 'Z', FVAL: 2, DIST: 300 }]);
    const max = maxByClass(els);
    expect(max.force).toBe(4);
    // Negative Z points down, so its tail is above the member.
    expect(glyphSegments(els[0], max, 30)[0]).toEqual([[0, 0, 174], [0, 0, 144]]);
    expect(glyphSegments(els[1], max, 30)[0]).toEqual([[300, 0, 129], [300, 0, 144]]);
  });

  it('joint force: the resultant at the node; moments not drawn', () => {
    const joint = { kind: 'point' as const, geometry: [[0, 0, 0]] as [number, number, number][] };
    const [gl] = loadGlyphs(joint, [{ TYPE: 'FORCE', FX: 3, FY: 0, FZ: -4, MX: 9, MY: 0, MZ: 0 }]);
    expect(gl.arrows[0].value).toBe(5);
    gl.arrows[0].dir.forEach((x, k) => expect(x).toBeCloseTo([0.6, 0, -0.8][k]));
    expect(loadGlyphs(joint, [{ TYPE: 'FORCE', FX: 0, FY: 0, FZ: 0, MX: 9, MY: 0, MZ: 0 }])).toEqual([]);
  });

  it('area load: a sparse grid with the outer tails joined in a loop', () => {
    const slab = { kind: 'area' as const, geometry: [[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0]] as [number, number, number][] };
    const [gl] = loadGlyphs(slab, [{ TYPE: 'UNIFF', DIR: 'GRAV', FVAL: 0.001 }]);
    expect(gl.arrows).toHaveLength(9);
    expect(gl.arrows[8].at).toEqual([50, 50, 0]);
    expect(glyphSegments(gl, maxByClass([gl]), 10)).toHaveLength(9 * 3 + 8);
  });
});

describe('Hack_v04 -> Hack_v05', () => {
  const r = adaptEngine(hack as unknown as EngineDiff, { mock: false });
  const m = r.loads!;
  const b7 = m.elements.filter((e) => e.label === 'B7');
  const live = { kind: 'pattern' as const, name: 'Live' };

  it('carries the loaded elements and definitions', () => {
    expect(pickOptions(m)).toEqual({ pattern: ['Dead', 'Live', 'SW'], case: ['Modal', 'DL', 'LL'], combo: ['1.4D', '1.2D+1.6L'] });
  });

  it("B7's Live point load doubles at Story2 and is a change; Story1 is not", () => {
    const s2 = b7.find((e) => e.story === 'Story2')!;
    expect(loadsFor(s2, 'a', live, m.definitions)[0].FVAL).toBe(5);
    expect(loadsFor(s2, 'b', live, m.definitions)[0].FVAL).toBe(10);
    expect(loadChanged(s2, live, m.definitions)).toBe(true);
    expect(loadChanged(b7.find((e) => e.story === 'Story1')!, live, m.definitions)).toBe(false);
    expect(describeLoad(loadsFor(s2, 'b', live, m.definitions)[0], 'frame')).toBe('Point 10 kip GRAV at 120 in');
  });

  it('1.2D+1.6L on B7 at Story2: factored Live point load and Dead trapezoid', () => {
    const s2 = b7.find((e) => e.story === 'Story2')!;
    const out = loadsFor(s2, 'b', { kind: 'combo', name: '1.2D+1.6L' }, m.definitions);
    expect(out.find((l) => l.TYPE === 'POINTF')!.FVAL).toBeCloseTo(16);
    expect(out.find((l) => l.TYPE === 'TRAPF')!.FSTART).toBeCloseTo(0.1);
  });
});
