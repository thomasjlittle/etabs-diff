// Revision log: the hand-edited manifest is valid, and the graph lays out the v02a branch in its own lane.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { layoutGraph, manifestErrors, REVISIONS, type Revision } from './revisions';
import { RevisionLog } from './RevisionLog';
import { MODELS } from './App';

const FILES = Object.keys(import.meta.glob('../demo_viewer/models/*.e2k')).map((p) => p.split('/').pop()!);
const rev = (file: string, parents: string[] = []): Revision => ({ file, parents, summary: file, body: '', author: '', date: '' });

describe('revision manifest', () => {
  it('is valid: every file exists, every parent is listed before its child (so no cycles)', () => {
    expect(manifestErrors(REVISIONS, FILES)).toEqual([]);
  });

  it('covers every model the review view offers', () => {
    expect(REVISIONS.map((r) => r.file.replace('.e2k', '')).sort()).toEqual([...MODELS].sort());
  });

  it('catches a missing file, an unknown parent and a cycle', () => {
    expect(manifestErrors([rev('a.e2k', ['b.e2k']), rev('b.e2k', ['a.e2k']), rev('gone.e2k')], ['a.e2k', 'b.e2k'])).toEqual([
      'a.e2k: parent b.e2k is not listed before it',
      'gone.e2k does not exist',
    ]);
  });

  it('summary lines stay git-sized and dates never go backwards', () => {
    for (const r of REVISIONS) expect(r.summary.length, r.file).toBeLessThanOrEqual(52);
    const dates = REVISIONS.map((r) => r.date).filter(Boolean);
    expect(dates).toEqual([...dates].sort());
  });
});

describe('graph layout', () => {
  it('puts the v02a branch in lane 1 and everything else in lane 0', () => {
    const rows = layoutGraph(REVISIONS);
    expect(rows.map((r) => [r.rev.file, r.lane])).toEqual([
      ['Hack_v06.e2k', 0], ['Hack_v05.e2k', 0], ['Hack_v04.e2k', 0], ['Hack_v03.e2k', 0],
      ['Hack_v02a.e2k', 1], ['Hack_v02.e2k', 0], ['Hack_v01a.e2k', 0], ['Hack_v01.e2k', 0],
    ]);
    // Both lanes wait for v02 below the branch row, and close into one at v02.
    const branch = rows.find((r) => r.rev.file === 'Hack_v02a.e2k')!;
    expect(branch.below).toEqual(['Hack_v02.e2k', 'Hack_v02.e2k']);
    expect(rows.find((r) => r.rev.file === 'Hack_v02.e2k')!.below).toEqual(['Hack_v01a.e2k']);
    expect(rows.at(-1)!.below).toEqual([]);
  });

  it('a merge opens a lane for its second parent and both close at the shared root', () => {
    const rows = layoutGraph([rev('r'), rev('x', ['r']), rev('y', ['r']), rev('m', ['x', 'y'])]);
    expect(rows.map((r) => [r.rev.file, r.lane])).toEqual([['m', 0], ['y', 1], ['x', 0], ['r', 0]]);
    expect(rows[0].below).toEqual(['x', 'y']);
  });
});

describe('revision log page', () => {
  it('shows counts against the parent, opens a row against its parent, and compares two picks oldest first', async () => {
    const opened: string[][] = [];
    render(createElement(RevisionLog, { onOpen: (a: string, b: string) => opened.push([a, b]) }));
    // v05 -> v06: 2 modified, 17 affected through the A992Fy50 edit.
    await waitFor(() => expect(screen.getAllByText('17 affected')).toHaveLength(1));
    fireEvent.click(screen.getByText('Export Hack_v02 in lb and ft'));
    fireEvent.click(screen.getByLabelText('Select Hack_v06.e2k'));
    fireEvent.click(screen.getByLabelText('Select Hack_v01a.e2k'));
    fireEvent.click(screen.getByText('Compare selected'));
    expect(opened).toEqual([['Hack_v02', 'Hack_v02a'], ['Hack_v01a', 'Hack_v06']]);
  });
});
