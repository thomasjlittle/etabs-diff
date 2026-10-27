// Add version: the rules the form and the save route share, and the form itself.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { defaultDate, revisionErrors, saveLog, scrubPaths, suggestParent } from './newRevision';
import { REVISIONS, type Revision } from './revisions';
import { AddVersion } from './AddVersion';

const MODELS = import.meta.glob<string>('../demo_viewer/models/*.e2k', { query: '?raw', import: 'default', eager: true });
const text = (file: string) => MODELS[`../demo_viewer/models/${file}`];
const ok: Revision = { file: 'Hack_v07.e2k', parents: ['Hack_v06.e2k'], summary: 'Add Story3', body: '', author: 'Me', date: '' };

describe('scrubPaths', () => {
  const raw = [
    '$ File C:\\Users\\jdoe\\OneDrive - Some Co\\Proj\\Hack_v07.e2k saved 10/27/2026 3:01:02 PM',
    '  MATERIAL "C:\\Users\\jdoe\\keep.txt"',
    'ETABS Nonlinear 23.1.1 File saved as c:\\users\\jdoe\\Desktop\\Hack_v07.EDB at 10/27/2026 3:00:00 PM',
  ].join('\r\n');

  it('replaces the user folder in the header and save log only, and keeps line endings', () => {
    const { text: out, replaced } = scrubPaths(raw);
    expect(replaced).toBe(2);
    expect(out.split('\r\n')).toEqual([
      '$ File C:\\Models\\Hackathon\\Hack_v07.e2k saved 10/27/2026 3:01:02 PM',
      '  MATERIAL "C:\\Users\\jdoe\\keep.txt"',
      'ETABS Nonlinear 23.1.1 File saved as C:\\Models\\Hackathon\\Hack_v07.EDB at 10/27/2026 3:00:00 PM',
    ]);
  });

  it('leaves the committed (already scrubbed) models byte for byte the same', () => {
    for (const r of REVISIONS) expect(scrubPaths(text(r.file))).toEqual({ text: text(r.file), replaced: 0 });
  });
});

describe('defaultDate', () => {
  it('is the export time in the $ File header, the same as every manifest date', () => {
    for (const r of REVISIONS) expect(defaultDate(text(r.file)), r.file).toBe(r.date);
  });

  it('falls back to the newest save in the log, and is empty when there is neither', () => {
    expect(defaultDate('x File saved as C:\\a.EDB at 1/2/2026 12:05:09 AM\ny File saved as C:\\a.EDB at 1/2/2026 9:05:09 PM'))
      .toBe('2026-01-02T21:05:09');
    expect(defaultDate('$ PROGRAM INFORMATION')).toBe('');
  });
});

describe('suggestParent', () => {
  it('picks the recorded first parent for every committed model, from the versions listed before it', () => {
    REVISIONS.forEach((r, i) => {
      const before = REVISIONS.slice(0, i).map((e) => ({ file: e.file, log: saveLog(text(e.file)) }));
      expect(suggestParent(saveLog(text(r.file)), before), r.file).toBe(r.parents[0] ?? null);
    });
  });

  it('an identical log (the same save exported again) is suggested, first listed wins a tie', () => {
    const logs = REVISIONS.map((e) => ({ file: e.file, log: saveLog(text(e.file)) }));
    expect(suggestParent(saveLog(text('Hack_v02a.e2k')), logs)).toBe('Hack_v02.e2k');
    expect(suggestParent(saveLog(text('Hack_v04.e2k')), logs)).toBe('Hack_v04.e2k');
  });

  it('no shared save means no suggestion, and an empty log never counts as a prefix', () => {
    expect(suggestParent(['a'], [{ file: 'x', log: [] }, { file: 'y', log: ['b'] }])).toBeNull();
  });
});

describe('revisionErrors', () => {
  it('accepts a good revision, a new root and a merge', () => {
    expect(revisionErrors(ok, REVISIONS)).toEqual([]);
    expect(revisionErrors({ ...ok, parents: [] }, REVISIONS)).toEqual([]);
    expect(revisionErrors({ ...ok, parents: ['Hack_v06.e2k', 'Hack_v02a.e2k'] }, REVISIONS)).toEqual([]);
  });

  it('refuses unsafe or taken file names', () => {
    for (const file of ['../x.e2k', 'a/b.e2k', 'a\\b.e2k', '.e2k', 'x.txt', 'a__b.e2k', `${'a'.repeat(61)}.e2k`])
      expect(revisionErrors({ ...ok, file }, REVISIONS), file).toEqual([expect.stringContaining('File name must be')]);
    expect(revisionErrors({ ...ok, file: 'hack_V06.e2k' }, REVISIONS)).toEqual(['hack_V06.e2k already exists. Pick another file name.']);
    expect(revisionErrors({ ...ok, file: 'Other.e2k' }, REVISIONS, ['other.E2K'])).toHaveLength(1);
  });

  it('refuses unknown or repeated parents', () => {
    expect(revisionErrors({ ...ok, parents: ['Hack_v99.e2k'] }, REVISIONS)).toEqual(['Parent Hack_v99.e2k is not in the revision log.']);
    expect(revisionErrors({ ...ok, parents: ['Hack_v06.e2k', 'Hack_v06.e2k'] }, REVISIONS)).toEqual(['A parent is picked twice.']);
  });

  it('needs a one-line summary of at most 72 characters, an author, and a full date', () => {
    expect(revisionErrors({ ...ok, summary: 'x'.repeat(72) }, REVISIONS)).toEqual([]);
    expect(revisionErrors({ ...ok, summary: 'x'.repeat(73) }, REVISIONS)).toEqual(['Summary is 73 characters; keep it to 72.']);
    expect(revisionErrors({ ...ok, summary: ' ' }, REVISIONS)).toEqual(['Write a summary line.']);
    expect(revisionErrors({ ...ok, summary: 'a\nb' }, REVISIONS)).toEqual(['Summary is one line; put the rest in the body.']);
    expect(revisionErrors({ ...ok, author: '' }, REVISIONS)).toEqual(['Add an author.']);
    expect(revisionErrors({ ...ok, date: '2026-10-27' }, REVISIONS)).toEqual(['Date must look like 2026-10-27T13:12:24.']);
  });
});

describe('Add version form', () => {
  afterEach(cleanup);
  const copyOf = (file: string, as: string) => new File([text(file)], as);
  const loadModel = async (file: string) => text(file);

  it('a copy of v04 pre-selects v04 as parent with its export date, and saves once the summary and author are in', async () => {
    const save = vi.fn(async () => 'Added');
    render(createElement(AddVersion, { revisions: REVISIONS, available: true, loadModel, save }));
    fireEvent.change(screen.getByLabelText('Model file'), { target: { files: [copyOf('Hack_v04.e2k', 'Hack_v04.e2k')] } });
    await waitFor(() => expect(screen.getByText(/Suggested Hack_v04.e2k/)).toBeTruthy());
    const parents = screen.getByLabelText('Parents') as HTMLSelectElement;
    expect([...parents.selectedOptions].map((o) => o.value)).toEqual(['Hack_v04.e2k']);
    expect(screen.getByText('Hack_v04.e2k already exists. Pick another file name.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'Hack_v04b.e2k' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Try a branch off v04' } });
    fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'QA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add version' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect((save.mock.calls[0] as unknown[])[1]).toEqual({
      file: 'Hack_v04b.e2k', parents: ['Hack_v04.e2k'], summary: 'Try a branch off v04', body: '', author: 'QA', date: '2026-10-27T13:27:15',
    });
  });

  it('without the dev server the form is disabled with the reason', () => {
    render(createElement(AddVersion, { revisions: REVISIONS, available: false }));
    expect(screen.getByText(/Adding a version needs the dev server/)).toBeTruthy();
    expect((screen.getByLabelText('Model file') as HTMLInputElement).closest('fieldset')!.disabled).toBe(true);
  });
});
