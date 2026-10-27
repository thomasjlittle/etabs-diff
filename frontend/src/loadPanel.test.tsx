// Loads control (off by default, pick, not-expandable reason) and the loads section of the details panel.
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import hack from '../demo_viewer/diffs/Hack_v04__Hack_v05.json';
import { adaptEngine, type EngineDiff } from './engineAdapter';
import { LoadDetails, LoadsControl } from './LoadPanel';
import type { LoadView } from './loads';

const r = adaptEngine(hack as unknown as EngineDiff, { mock: false });
afterEach(cleanup);

function Harness() {
  const [view, setView] = useState<LoadView | null>(null);
  return <LoadsControl loads={r.loads!} view={view} onChange={setView} />;
}

describe('loads control', () => {
  it('is off by default, then lists patterns, cases and combos, model 2 first', () => {
    render(<Harness />);
    expect(screen.queryByLabelText('Load pick')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show loads'));
    const pick = screen.getByLabelText('Load pick') as HTMLSelectElement;
    expect([...pick.options].map((o) => o.value)).toEqual(
      ['pattern:Dead', 'pattern:Live', 'pattern:SW', 'case:Modal', 'case:DL', 'case:LL', 'combo:1.4D', 'combo:1.2D+1.6L']);
    expect((screen.getByLabelText('Load model') as HTMLSelectElement).value).toBe('b');
  });

  it('a case that is not expandable shows its reason', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Show loads'));
    fireEvent.change(screen.getByLabelText('Load pick'), { target: { value: 'case:Modal' } });
    expect(screen.getByRole('status').textContent).toBe('Not drawn: case Modal is Modal - Eigen, not a static case');
  });
});

describe('load details', () => {
  const b7 = r.loads!.elements.find((e) => e.label === 'B7' && e.story === 'Story2')!;
  it("shows B7's Live load in both models, flagged as different", () => {
    render(<LoadDetails result={r} view={{ pick: { kind: 'pattern', name: 'Live' }, side: 'b', scale: 1 }} focus={b7.key} selectedId={null} />);
    const text = screen.getByTestId('load-detail').textContent!;
    expect(text).toContain('Loads on Beam B7 at Story2');
    expect(text).toContain('differs between models');
    expect(text).toContain('Model 1Point 5 kip GRAV at 120 in');
    expect(text).toContain('Model 2 (drawn)Point 10 kip GRAV at 120 in');
  });
});
