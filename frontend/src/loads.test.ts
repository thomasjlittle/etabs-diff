// Load records read as an engineer would say them. Expected values worked by hand:
// 0.083333336 kip/in x 12 in/ft = 1.0 kip/ft; 0.0003472222 kip/in² x 144,000 = 50.0 psf; 60 kip-in / 12 = 5.0 kip-ft.
import { describe, expect, it } from 'vitest';
import { loadField, loadValue } from './loads';
import { adaptEngine, type EngineDiff } from './engineAdapter';
import { describeChange } from './data';
import example from '../demo_viewer/example-diff.json';

const kipIn = { length: 'in', force: 'kip' };

describe('load text', () => {
  it('frame uniform load in kip/ft', () => {
    expect(loadValue('loads:Dead', 'frame', [{ TYPE: 'UNIFF', DIR: 'GRAV', FVAL: 0.083333336 }], kipIn))
      .toBe('Uniform load 1.0 kip/ft, gravity');
  });

  it('frame point load with its relative position', () => {
    expect(loadValue('loads:Live', 'frame', [{ TYPE: 'POINTF', DIR: 'GRAV', FVAL: 10.0, RDIST: 0.4 }], kipIn))
      .toBe('Point load 10.0 kip, gravity, at 0.4 L');
  });

  it('area load in psf', () => {
    expect(loadValue('loads:Live', 'area', [{ TYPE: 'UNIFF', DIR: 'GRAV', FVAL: 0.0003472222222 }], kipIn))
      .toBe('Area load 50.0 psf, gravity');
  });

  it('joint force lists only nonzero components, moments in kip-ft', () => {
    expect(loadValue('loads:SDL', 'point', [{ TYPE: 'FORCE', FX: 0, FY: 0, FZ: -12.0, MX: 60, MY: 0, MZ: 0 }], kipIn))
      .toBe('Joint load FZ -12.0 kip, MX 5.0 kip-ft');
  });

  it('several records join with +, an empty list is none', () => {
    expect(loadValue('loads:Dead', 'frame', [
      { TYPE: 'UNIFF', DIR: 'GRAV', FVAL: 0.083333336 }, { TYPE: 'POINTF', DIR: 'X', FVAL: 2, RDIST: 0.5 },
    ], kipIn)).toBe('Uniform load 1.0 kip/ft, gravity + Point load 2.0 kip, global X, at 0.5 L');
    expect(loadValue('loads:Dead', 'frame', [], kipIn)).toBe('none');
  });

  it('single joint load component, and field labels', () => {
    expect(loadValue('load:LIVE.FZ', 'point', -5.0, kipIn)).toBe('-5.0 kip');
    expect(loadField('load:LIVE.FZ')).toBe('LIVE joint load FZ');
    expect(loadField('loads:Dead')).toBe('Dead loads');
    expect(loadField('SECTION')).toBeNull();
  });

  it('other units are shown as stored, not converted', () => {
    expect(loadValue('loads:Dead', 'frame', [{ TYPE: 'UNIFF', DIR: 'GRAV', FVAL: 15 }], { length: 'm', force: 'kN' }))
      .toBe('Uniform load 15.0 kN/m, gravity');
  });

  it('an unknown record type falls back to the raw display', () => {
    expect(loadValue('loads:SDL', 'frame', [{ TYPE: 'TRAPF', FVAL: 1 }], kipIn)).toBeUndefined();
  });

  it('the example joint load reads as a sentence', () => {
    const r = adaptEngine(example as unknown as EngineDiff, { mock: false });
    const c = r.changes.find((x) => x.subject === 'Joint B2 at Story3')!;
    expect(describeChange(c, r)).toMatch(/^Joint B2 at Story3: LIVE joint load FZ changed from .* kip to .* kip\.$/);
  });
});
