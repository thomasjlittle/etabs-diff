// Loads control (on by default, default pick, per-model notes) and the loads section of the details panel.
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import hack from '../demo_viewer/diffs/Hack_v04__Hack_v05.json';
import v01a from '../demo_viewer/diffs/Hack_v01a__Hack_v01.json';
import { adaptEngine, type EngineDiff } from './engineAdapter';
import { LoadDetails, LoadsControl } from './LoadPanel';
import { type LoadView, defaultLoadView, loadNote } from './loads';

const r = adaptEngine(hack as unknown as EngineDiff, { mock: false });
const captain = adaptEngine(v01a as unknown as EngineDiff, { mock: false }); // Model 2 has no applied loads
afterEach(cleanup);

function Harness() {
  const [view, setView] = useState<LoadView | null>(defaultLoadView(r.loads!));
  return <LoadsControl loads={r.loads!} view={view} onChange={setView} />;
}

describe('loads control', () => {
  it('is on by default with no model picker, and lists patterns, cases and combos', () => {
    render(<Harness />);
    expect((screen.getByLabelText('Show loads') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText('Load model')).toBeNull();
    const pick = screen.getByLabelText('Load pick') as HTMLSelectElement;
    expect([...pick.options].map((o) => o.value)).toEqual(
      ['pattern:Dead', 'pattern:Live', 'pattern:SW', 'case:Modal', 'case:DL', 'case:LL', 'combo:1.4D', 'combo:1.2D+1.6L']);
    expect(pick.value).toBe('pattern:Dead');
  });

  it('ticked off and on again, goes back to the default pick', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Load pick'), { target: { value: 'pattern:Live' } });
    fireEvent.click(screen.getByLabelText('Show loads'));
    expect(screen.queryByLabelText('Load pick')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show loads'));
    expect((screen.getByLabelText('Load pick') as HTMLSelectElement).value).toBe('pattern:Dead');
  });
});

describe('default pick and pane notes', () => {
  const dead = { kind: 'pattern', name: 'Dead' } as const;
  it('skips a pattern with no applied loads (self-weight only)', () => {
    const loads = { ...r.loads!, elements: r.loads!.elements.map((e) => ({ ...e, loads: { a: {}, b: { Live: e.loads.b.Live ?? [] } } })) };
    expect(defaultLoadView(loads).pick).toEqual({ kind: 'pattern', name: 'Live' });
  });

  it("the captain's pair: Model 1 draws its loads, Model 2 says it has none", () => {
    const view = defaultLoadView(captain.loads!);
    expect(view.pick).toEqual(dead);
    expect(loadNote(captain.loads!, 'a', view.pick, 'Hack_v01a.e2k')).toBeNull();
    expect(loadNote(captain.loads!, 'b', view.pick, 'Hack_v01.e2k')).toBe('No applied loads in Hack_v01 for Dead');
  });

  it('a case that is not expandable shows its reason in each pane', () => {
    const modal = { kind: 'case', name: 'Modal' } as const;
    expect(loadNote(r.loads!, 'a', modal, 'Hack_v04.e2k')).toBe('Modal not drawn: case Modal is Modal - Eigen, not a static case');
    expect(loadNote(r.loads!, 'b', dead, 'Hack_v05.e2k')).toBeNull();
  });
});

describe('load details', () => {
  const b7 = r.loads!.elements.find((e) => e.label === 'B7' && e.story === 'Story2')!;
  it("shows B7's Live load in both models, flagged as different", () => {
    render(<LoadDetails result={r} view={{ pick: { kind: 'pattern', name: 'Live' }, scale: 1 }} focus={b7.key} selectedId={null} />);
    const text = screen.getByTestId('load-detail').textContent!;
    expect(text).toContain('Loads on Beam B7 at Story2');
    expect(text).toContain('differs between models');
    expect(text).toContain('Model 1Point 5 kip gravity at 120 in');
    expect(text).toContain('Model 2Point 10 kip gravity at 120 in');
  });
});
