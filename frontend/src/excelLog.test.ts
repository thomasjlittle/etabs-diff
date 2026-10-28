import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Result } from './keeptabsTypes';
import { comparisonKey, groupedChangeNotes, updateWorkbook, versionName } from './excelLog';

function result(baseline = 'Hack_v01a.e2k', revised = 'Hack_v02.e2k'): Result {
  return {
    mock: false,
    meta: { source: { baseline, revised }, units: { length: 'in', force: 'kip' } },
    stories: [],
    nodes: [
      { id: 'N(0,144,144)', xyz: [0, 144, 144], side: 'both' },
      { id: 'N(240,144,144)', xyz: [240, 144, 144], side: 'both' },
    ],
    members: [{
      id: 'B2@Story1', kind: 'beam', label: 'B2', story: 'Story1', grid: 'A-B/2',
      end_nodes: ['N(0,144,144)', 'N(240,144,144)'], side: 'both',
    }],
    changes: [{
      id: 'C01', type: 'modified', category: 'sectionAssign', member_ids: ['B2@Story1'], extent: { members: 1, distance: 0 },
      before: { section: 'W18X60' }, after: { section: 'W12X58' },
    }],
  };
}

function template(): Uint8Array {
  const cells = (row: number) => `<row r="${row}"><c r="A${row}"/><c r="B${row}"/><c r="C${row}"/><c r="D${row}"/></row>`;
  const xml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A2:H54"/><sheetData>${cells(26).replace('<c r="D26"/>', '<c r="D26" t="inlineStr"><is><t>Existing information</t></is></c>')}${cells(43)}${cells(44)}</sheetData></worksheet>`;
  return zipSync({ 'xl/worksheets/sheet1.xml': strToU8(xml) });
}

function cell(xml: string, address: string): string {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const found = document.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'c');
  const item = [...found].find((candidate) => candidate.getAttribute('r') === address);
  const namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return item?.getElementsByTagNameNS(namespace, 't')[0]?.textContent
    ?? item?.getElementsByTagNameNS(namespace, 'v')[0]?.textContent
    ?? '';
}

describe('Analysis Register export', () => {
  it('notes each change under its category bucket, with the engine grid of each member', () => {
    const r = result();
    r.changes.push({
      ...r.changes[0], id: 'C02', category: 'diaphragms', member_ids: [], subject: 'Floor F3 at L2',
      before: { DIAPH: 'D1' }, after: { DIAPH: 'D2' },
    });
    const notes = groupedChangeNotes(r);
    expect(notes[1]).toContain('Section assignments: Beam B2 at Story1 was reassigned');
    expect(notes[1]).toContain('Location: B2 (grid A-B/2).');
    expect(notes[notes.length - 1]).toMatch(/^Other model changes: Floor F3 at L2/); // not listed: the last bucket
  });

  it('appends a comparison after existing content and replaces only its tracked rows', () => {
    const first = result('Hack_v01.e2k', 'Hack_v01a.e2k');
    const firstUpdate = updateWorkbook(template(), first, {}, 'append');
    expect(firstUpdate.block.startRow).toBe(27);

    const second = result('Hack_v01a.e2k', 'Hack_v02.e2k');
    const secondUpdate = updateWorkbook(
      firstUpdate.bytes, second, firstUpdate.history, 'append',
    );
    expect(secondUpdate.block.startRow).toBe(37);

    const replaced = result('Hack_v01.e2k', 'Hack_v01a.e2k');
    replaced.changes[0].after = { section: 'W14X90' };
    const replaceUpdate = updateWorkbook(
      secondUpdate.bytes, replaced, secondUpdate.history, 'replace',
    );
    const sheet = strFromU8(unzipSync(replaceUpdate.bytes)['xl/worksheets/sheet1.xml']);
    expect(cell(sheet, 'D26')).toBe('Existing information');
    expect(cell(sheet, 'A27')).toBe('v01a');
    expect(cell(sheet, 'A37')).toBe('v02');
    expect(cell(sheet, 'D29')).toContain('grid A-B/2'); // section assignments are the second bucket, two rows below the header
    expect(cell(sheet, 'D39')).toContain('W12X58');
    expect(versionName('Hack_v01a.e2k')).toBe('v01a');
    expect(comparisonKey(first)).toContain('hack_v01.e2k');
  });

  it('refuses to append to a workbook missing a previously tracked comparison', () => {
    const first = result('Hack_v01.e2k', 'Hack_v01a.e2k');
    const firstUpdate = updateWorkbook(template(), first, {}, 'append');
    expect(() => updateWorkbook(
      template(), result('Hack_v01a.e2k', 'Hack_v02.e2k'), firstUpdate.history, 'append',
    )).toThrow('Choose the latest register');
  });

  it('appends to the shipped template and keeps its sheet and styles valid', () => {
    const shipped = new Uint8Array(readFileSync('public/analysis-register-template.xlsx')) // vitest runs from frontend/);
    const update = updateWorkbook(shipped, result('Hack_v01.e2k', 'Hack_v01a.e2k'), {}, 'append');
    const files = unzipSync(update.bytes);
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(cell(sheet, `A${update.block.startRow}`)).toBe('v01a');
    expect(cell(sheet, `D${update.block.startRow + 2}`)).toContain('W12X58');
    for (const name of ['xl/worksheets/sheet1.xml', 'xl/styles.xml']) {
      const parsed = new DOMParser().parseFromString(strFromU8(files[name]), 'application/xml');
      expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    }
  });
});
