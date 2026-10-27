import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Result } from './vantageTypes';
import {
  comparisonKey, groupedChangeNotes, memberGridLocation, parseGridLines, updateWorkbook, versionName,
} from './excelLog';

const grids = parseGridLines(`
  GRID "G1" LABEL "A" DIR "X" COORD 0
  GRID "G1" LABEL "B" DIR "X" COORD 240
  GRID "G1" LABEL "1" DIR "Y" COORD 0
  GRID "G1" LABEL "2" DIR "Y" COORD 144
`);

function result(baseline = 'Hack_v01a.e2k', revised = 'Hack_v02.e2k'): Result {
  return {
    mock: false,
    meta: {
      schema_version: 'test',
      source: { baseline, revised },
      units: { length: 'in', force: 'kip' },
      coordinate_system: { axes: 'X, Y plan; Z up', aligned: true, offset: [0, 0, 0] },
      match_tolerance: 0.1,
      mock: false,
    },
    stories: [],
    nodes: [
      { id: 'N(0,144,144)', xyz: [0, 144, 144], side: 'both' },
      { id: 'N(240,144,144)', xyz: [240, 144, 144], side: 'both' },
    ],
    members: [{
      id: 'B2@Story1', kind: 'beam', label: 'B2', story: 'Story1',
      end_nodes: ['N(0,144,144)', 'N(240,144,144)'], side: 'both',
    }],
    changes: [{
      id: 'C01', type: 'modified', group: '1A', member_ids: ['B2@Story1'], extent: { members: 1, distance: 0 },
      before: { section: 'W18X60' }, after: { section: 'W12X58' }, evidence: [],
    }],
    groups: [],
    warnings: { coverage: [], ambiguous: [], error: null },
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
  it('normalizes grid coordinates from the model length units to inches', () => {
    const feet = parseGridLines('UNITS "KIP" "FT" "F"\nGRID "G1" LABEL "A" DIR "X" COORD 20');
    const metres = parseGridLines('UNITS "KN" "M" "C"\nGRID "G1" LABEL "1" DIR "Y" COORD 2.54');
    expect(feet[0].coordinate).toBe(240);
    expect(metres[0].coordinate).toBeCloseTo(100);
  });

  it('uses the full beam and column grid references from the model', () => {
    const r = result();
    expect(memberGridLocation('B2@Story1', r, grids)).toBe('grids A–B, line 2');
    const column = {
      ...r,
      members: [{ ...r.members[0], id: 'C1@Story1', kind: 'column' as const, label: 'C1',
        end_nodes: ['N(0,0,144)', 'N(0,0,288)'] as [string, string] }],
      nodes: [...r.nodes, { id: 'N(0,0,144)', xyz: [0, 0, 144] as [number, number, number], side: 'both' as const },
        { id: 'N(0,0,288)', xyz: [0, 0, 288] as [number, number, number], side: 'both' as const }],
    };
    expect(memberGridLocation('C1@Story1', column, grids)).toBe('grid A/1');
    expect(groupedChangeNotes(r, grids)[1]).toContain('B2 (grids A–B, line 2)');
  });

  it('appends a comparison after existing content and replaces only its tracked rows', () => {
    const first = result('Hack_v01.e2k', 'Hack_v01a.e2k');
    const firstUpdate = updateWorkbook(template(), first, grids, {}, 'append');
    expect(firstUpdate.block.startRow).toBe(27);

    const second = result('Hack_v01a.e2k', 'Hack_v02.e2k');
    const secondUpdate = updateWorkbook(
      firstUpdate.bytes, second, grids, firstUpdate.history, 'append',
    );
    expect(secondUpdate.block.startRow).toBe(37);

    const replaced = result('Hack_v01.e2k', 'Hack_v01a.e2k');
    replaced.changes[0].after = { section: 'W14X90' };
    const replaceUpdate = updateWorkbook(
      secondUpdate.bytes, replaced, grids, secondUpdate.history, 'replace',
    );
    const sheet = strFromU8(unzipSync(replaceUpdate.bytes)['xl/worksheets/sheet1.xml']);
    expect(cell(sheet, 'D26')).toBe('Existing information');
    expect(cell(sheet, 'A27')).toBe('v01a');
    expect(cell(sheet, 'A37')).toBe('v02');
    expect(cell(sheet, 'D28')).toContain('grids A–B, line 2');
    expect(cell(sheet, 'D37')).toContain('W12X58');
    expect(versionName('Hack_v01a.e2k')).toBe('v01a');
    expect(comparisonKey(first)).toContain('hack_v01.e2k');
  });

  it('refuses to append to a workbook missing a previously tracked comparison', () => {
    const first = result('Hack_v01.e2k', 'Hack_v01a.e2k');
    const firstUpdate = updateWorkbook(template(), first, grids, {}, 'append');
    expect(() => updateWorkbook(
      template(), result('Hack_v01a.e2k', 'Hack_v02.e2k'), grids, firstUpdate.history, 'append',
    )).toThrow('Choose the latest register');
  });
});
