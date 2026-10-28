// Data, drawing and panel rules on the seeded demo (fixtures/demo/, engine output). Its seeded changes are
// listed in fixtures/demo/seeded-changes.json; review.test.tsx checks each one against the app.
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import demo from '../../fixtures/demo/diff.json';
import { adaptEngine, type EngineDiff } from './engineAdapter';
import {
  byExtent, describeChange, elementChanges, headlineCounts, isPhysical, isVisible, memberStyles, memberToChange, moves,
  reducer, storyChangeCounts,
} from './data';
import { categoryOf } from './categories';
import { Workspace } from './App';

const result = adaptEngine(demo as unknown as EngineDiff, { mock: true });
const change = (id: string) => result.changes.find((c) => c.id === id)!;
const physicalMembers = new Set(result.changes.filter(isPhysical).flatMap((c) => c.member_ids));
// Renamed frames that nothing physical touches (no move, no section or material edit upstream).
const renamedOnly = result.changes.filter((c) => !isPhysical(c)).flatMap((c) => c.member_ids).filter((m) => !physicalMembers.has(m));

describe('seeded demo data rules', () => {
  it('headline counts: 2 added, 2 removed, 29 modified, 104 renames', () => {
    expect(headlineCounts(result)).toEqual({ added: 2, removed: 2, modified: 29, label_only: 104 });
  });

  it('renames are not physical, and the renamed members are in both files', () => {
    const renames = result.changes.filter((c) => c.type === 'label_only');
    expect(renames.every((c) => !isPhysical(c) && categoryOf(c) === 'labelOnly')).toBe(true);
    for (const m of renames.flatMap((c) => c.member_ids)) expect(result.members.find((x) => x.id === m)!.side).toBe('both');
  });

  it('objects rank by extent: the moved beam, then the drawn removal and addition, then listed-only areas', () => {
    const objects = result.changes.filter((c) => categoryOf(c) === 'objects').sort(byExtent).map((c) => c.id);
    expect(objects).toEqual(['C01', 'C117', 'C119', 'C118', 'C120']);
  });

  it('sentences carry numbers and units from the data', () => {
    expect(describeChange(change('C117'), result)).toBe('Beam B24 at L5 was removed.');
    expect(describeChange(change('C01'), result)).toContain('a shift of 24.0 in relative to its story');
    expect(describeChange(change('C43'), result)).toBe('Column C7 at L3 was reassigned from section W14X120 to W14X132.');
    expect(describeChange(change('C126'), result)).toContain('Material LW3000: FC changed from 3.0 ksi to 4.0 ksi');
  });

  it('no severity language in any description', () => {
    const text = result.changes.map((c) => describeChange(c, result)).join(' ').toLowerCase();
    for (const w of ['critical', 'severe', 'dangerous', 'unsafe']) expect(text).not.toContain(w);
  });

  it('every change to an element: shared members, or the same subject for undrawn elements', () => {
    expect(elementChanges(result, change('C43')).map((c) => c.id)).toEqual(['C43']);
    expect(elementChanges(result, change('C126')).map((c) => c.id)).toEqual(['C126']);
    // The B36 -> B44 move and any other change on either end of it.
    expect(elementChanges(result, change('C01')).map((c) => c.id)).toContain('C01');
  });
});

describe('viewer drawing rules', () => {
  const ids = (id: string) => change(id).member_ids;

  it('renamed members are drawn as unchanged in both color modes', () => {
    expect(renamedOnly.length).toBeGreaterThan(0);
    for (const mode of ['change', 'property'] as const) {
      const s = memberStyles(result, mode);
      for (const m of renamedOnly) expect(s.get(m)).toBeUndefined(); // undefined = context gray
    }
  });

  it('added, removed and moved members get their styles', () => {
    const s = memberStyles(result, 'change');
    expect(s.get(ids('C119')[0])).toBe('added');
    expect(s.get(ids('C117')[0])).toBe('removed');
    expect(s.get(ids('C01')[0])).toBe('previous');
    expect(s.get(ids('C01')[1])).toBe('revised_position');
  });

  it('section and material changes are highlighted only in Section/Material mode', () => {
    expect(memberStyles(result, 'change').get(ids('C43')[0])).toBeUndefined();
    expect(memberStyles(result, 'property').get(ids('C43')[0])).toBe('property');
    ids('C128').forEach((m) => expect(memberStyles(result, 'property').get(m)).toBe('property'));
  });

  it('baseline view hides revised-only members, revised view hides baseline-only ones', () => {
    expect(isVisible('revised', 'baseline')).toBe(false);
    expect(isVisible('baseline', 'revised')).toBe(false);
    expect(isVisible('both', 'baseline') && isVisible('both', 'revised')).toBe(true);
    expect(isVisible('baseline', 'overlay') && isVisible('revised', 'overlay')).toBe(true);
  });

  it('a moved member gives one arrow per moved end, old to new position', () => {
    expect(moves(result)).toEqual([
      { change: 'C01', from: [540, 300, 492], to: [564, 300, 504] },
      { change: 'C01', from: [540, 600, 492], to: [564, 600, 504] },
    ]);
  });

  it('clicking a member selects its physical change; a renamed-only member selects the rename', () => {
    const map = memberToChange(result);
    expect(map.get(ids('C117')[0])).toBe('C117');
    const renamed = result.changes.find((c) => c.type === 'label_only' && c.member_ids[0] === renamedOnly[0])!;
    expect(map.get(renamedOnly[0])).toBe(renamed.id);
  });

  it('story strip counts physical changes per story', () => {
    expect(storyChangeCounts(result)).toEqual({ L2: 4, L3: 3, L4: 1, L5: 2, L6: 2, Roof: 1 });
  });
});

describe('load state', () => {
  it('a failed load clears the previous result and selection', () => {
    let s = reducer({ load: { status: 'loading' }, selectedChangeId: null }, { type: 'load_ok', result });
    s = reducer(s, { type: 'select', id: 'C01' });
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
    expect((screen.getByTestId('category-shellSections') as HTMLButtonElement).disabled).toBe(true); // no changes to list

    fireEvent.click(screen.getByTestId('category-objects'));
    expect(screen.getByTestId('category-objects').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('row-C01')).toBeTruthy();
    expect(screen.queryByTestId('row-C43')).toBeNull(); // C43 is a section assignment

    fireEvent.click(screen.getByTestId('row-C01'));
    expect(screen.getByTestId('row-C01').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('detail').textContent).toContain('C01');

    fireEvent.click(screen.getByTestId('category-objects')); // click again: show every category
    expect(screen.getByTestId('category-objects').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('row-C43'));
    expect(screen.getByTestId('row-C01').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('detail').textContent).toContain('W14X120');
  });

  it('the details panel lists every change to the element, and a click there selects it', () => {
    // Two changes on one beam: a rename and a section reassignment.
    const d = structuredClone(demo) as unknown as EngineDiff;
    const el = d.elements.find((e) => e.label === 'C7' && e.story === 'L3')!;
    el.changes.push({ field: 'label', before: 'C7old', after: 'C7', affects: [], unit: null, kind: 'renamed' });
    const r = adaptEngine(d, { mock: true });
    const [section, rename] = r.changes.filter((c) => c.member_ids.includes(el.key));
    function Two() {
      const [sel, setSel] = useState<string | null>(section.id);
      return <Workspace result={r} selectedId={sel} onSelect={setSel} />;
    }
    render(<Two />);
    const list = screen.getByRole('list', { name: 'Changes to this element' });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
      `${section.id} Modified · Section assignment`, `${rename.id} Label only · Label-only (not physical)`,
    ]);
    expect(within(list).getByRole('button', { current: true }).textContent).toContain(section.id);
    fireEvent.click(within(list).getByText(rename.id));
    expect(screen.getByTestId(`row-${rename.id}`).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('detail').textContent).toContain('was renamed from C7old to C7');
  });

  it('a change with no other change on its element shows no element list', () => {
    render(<Workspace result={result} selectedId="C126" onSelect={() => {}} />);
    expect(screen.queryByRole('list', { name: 'Changes to this element' })).toBeNull();
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

describe('resizable panes', () => {
  afterEach(cleanup);
  // jsdom has no PointerEvent; a MouseEvent carries the same clientX, which is all the splitter reads.
  if (!('PointerEvent' in window)) Object.assign(window, { PointerEvent: MouseEvent });

  it('each side pane hides and comes back from its splitter button', () => {
    render(<Workspace result={result} selectedId={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide summary panel' }));
    expect(screen.queryByTestId('pane-summary')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show summary panel' }));
    expect(screen.getByTestId('pane-summary')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide detail panel' }));
    expect(screen.queryByTestId('pane-detail')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide change table' }));
    expect(screen.queryByTestId('pane-table')).toBeNull();
  });

  it('picking a category brings a hidden change table back', () => {
    render(<Workspace result={result} selectedId={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide change table' }));
    fireEvent.click(screen.getByTestId('category-objects'));
    expect(screen.getByTestId('pane-table')).toBeTruthy();
  });

  it('dragging the summary splitter widens the pane, within limits', () => {
    render(<Workspace result={result} selectedId={null} onSelect={() => {}} />);
    const pane = screen.getByTestId('pane-summary');
    const bar = screen.getByRole('separator', { name: 'Resize summary panel' });
    expect(pane.style.width).toBe('320px');
    fireEvent.pointerDown(bar, { clientX: 320 });
    fireEvent.pointerMove(window, { clientX: 400 });
    fireEvent.pointerUp(window);
    expect(pane.style.width).toBe('400px');
    fireEvent.pointerDown(bar, { clientX: 400 });
    fireEvent.pointerMove(window, { clientX: 2000 });
    fireEvent.pointerUp(window);
    expect(pane.style.width).toBe('640px'); // max
  });
});
