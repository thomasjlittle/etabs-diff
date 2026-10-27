// Acceptance checks for step 1. Expected numbers come from the hand-check list in src/mock/make_mock.py.
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import mock from './mock/mock-result.json';
import type { Result } from './vantageTypes';
import {
  byExtent, describeChange, headlineCounts, isPhysical, isVisible, memberStyles, memberToChange, moves, reducer,
  storyChangeCounts,
} from './data';
import { Workspace } from './App';

const result = mock as unknown as Result;
const change = (id: string) => result.changes.find((c) => c.id === id)!;

describe('mock data rules', () => {
  it('headline counts match the hand-check list', () => {
    expect(headlineCounts(result)).toEqual({ added: 1, removed: 1, modified: 3, label_only: 2 });
  });

  it('every file is marked mock', () => {
    expect(result.mock).toBe(true);
    expect(result.meta.mock).toBe(true);
  });

  it('rename and reversed end order are not physical and their members are unchanged geometry', () => {
    for (const id of ['C04', 'C05']) {
      const c = change(id);
      expect(isPhysical(c)).toBe(false);
      expect(c.group).toBe('LO');
      for (const m of c.member_ids) expect(result.members.find((x) => x.id === m)!.side).toBe('both');
    }
  });

  it('geometry group ranks by extent: level, then moved beam, then removed beam', () => {
    const g1 = result.changes.filter((c) => c.group === 'G1').sort(byExtent).map((c) => c.id);
    expect(g1).toEqual(['C01', 'C02', 'C03']);
  });

  it('sentences carry numbers and units from the data', () => {
    expect(describeChange(change('C01'), result)).toBe('A new level, L5, was added at elevation 840.0 in with 13 members.');
    expect(describeChange(change('C02'), result)).toContain('a shift of 24.0 in');
    expect(describeChange(change('C07'), result)).toBe(
      'Material STEEL-COL: Fy changed from 50.0 kip/in² to 55.0 kip/in². 6 members use it.',
    );
  });

  it('no severity language in any description', () => {
    const text = result.changes.map((c) => describeChange(c, result)).join(' ').toLowerCase();
    for (const w of ['critical', 'severe', 'dangerous', 'unsafe']) expect(text).not.toContain(w);
  });
});

describe('viewer drawing rules', () => {
  const ids = (id: string) => change(id).member_ids;

  it('rename and reversed end order are drawn as unchanged in both color modes', () => {
    for (const mode of ['change', 'property'] as const) {
      const s = memberStyles(result, mode);
      for (const m of [...ids('C04'), ...ids('C05')]) expect(s.get(m)).toBeUndefined(); // undefined = context gray
    }
  });

  it('added, removed and moved members get their styles', () => {
    const s = memberStyles(result, 'change');
    ids('C01').forEach((m) => expect(s.get(m)).toBe('added'));
    expect(s.get(ids('C03')[0])).toBe('removed');
    expect(s.get(ids('C02')[0])).toBe('previous');
    expect(s.get(ids('C02')[1])).toBe('revised_position');
  });

  it('section and material changes are highlighted only in Section/Material mode', () => {
    expect(memberStyles(result, 'change').get(ids('C06')[0])).toBeUndefined();
    expect(memberStyles(result, 'property').get(ids('C06')[0])).toBe('property');
    ids('C07').forEach((m) => expect(memberStyles(result, 'property').get(m)).toBe('property'));
  });

  it('baseline view hides revised-only members, revised view hides baseline-only ones', () => {
    expect(isVisible('revised', 'baseline')).toBe(false);
    expect(isVisible('baseline', 'revised')).toBe(false);
    expect(isVisible('both', 'baseline') && isVisible('both', 'revised')).toBe(true);
    expect(isVisible('baseline', 'overlay') && isVisible('revised', 'overlay')).toBe(true);
  });

  it('a moved endpoint gives one arrow from old to new position', () => {
    expect(moves(result)).toEqual([{ change: 'C02', from: [360, 360, 504], to: [336, 360, 504] }]);
  });

  it('clicking a member selects its physical change; a renamed member selects the rename', () => {
    const map = memberToChange(result);
    expect(map.get(ids('C03')[0])).toBe('C03');
    expect(map.get(ids('C04')[0])).toBe('C04');
  });

  it('story strip counts physical changes per story', () => {
    expect(storyChangeCounts(result)).toEqual({ L1: 1, L2: 2, L3: 1, L5: 1 });
  });
});

describe('load state', () => {
  it('a failed load clears the previous result and selection', () => {
    let s = reducer({ load: { status: 'loading' }, selectedChangeId: null }, { type: 'load_ok', result });
    s = reducer(s, { type: 'select', id: 'C02' });
    s = reducer(s, { type: 'load_fail', message: 'boom' });
    expect(s).toEqual({ load: { status: 'error', message: 'boom' }, selectedChangeId: null });
  });
});

describe('shared selection', () => {
  afterEach(cleanup);
  function Harness() {
    const [sel, setSel] = useState<string | null>(null);
    return <Workspace result={result} selectedId={sel} onSelect={setSel} />;
  }

  it('clicking a category lists only its changes in the table; a table click selects everywhere', () => {
    render(<Harness />);
    expect((screen.getByTestId('category-frameSections') as HTMLButtonElement).disabled).toBe(true); // no changes to list

    fireEvent.click(screen.getByTestId('category-objects'));
    expect(screen.getByTestId('category-objects').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('row-C02')).toBeTruthy();
    expect(screen.queryByTestId('row-C06')).toBeNull(); // C06 is a section assignment

    fireEvent.click(screen.getByTestId('row-C02'));
    expect(screen.getByTestId('row-C02').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('detail').textContent).toContain('C02');

    fireEvent.click(screen.getByTestId('category-objects')); // click again: show every category
    expect(screen.getByTestId('category-objects').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('row-C06'));
    expect(screen.getByTestId('row-C02').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('detail').textContent).toContain('W14X120');
  });

  it('sections with changes start open, empty ones closed; clicking a header flips it', () => {
    render(<Harness />);
    expect(screen.getByTestId('section-Objects').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('section-Design').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('category-designPrefs')).toBeNull();
    fireEvent.click(screen.getByTestId('section-Design'));
    expect(screen.getByTestId('category-designPrefs').textContent).toContain('Not compared');
    fireEvent.click(screen.getByTestId('section-Objects'));
    expect(screen.queryByTestId('category-objects')).toBeNull();
  });
});
