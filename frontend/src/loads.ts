// Plain-language text for engine load records, e.g. {TYPE: 'UNIFF', DIR: 'GRAV', FVAL: 0.0833} on a beam
// -> "Uniform load 1.0 kip/ft, gravity". The engine stores kip and inch; for reading, line loads show in
// kip/ft, area loads in psf and moments in kip-ft. Other units show as stored. A record type not listed
// here is left to the caller's raw display, never guessed.
import type { Value } from './vantageTypes';

export interface LoadUnits { length: string; force: string }
type Rec = Record<string, unknown>;

const DIR: Record<string, string> = {
  GRAV: 'gravity', X: 'global X', Y: 'global Y', Z: 'global Z', '1': 'local 1', '2': 'local 2', '3': 'local 3',
};
const dir = (d: unknown) => DIR[String(d).toUpperCase()] ?? String(d);

/** 4 significant figures, at least one decimal (1.0, 50.0, 0.4), like the rest of the app. */
const num = (n: number) => {
  const r = Number(n.toPrecision(4));
  return Number.isInteger(r) ? r.toFixed(1) : String(r);
};

const isKipInch = (u: LoadUnits) => u.length === 'in' && u.force === 'kip';
const lineLoad = (v: number, u: LoadUnits) => (isKipInch(u) ? `${num(v * 12)} kip/ft` : `${num(v)} ${u.force}/${u.length}`);
const areaLoad = (v: number, u: LoadUnits) => (isKipInch(u) ? `${num(v * 144000)} psf` : `${num(v)} ${u.force}/${u.length}²`);
const force = (v: number, u: LoadUnits) => `${num(v)} ${u.force}`;
const moment = (v: number, u: LoadUnits) => (isKipInch(u) ? `${num(v / 12)} kip-ft` : `${num(v)} ${u.force}-${u.length}`);
const component = (k: string, v: number, u: LoadUnits) => `${k} ${k.startsWith('M') ? moment(v, u) : force(v, u)}`;

/** One record, or null if its type is not one we know. */
function describeRecord(kind: string, r: Rec, u: LoadUnits): string | null {
  const type = String(r.TYPE ?? '').toUpperCase();
  const f = typeof r.FVAL === 'number' ? r.FVAL : null;
  if (kind === 'frame' && type === 'UNIFF' && f !== null) return `Uniform load ${lineLoad(f, u)}, ${dir(r.DIR)}`;
  if (kind === 'frame' && type === 'POINTF' && f !== null) {
    const at = typeof r.RDIST === 'number' ? `, at ${num(r.RDIST)} L` : typeof r.DIST === 'number' ? `, at ${num(r.DIST)} ${u.length}` : '';
    return `Point load ${force(f, u)}, ${dir(r.DIR)}${at}`;
  }
  if (kind === 'area' && type === 'UNIFF' && f !== null) return `Area load ${areaLoad(f, u)}, ${dir(r.DIR)}`;
  if (kind === 'point' && type === 'FORCE') {
    const parts = ['FX', 'FY', 'FZ', 'MX', 'MY', 'MZ']
      .filter((k) => typeof r[k] === 'number' && r[k] !== 0)
      .map((k) => component(k, r[k] as number, u));
    return `Joint load ${parts.length ? parts.join(', ') : '0'}`;
  }
  return null;
}

/** "loads:Dead" -> "Dead loads"; "load:LIVE.FZ" -> "LIVE joint load FZ"; anything else -> null. */
export function loadField(field: string): string | null {
  const list = /^loads:(.+)$/i.exec(field);
  if (list) return `${list[1]} loads`;
  const one = /^load:([^.]+)\.(\w+)$/i.exec(field);
  if (one) return `${one[1]} joint load ${one[2].toUpperCase()}`;
  return null;
}

/** Readable value for a load field, or undefined to fall back on the raw display. */
export function loadValue(field: string, kind: string, v: unknown, u: LoadUnits): Value | undefined {
  if (/^loads:/i.test(field) && Array.isArray(v)) {
    if (v.length === 0) return 'none';
    const parts = v.map((r) => (r && typeof r === 'object' ? describeRecord(kind, r as Rec, u) : null));
    return parts.every((p) => p !== null) ? parts.join(' + ') : undefined;
  }
  const one = /^load:[^.]+\.(\w+)$/i.exec(field);
  if (one && typeof v === 'number') return component(one[1].toUpperCase(), v, u).replace(/^\w+ /, '');
  return undefined;
}
