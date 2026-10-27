import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describeChange } from './data';
import type { Change, Member, Result, Vec3 } from './vantageTypes';

const SHEET = 'xl/worksheets/sheet1.xml';
const SHARED_STRINGS = 'xl/sharedStrings.xml';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const FIRST_LOG_ROW = 27;
const HEADER_STYLE_ROW = 43;
const COMMENT_STYLE_ROW = 44;
const COMMENT_ROWS = 9;
const HISTORY_KEY = 'vantage.analysis-register.history';

const BUCKETS: { title: string; groups: string[] }[] = [
  { title: 'Geometry and member changes', groups: ['G1'] },
  { title: 'Section assignments', groups: ['1A'] },
  { title: 'Section definitions', groups: ['1B'] },
  { title: 'Materials', groups: ['1C'] },
  { title: 'Member properties and releases', groups: ['1D', '1E'] },
  { title: 'Supports and springs', groups: ['2A'] },
  { title: 'Applied loads', groups: ['2B'] },
  { title: 'Load definitions and mass source', groups: ['T3'] },
  { title: 'Other model changes', groups: ['ST', 'LO'] },
];

export interface GridLine {
  label: string;
  direction: 'X' | 'Y';
  coordinate: number;
}

export interface LogBlock {
  startRow: number;
  version: string;
  summary: string;
  notes: string[];
  date: string;
}

export type RegisterHistory = Record<string, LogBlock[]>;
export type DuplicateAction = 'replace' | 'new';

export function versionName(file: string): string {
  const basename = file.replace(/\.[^.]+$/, '');
  const match = basename.match(/v\d+[a-z0-9_-]*/i);
  return match?.[0] ?? basename;
}

export function comparisonKey(result: Result): string {
  return `${result.meta.source.baseline}→${result.meta.source.revised}`.toLowerCase();
}

export function parseGridLines(text: string): GridLine[] {
  const lines: GridLine[] = [];
  const pattern = /^\s*GRID\s+"[^"]+"\s+LABEL\s+"([^"]+)"\s+DIR\s+"([XY])"\s+COORD\s+([-+.\deE]+)/i;
  const lengthUnit = text.match(/^\s*UNITS\s+"[^"]+"\s+"([^"]+)"/im)?.[1]?.toUpperCase() ?? 'IN';
  const lengthToIn: Record<string, number> = { IN: 1, FT: 12, M: 1 / 0.0254, CM: 1 / 2.54, MM: 1 / 25.4 };
  const scale = lengthToIn[lengthUnit];
  if (scale === undefined) throw new Error(`Unsupported grid length unit: ${lengthUnit}`);
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (match) lines.push({
      label: match[1], direction: match[2].toUpperCase() as 'X' | 'Y', coordinate: Number(match[3]) * scale,
    });
  }
  return lines;
}

export function memberGridLocation(memberId: string, result: Result, grids: GridLine[]): string | null {
  const member = result.members.find((item) => item.id === memberId);
  if (!member) return null;
  const nodes = new Map(result.nodes.map((node) => [node.id, node.xyz]));
  return locationForMember(member, nodes, grids);
}

function locationForMember(member: Member, nodes: Map<string, Vec3>, grids: GridLine[]): string | null {
  const [i, j] = member.end_nodes.map((id) => nodes.get(id));
  if (!i || !j) return null;

  const xs = grids.filter((line) => line.direction === 'X').sort((a, b) => a.coordinate - b.coordinate);
  const ys = grids.filter((line) => line.direction === 'Y').sort((a, b) => a.coordinate - b.coordinate);
  const near = (value: number, candidates: GridLine[]) => {
    const line = candidates.reduce<GridLine | undefined>((best, item) =>
      !best || Math.abs(item.coordinate - value) < Math.abs(best.coordinate - value) ? item : best, undefined);
    return line && Math.abs(line.coordinate - value) <= 0.5 ? line : undefined;
  };
  const range = (a: GridLine | undefined, b: GridLine | undefined) =>
    a && b ? (a.label === b.label ? a.label : `${a.label}–${b.label}`) : undefined;
  const xI = near(i[0], xs);
  const xJ = near(j[0], xs);
  const yI = near(i[1], ys);
  const yJ = near(j[1], ys);

  if (member.kind === 'column') {
    const x = xI ?? xJ;
    const y = yI ?? yJ;
    return x && y ? `grid ${x.label}/${y.label}` : null;
  }
  if (Math.abs(i[1] - j[1]) <= 0.5) {
    const line = yI ?? yJ;
    const span = range(xI, xJ);
    return line && span ? `grids ${span}, line ${line.label}` : null;
  }
  if (Math.abs(i[0] - j[0]) <= 0.5) {
    const line = xI ?? xJ;
    const span = range(yI, yJ);
    return line && span ? `grid ${line.label}, lines ${span}` : null;
  }
  return xI && yI && xJ && yJ ? `grids ${xI.label}/${yI.label}–${xJ.label}/${yJ.label}` : null;
}

function changeText(
  change: Change, result: Result, grids: GridLine[], members: Map<string, Member>, nodes: Map<string, Vec3>,
): string {
  const description = describeChange(change, result, members);
  const locations = [...new Set(change.member_ids.map((id) => {
    const member = members.get(id);
    if (!member) return null;
    const location = locationForMember(member, nodes, grids);
    return `${member.label ?? member.id}${location ? ` (${location})` : ''}`;
  }).filter((name): name is string => !!name))];
  return locations.length ? `${description} Location: ${locations.join('; ')}.` : description;
}

export function groupedChangeNotes(result: Result, grids: GridLine[]): string[] {
  const members = new Map(result.members.map((member) => [member.id, member]));
  const nodes = new Map(result.nodes.map((node) => [node.id, node.xyz]));
  const buckets = BUCKETS.map((bucket) => {
    const notes = result.changes
      .filter((change) => bucket.groups.includes(change.group))
      .map((change) => changeText(change, result, grids, members, nodes));
    return notes.length ? `${bucket.title}: ${notes.join(' ')}` : '';
  });
  const unassigned = result.changes
    .filter((change) => !BUCKETS.some((bucket) => bucket.groups.includes(change.group)))
    .map((change) => changeText(change, result, grids, members, nodes));
  if (unassigned.length) {
    const additional = `${BUCKETS[buckets.length - 1].title}: ${unassigned.join(' ')}`;
    buckets[buckets.length - 1] = [buckets[buckets.length - 1], additional].filter(Boolean).join(' ');
  }
  return buckets;
}

export function comparisonSummary(result: Result): string {
  const counts = {
    added: result.changes.filter((change) => change.type === 'added').length,
    removed: result.changes.filter((change) => change.type === 'removed').length,
    modified: result.changes.filter((change) => change.type === 'modified').length,
    labelOnly: result.changes.filter((change) => change.type === 'label_only').length,
  };
  return `Comparison ${versionName(result.meta.source.baseline)} to ${versionName(result.meta.source.revised)}: `
    + `${result.changes.length} logged changes (${counts.added} added, ${counts.removed} removed, `
    + `${counts.modified} modified, ${counts.labelOnly} label-only).`;
}

export function readRegisterHistory(): RegisterHistory {
  const serialized = localStorage.getItem(HISTORY_KEY);
  if (!serialized) return {};
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The saved Analysis Register history is invalid. Clear this site’s local storage to start over.');
  }
  for (const [key, blocks] of Object.entries(parsed)) {
    if (!key || !Array.isArray(blocks) || blocks.some((block) => !isLogBlock(block))) {
      throw new Error('The saved Analysis Register history is invalid. Clear this site’s local storage to start over.');
    }
  }
  return parsed as RegisterHistory;
}

export function writeRegisterHistory(history: RegisterHistory): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function isLogBlock(value: unknown): value is LogBlock {
  if (!value || typeof value !== 'object') return false;
  const block = value as Partial<LogBlock>;
  return Number.isInteger(block.startRow) && (block.startRow ?? 0) >= FIRST_LOG_ROW
    && typeof block.version === 'string' && typeof block.summary === 'string' && typeof block.date === 'string'
    && Array.isArray(block.notes) && block.notes.length === COMMENT_ROWS && block.notes.every((note) => typeof note === 'string');
}

export function updateWorkbook(
  input: Uint8Array,
  result: Result,
  grids: GridLine[],
  history: RegisterHistory,
  action: 'append' | DuplicateAction,
): { bytes: Uint8Array; history: RegisterHistory; block: LogBlock } {
  const key = comparisonKey(result);
  const existing = history[key] ?? [];
  const previous = action === 'replace' ? existing[existing.length - 1] : undefined;
  if (action === 'replace' && !previous) throw new Error('No saved entry is available to replace for this model pair.');

  const archive = unzipSync(input);
  if (!archive[SHEET]) throw new Error('This workbook does not contain the expected Analysis Register worksheet.');
  const sheet = parseXml(archive[SHEET]);
  const strings = archive[SHARED_STRINGS] ? parseXml(archive[SHARED_STRINGS]) : undefined;
  const wrapStyles = archive['xl/styles.xml'] ? addWrapStyles(parseXml(archive['xl/styles.xml']), sheet) : null;
  const sheetData = requiredNode(sheet, '/x:worksheet/x:sheetData');
  const version = versionName(result.meta.source.revised);
  const summary = comparisonSummary(result);
  const notes = groupedChangeNotes(result, grids);
  const date = new Date().toISOString().slice(0, 10);
  verifyHistory(sheet, strings, history);

  let startRow: number;
  if (previous) {
    startRow = previous.startRow;
    verifyBlock(sheet, strings, previous);
  } else {
    const trackedEnd = Object.values(history).flat().reduce(
      (max, entry) => Math.max(max, entry.startRow + COMMENT_ROWS),
      FIRST_LOG_ROW - 1,
    );
    startRow = Math.max(lastUsedRow(sheet, strings), trackedEnd) + 1;
    if (startRow < FIRST_LOG_ROW) startRow = FIRST_LOG_ROW;
  }
  const block: LogBlock = { startRow, version, summary, notes, date };
  const header = getRow(sheet, sheetData, startRow, HEADER_STYLE_ROW);
  setCellText(sheet, header, 'A', startRow, version);
  setCellText(sheet, header, 'C', startRow, date);
  setCellText(sheet, header, 'D', startRow, summary);
  if (wrapStyles) cellAt(sheet, header, 'D', startRow).setAttribute('s', String(wrapStyles.header));
  setRowHeight(header, summary, 52);

  for (let index = 0; index < COMMENT_ROWS; index++) {
    const rowNumber = startRow + index + 1;
    const row = getRow(sheet, sheetData, rowNumber, COMMENT_STYLE_ROW);
    const note = notes[index];
    setCellNumber(sheet, row, 'B', rowNumber, note ? index + 1 : null);
    setCellText(sheet, row, 'D', rowNumber, note);
    if (wrapStyles) cellAt(sheet, row, 'D', rowNumber).setAttribute('s', String(wrapStyles.comment));
    setRowHeight(row, note, 52);
  }

  updateDimension(sheet, sheetData);
  archive[SHEET] = strToU8(new XMLSerializer().serializeToString(sheet));
  if (wrapStyles) archive['xl/styles.xml'] = strToU8(new XMLSerializer().serializeToString(wrapStyles.document));
  const bytes = zipSync(archive, { level: 6 });
  const updatedHistory = { ...history, [key]: [...existing] };
  if (previous) updatedHistory[key][updatedHistory[key].length - 1] = block;
  else updatedHistory[key].push(block);
  return { bytes, history: updatedHistory, block };
}

function parseXml(bytes: Uint8Array): XMLDocument {
  const document = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('The selected workbook contains invalid spreadsheet XML.');
  return document;
}

function requiredNode(document: XMLDocument, path: string): Element {
  const node = document.evaluate(path, document, (prefix) => prefix === 'x' ? MAIN_NS : null, XPathResult.FIRST_ORDERED_NODE_TYPE).singleNodeValue;
  if (!(node instanceof Element)) throw new Error('The workbook is missing its worksheet data.');
  return node;
}

function rowAt(document: XMLDocument, rowNumber: number): Element | null {
  return document.evaluate(
    `/x:worksheet/x:sheetData/x:row[@r="${rowNumber}"]`, document,
    (prefix) => prefix === 'x' ? MAIN_NS : null, XPathResult.FIRST_ORDERED_NODE_TYPE,
  ).singleNodeValue as Element | null;
}

function cellAt(document: XMLDocument, row: Element, column: string, rowNumber: number): Element {
  const reference = `${column}${rowNumber}`;
  let cell = [...row.children].find((item) => item.localName === 'c' && item.getAttribute('r') === reference);
  if (!cell) {
    cell = document.createElementNS(MAIN_NS, 'c');
    cell.setAttribute('r', reference);
    const order = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const next = [...row.children].find((item) => item.localName === 'c'
      && order.indexOf(item.getAttribute('r')?.[0] ?? '') > order.indexOf(column));
    row.insertBefore(cell, next ?? null);
  }
  return cell;
}

function clearCell(cell: Element): void {
  cell.removeAttribute('t');
  while (cell.firstChild) cell.removeChild(cell.firstChild);
}

function setCellText(document: XMLDocument, row: Element, column: string, rowNumber: number, value: string): void {
  const cell = cellAt(document, row, column, rowNumber);
  clearCell(cell);
  if (!value) return;
  cell.setAttribute('t', 'inlineStr');
  const inline = document.createElementNS(MAIN_NS, 'is');
  const text = document.createElementNS(MAIN_NS, 't');
  text.textContent = value;
  inline.appendChild(text);
  cell.appendChild(inline);
}

function setCellNumber(document: XMLDocument, row: Element, column: string, rowNumber: number, value: number | null): void {
  const cell = cellAt(document, row, column, rowNumber);
  clearCell(cell);
  if (value === null) return;
  const element = document.createElementNS(MAIN_NS, 'v');
  element.textContent = String(value);
  cell.appendChild(element);
}

function getRow(document: XMLDocument, sheetData: Element, rowNumber: number, styleRowNumber: number): Element {
  const existing = rowAt(document, rowNumber);
  if (existing) return existing;
  const styleRow = rowAt(document, styleRowNumber);
  if (!styleRow) throw new Error('The template is missing its formatted version-history rows.');
  const row = styleRow.cloneNode(true) as Element;
  row.setAttribute('r', String(rowNumber));
  for (const cell of [...row.children]) {
    if (cell.localName === 'c') {
      const reference = cell.getAttribute('r') ?? '';
      cell.setAttribute('r', `${reference.replace(/\d+$/, '')}${rowNumber}`);
      clearCell(cell);
    }
  }
  const nextRow = [...sheetData.children].find((item) => item.localName === 'row'
    && Number(item.getAttribute('r')) > rowNumber);
  sheetData.insertBefore(row, nextRow ?? null);
  return row;
}

function valueAt(document: XMLDocument, strings: XMLDocument | undefined, rowNumber: number, column: string): string {
  const row = rowAt(document, rowNumber);
  if (!row) return '';
  const cell = findCell(row, column, rowNumber);
  if (!cell) return '';
  if (cell.getAttribute('t') === 'inlineStr') return descendantText(cell, 't', 'is');
  const value = descendantText(cell, 'v');
  if (cell.getAttribute('t') === 's' && strings) {
    const string = strings.getElementsByTagNameNS(MAIN_NS, 'si')[Number(value)];
    return string?.textContent ?? '';
  }
  return value;
}

function verifyBlock(sheet: XMLDocument, strings: XMLDocument | undefined, block: LogBlock): void {
  if (valueAt(sheet, strings, block.startRow, 'A') !== block.version
    || valueAt(sheet, strings, block.startRow, 'C') !== block.date
    || valueAt(sheet, strings, block.startRow, 'D') !== block.summary) {
    throw new Error('The selected workbook does not contain the saved comparison entry. Choose the latest register or log a new entry.');
  }
  for (let index = 0; index < COMMENT_ROWS; index++) {
    const row = block.startRow + index + 1;
    if (valueAt(sheet, strings, row, 'D') !== block.notes[index]
      || valueAt(sheet, strings, row, 'B') !== (block.notes[index] ? String(index + 1) : '')) {
      throw new Error('The saved comparison rows were changed or moved in this workbook. Choose the latest register or log a new entry.');
    }
  }
}

function verifyHistory(sheet: XMLDocument, strings: XMLDocument | undefined, history: RegisterHistory): void {
  for (const block of Object.values(history).flat()) {
    if (valueAt(sheet, strings, block.startRow, 'A') !== block.version
      || valueAt(sheet, strings, block.startRow, 'C') !== block.date) {
      throw new Error('The selected workbook is missing a saved comparison entry. Choose the latest register before appending.');
    }
  }
}

function cellValue(document: XMLDocument, strings: XMLDocument | undefined, row: Element, column: string): string {
  const rowNumber = Number(row.getAttribute('r'));
  const cell = findCell(row, column, rowNumber);
  if (!cell) return '';
  if (cell.getAttribute('t') === 'inlineStr') return descendantText(cell, 't', 'is');
  const value = descendantText(cell, 'v');
  if (cell.getAttribute('t') === 's' && strings) {
    return strings.getElementsByTagNameNS(MAIN_NS, 'si')[Number(value)]?.textContent ?? '';
  }
  return value;
}

function findCell(row: Element, column: string, rowNumber: number): Element | null {
  const reference = `${column}${rowNumber}`;
  return [...row.children].find((item) => item.localName === 'c' && item.getAttribute('r') === reference) ?? null;
}

function descendantText(element: Element, name: string, parentName?: string): string {
  const parent = parentName
    ? element.getElementsByTagNameNS(MAIN_NS, parentName)[0]
    : element;
  return parent?.getElementsByTagNameNS(MAIN_NS, name)[0]?.textContent ?? '';
}

function lastUsedRow(sheet: XMLDocument, strings: XMLDocument | undefined): number {
  const rows = [...sheet.getElementsByTagNameNS(MAIN_NS, 'row')];
  const used = rows.filter((row) => Number(row.getAttribute('r')) >= FIRST_LOG_ROW
    && ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].some((column) => cellValue(sheet, strings, row, column) !== ''));
  return used.reduce((max, row) => Math.max(max, Number(row.getAttribute('r'))), FIRST_LOG_ROW - 1);
}

function updateDimension(sheet: XMLDocument, sheetData: Element): void {
  const dimension = sheet.getElementsByTagNameNS(MAIN_NS, 'dimension')[0];
  const old = dimension?.getAttribute('ref') ?? 'A1:H1';
  const start = old.split(':')[0];
  const maxRow = [...sheetData.children].reduce((max, row) =>
    Math.max(max, Number(row.getAttribute('r')) || 0), 1);
  dimension?.setAttribute('ref', `${start}:H${maxRow}`);
}

function addWrapStyles(styles: XMLDocument, sheet: XMLDocument): { document: XMLDocument; header: number; comment: number } {
  const cellXfs = styles.getElementsByTagNameNS(MAIN_NS, 'cellXfs')[0];
  if (!cellXfs) throw new Error('The workbook is missing its cell formatting styles.');
  const headerStyle = styleId(sheet, HEADER_STYLE_ROW, 'D');
  const commentStyle = styleId(sheet, COMMENT_STYLE_ROW, 'D');
  const cloneWrappedStyle = (baseId: number) => {
    const base = cellXfs.getElementsByTagNameNS(MAIN_NS, 'xf')[baseId];
    if (!base) throw new Error('The workbook is missing formatting for its version-history rows.');
    const wrapped = base.cloneNode(true) as Element;
    wrapped.setAttribute('applyAlignment', '1');
    let alignment = wrapped.getElementsByTagNameNS(MAIN_NS, 'alignment')[0];
    if (!alignment) {
      alignment = styles.createElementNS(MAIN_NS, 'alignment');
      wrapped.appendChild(alignment);
    }
    alignment.setAttribute('wrapText', '1');
    alignment.setAttribute('vertical', 'top');
    const id = cellXfs.getElementsByTagNameNS(MAIN_NS, 'xf').length;
    cellXfs.appendChild(wrapped);
    return id;
  };
  const header = cloneWrappedStyle(headerStyle);
  const comment = cloneWrappedStyle(commentStyle);
  cellXfs.setAttribute('count', String(cellXfs.getElementsByTagNameNS(MAIN_NS, 'xf').length));
  return { document: styles, header, comment };
}

function styleId(sheet: XMLDocument, rowNumber: number, column: string): number {
  const row = rowAt(sheet, rowNumber);
  const cell = row && findCell(row, column, rowNumber);
  const style = cell?.getAttribute('s');
  if (style === null || style === undefined || !/^\d+$/.test(style)) {
    throw new Error('The workbook is missing the expected cell styles for its version-history rows.');
  }
  return Number(style);
}

function setRowHeight(row: Element, text: string, charsPerLine: number): void {
  const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
  row.setAttribute('ht', String(lines * 16));
  row.setAttribute('customHeight', '1');
}
