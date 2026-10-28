// Applied loads for the 3D view: pick -> pattern factors -> factored loads -> arrows. No React, no three.js.
// Loads come straight from the engine (demo_viewer/CONTRACT.md, Applied Loads): raw e2k keys, kip and in.
import type { AppliedLoad, ElementLoads, LoadDefinitions } from '../demo_viewer/contract';
import type { Vec3 } from './keeptabsTypes';

export type { AppliedLoad, ElementLoads, LoadDefinitions };

/** An element that carries a load in either model. Frames: geometry is [I, J]. */
export interface LoadedElement {
  key: string;
  kind: 'point' | 'frame' | 'area';
  subtype: string;
  label: string;
  story: string;
  geometry: Vec3[];
  loads: ElementLoads;
}

export interface ModelLoads {
  elements: LoadedElement[];
  definitions: { a: LoadDefinitions; b: LoadDefinitions } | null; // null: a 0.1 diff, patterns only
}

export type LoadSide = 'a' | 'b';
export interface LoadPick { kind: 'pattern' | 'case' | 'combo'; name: string }

// ---------- factoring ----------

/** Load pattern factors for a pick in one model, or why it can't be drawn there. */
export function pickFactors(defs: LoadDefinitions | undefined, pick: LoadPick): { factors: Record<string, number> } | { reason: string } {
  if (pick.kind === 'pattern') {
    // No definitions (0.1 diff): a pattern name that appears on loads still draws.
    if (defs && !defs.patterns[pick.name]) return { reason: `Pattern ${pick.name} is not in this model.` };
    return { factors: { [pick.name]: 1 } };
  }
  const entry = pick.kind === 'case' ? defs?.cases[pick.name] : defs?.combos[pick.name];
  if (!entry) return { reason: `${pick.kind === 'case' ? 'Case' : 'Combo'} ${pick.name} is not in this model.` };
  if (!entry.effective.expandable) return { reason: entry.effective.reason ?? `${pick.name} can't be expanded to load patterns.` };
  return { factors: entry.effective.patterns };
}

const VALUE_KEYS = ['FVAL', 'FSTART', 'FEND', 'FX', 'FY', 'FZ', 'MX', 'MY', 'MZ'];
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Everything on a load except its values: two loads with the same signature add up. */
function signature(l: AppliedLoad): string {
  const rest = Object.entries(l).filter(([k]) => !VALUE_KEYS.includes(k)).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(rest.map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]));
}

/**
 * Each pattern's loads times its factor, summed: loads of the same type, direction and position become
 * one load, anything else stays separate. A pattern the element doesn't carry adds nothing.
 */
export function factoredLoads(byPattern: Record<string, AppliedLoad[]>, factors: Record<string, number>): AppliedLoad[] {
  const out = new Map<string, AppliedLoad>();
  for (const [pattern, f] of Object.entries(factors)) {
    for (const l of byPattern[pattern] ?? []) {
      const sig = signature(l);
      const prev = out.get(sig);
      const next: AppliedLoad = { ...(prev ?? l) };
      for (const k of VALUE_KEYS) {
        if (typeof l[k] === 'number') next[k] = ((prev?.[k] as number | undefined) ?? 0) + (l[k] as number) * f;
      }
      out.set(sig, next);
    }
  }
  return [...out.values()];
}

const canonical = (ls: AppliedLoad[]) =>
  ls.map((l) => JSON.stringify(Object.entries(l).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))).sort();

export function sameLoads(x: AppliedLoad[], y: AppliedLoad[]): boolean {
  const a = canonical(x);
  const b = canonical(y);
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** Factored loads of a pick on one side; [] when the pick can't be drawn there. */
export function loadsFor(el: LoadedElement, side: LoadSide, pick: LoadPick, defs: ModelLoads['definitions']): AppliedLoad[] {
  const f = pickFactors(defs?.[side], pick);
  return 'factors' in f ? factoredLoads(el.loads[side], f.factors) : [];
}

/**
 * Changed: what the pick puts on this element differs between the two models, whether from a load's
 * value, position or presence, or from the case / combo factors themselves.
 */
export const loadChanged = (el: LoadedElement, pick: LoadPick, defs: ModelLoads['definitions']) =>
  !sameLoads(loadsFor(el, 'a', pick, defs), loadsFor(el, 'b', pick, defs));

// ---------- directions ----------

const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const add = (p: Vec3, q: Vec3): Vec3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const mul = (p: Vec3, s: number): Vec3 => [p[0] * s, p[1] * s, p[2] * s];
const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const norm = (p: Vec3) => Math.hypot(...p);
const unit = (p: Vec3): Vec3 => mul(p, 1 / (norm(p) || 1));
const lerp = (p: Vec3, q: Vec3, t: number) => add(p, mul(sub(q, p), t));
const Z: Vec3 = [0, 0, 1];

/**
 * ETABS default frame local axes: 1 from I to J; 2 in the vertical plane through 1, pointing up
 * (global +X for a vertical member); 3 = 1 x 2.
 * ponytail: default axes only, the diff carries no local axis angle (ANG); rotate 2 and 3 about 1 once it does.
 */
export function frameAxes(i: Vec3, j: Vec3): [Vec3, Vec3, Vec3] {
  const a1 = unit(sub(j, i));
  const a2 = Math.abs(dot(a1, Z)) > 0.999 ? [1, 0, 0] as Vec3 : unit(sub(Z, mul(a1, dot(Z, a1))));
  return [a1, a2, cross(a1, a2)];
}

/** Area local axes: 3 normal to the area (up for a floor), 1 horizontal in the plane, 2 = 3 x 1. */
export function areaAxes(corners: Vec3[]): [Vec3, Vec3, Vec3] {
  let n: Vec3 = [0, 0, 0]; // Newell's method, fine for any planar polygon
  corners.forEach((p, k) => (n = add(n, cross(p, corners[(k + 1) % corners.length]))));
  let a3 = unit(n);
  if (a3[2] < -1e-9) a3 = mul(a3, -1);
  const a1 = Math.abs(a3[2]) > 0.999 ? [1, 0, 0] as Vec3 : unit(cross(Z, a3));
  return [a1, cross(a3, a1), a3];
}

/** Unit vector for an e2k DIR, and whether it is a local axis. null: a direction this view doesn't draw. */
export function direction(dir: string | undefined, axes: [Vec3, Vec3, Vec3]): { v: Vec3; local: boolean } | null {
  const d = (dir ?? '').toUpperCase().replace(/PROJ$/, ''); // projected loads drawn along their axis
  if (d === 'GRAV') return { v: [0, 0, -1], local: false };
  const g = ['X', 'Y', 'Z'].indexOf(d);
  if (g >= 0) return { v: [0, 0, 0].map((_, k) => (k === g ? 1 : 0)) as Vec3, local: false };
  const l = ['1', '2', '3'].indexOf(d);
  if (l >= 0) return { v: axes[l], local: true };
  return null;
}

// ---------- glyphs: loads as arrows, before scaling ----------

/** Scaling class: arrows of one class are scaled together, since kip, kip/in and kip/in² don't compare. */
export type LoadClass = 'force' | 'line' | 'area';

/** One arrow: its head touches the element at `at`, pointing along `dir` times the sign of `value`. */
export interface Arrow { at: Vec3; dir: Vec3; value: number }

/** A load drawn as arrows. `tails`: join the arrow tails (open for a line load, closed loop for an area). */
export interface Glyph { cls: LoadClass; local: boolean; arrows: Arrow[]; tails: 'none' | 'open' | 'closed'; barb: Vec3 }

const num = (x: unknown) => (typeof x === 'number' ? x : undefined);
const STATIONS = 10; // arrows along a full-length line load

/** Arrows for one element's loads. Moments are not drawn (listed in the details panel). */
export function loadGlyphs(el: Pick<LoadedElement, 'kind' | 'geometry'>, loads: AppliedLoad[]): Glyph[] {
  const g = el.geometry;
  const out: Glyph[] = [];
  if (el.kind === 'frame' && g.length === 2) {
    const axes = frameAxes(g[0], g[1]);
    const len = norm(sub(g[1], g[0]));
    const at = (d: number) => lerp(g[0], g[1], len ? d / len : 0);
    for (const l of loads) {
      const d = direction(l.DIR, axes);
      if (!d) continue;
      if (l.TYPE === 'POINTF') {
        const x = num(l.DIST) ?? (num(l.RDIST) ?? 0) * len;
        out.push({ cls: 'force', local: d.local, arrows: [{ at: at(x), dir: d.v, value: num(l.FVAL) ?? 0 }], tails: 'none', barb: axes[0] });
      } else if (l.TYPE === 'UNIFF' || l.TYPE === 'TRAPF') {
        const x0 = num(l.DSTART) ?? (num(l.RDSTART) ?? 0) * len;
        const x1 = num(l.DEND) ?? (num(l.RDEND) ?? 1) * len;
        const v0 = l.TYPE === 'UNIFF' ? num(l.FVAL) ?? 0 : num(l.FSTART) ?? 0;
        const v1 = l.TYPE === 'UNIFF' ? v0 : num(l.FEND) ?? 0;
        const n = Math.max(2, Math.ceil(STATIONS * Math.abs(x1 - x0) / (len || 1)) + 1);
        const arrows = Array.from({ length: n }, (_, k) => {
          const t = k / (n - 1);
          return { at: at(x0 + (x1 - x0) * t), dir: d.v, value: v0 + (v1 - v0) * t };
        });
        out.push({ cls: 'line', local: d.local, arrows, tails: 'open', barb: axes[0] });
      }
    }
  } else if (el.kind === 'point' && g.length >= 1) {
    for (const l of loads) {
      const f: Vec3 = [num(l.FX) ?? 0, num(l.FY) ?? 0, num(l.FZ) ?? 0]; // joint loads are global
      const m = norm(f);
      if (m > 1e-12) out.push({ cls: 'force', local: false, arrows: [{ at: g[0], dir: unit(f), value: m }], tails: 'none', barb: [1, 0, 0] });
    }
  } else if (el.kind === 'area' && g.length >= 3) {
    const axes = areaAxes(g);
    const c = mul(g.reduce(add, [0, 0, 0]), 1 / g.length);
    // A sparse grid: centre, plus points most of the way to each corner and each edge midpoint.
    const ring = g.flatMap((p, k) => [p, lerp(p, g[(k + 1) % g.length], 0.5)]).map((p) => lerp(c, p, 0.75));
    for (const l of loads) {
      const d = direction(l.DIR, axes);
      const v = num(l.FVAL);
      if (!d || v === undefined) continue; // e.g. a load set the file doesn't define
      out.push({ cls: 'area', local: d.local, arrows: [...ring, c].map((at) => ({ at, dir: d.v, value: v })), tails: 'closed', barb: axes[0] });
    }
  }
  return out;
}

/** Largest |value| per class, so the largest load in view gets the full arrow length. */
export function maxByClass(glyphs: Glyph[]): Record<LoadClass, number> {
  const max: Record<LoadClass, number> = { force: 0, line: 0, area: 0 };
  for (const gl of glyphs) for (const a of gl.arrows) max[gl.cls] = Math.max(max[gl.cls], Math.abs(a.value));
  return max;
}

export type Seg = [Vec3, Vec3];

/**
 * Arrow length for each class's largest value, relative to the base length. A point load is one lone
 * arrow beside rows of distributed-load arrows, so it gets more length to read at the same scale.
 */
export const CLASS_LENGTH: Record<LoadClass, number> = { force: 2, line: 1, area: 1 };

/**
 * Line segments for a glyph. `length` times CLASS_LENGTH is the arrow length for the class's largest
 * value; each arrow is scaled to its own value. Heads sit on the element, tails away from it, like a load diagram.
 */
export function glyphSegments(gl: Glyph, max: Record<LoadClass, number>, length: number): Seg[] {
  const segs: Seg[] = [];
  const tails: Vec3[] = [];
  length *= CLASS_LENGTH[gl.cls];
  const head = length * 0.12;
  for (const a of gl.arrows) {
    const L = max[gl.cls] ? (Math.abs(a.value) / max[gl.cls]) * length : 0;
    const f = mul(a.dir, Math.sign(a.value) || 1); // force direction
    const tail = sub(a.at, mul(f, L));
    tails.push(tail);
    if (L < 1e-9) continue;
    segs.push([tail, a.at]);
    // Barbs in the plane of the force and the element, so a row of arrows reads as a diagram.
    let side = sub(gl.barb, mul(f, dot(gl.barb, f)));
    if (norm(side) < 1e-6) side = sub([1, 0, 0], mul(f, f[0]));
    if (norm(side) < 1e-6) side = sub([0, 1, 0], mul(f, f[1]));
    side = unit(side);
    const h = Math.min(head, L * 0.4);
    const back = sub(a.at, mul(f, h));
    segs.push([a.at, add(back, mul(side, h * 0.5))], [a.at, sub(back, mul(side, h * 0.5))]);
  }
  if (gl.tails !== 'none') {
    // Area grid: the outer ring joins up, the centre arrow (last) stands alone.
    const ring = gl.tails === 'closed' ? tails.slice(0, -1) : tails;
    for (let k = 0; k + 1 < ring.length; k++) segs.push([ring[k], ring[k + 1]]);
    if (gl.tails === 'closed' && ring.length > 2) segs.push([ring[ring.length - 1], ring[0]]);
  }
  return segs;
}

// ---------- text ----------

const n4 = (x: unknown) => (typeof x === 'number' ? String(Number(x.toPrecision(4))) : '?');

// The engine writes kip and in. For reading, line loads show in kip/ft, area loads in psf and moments in
// kip-ft; positions stay in inches, or a fraction of the length (L) when the record has only that.
const scaled = (x: unknown, k: number) => (typeof x === 'number' ? n4(x * k) : '?');
const perFt = (x: unknown) => `${scaled(x, 12)} kip/ft`;
const psf = (x: unknown) => `${scaled(x, 144000)} psf`;
const kipFt = (x: unknown) => `${scaled(x, 1 / 12)} kip-ft`;
const DIRS: Record<string, string> = {
  GRAV: 'gravity', X: 'global X', Y: 'global Y', Z: 'global Z', '1': 'local 1', '2': 'local 2', '3': 'local 3',
};
const dirText = (d: unknown) => (d === undefined ? '' : ` ${DIRS[String(d).toUpperCase()] ?? String(d)}`);
const at = (l: AppliedLoad) => (num(l.DIST) !== undefined ? ` at ${n4(l.DIST)} in` : num(l.RDIST) !== undefined ? ` at ${n4(l.RDIST)} L` : '');
const span = (l: AppliedLoad) => (num(l.DEND) !== undefined ? `, ${n4(l.DSTART ?? 0)} to ${n4(l.DEND)} in`
  : num(l.RDEND) !== undefined ? `, ${n4(l.RDSTART ?? 0)} to ${n4(l.RDEND)} L` : '');

/** One load in words, e.g. {TYPE: 'UNIFF', DIR: 'GRAV', FVAL: 0.0833} on a beam -> "Uniform 1 kip/ft gravity". */
export function describeLoad(l: AppliedLoad, kind: LoadedElement['kind']): string {
  const dir = dirText(l.DIR);
  switch (l.TYPE) {
    case 'POINTF': return `Point ${n4(l.FVAL)} kip${dir}${at(l)}`;
    case 'POINTM': return `Point moment ${kipFt(l.FVAL)}${dir}${at(l)}`;
    case 'UNIFF': return kind === 'area' ? `Uniform ${psf(l.FVAL)}${dir}` : `Uniform ${perFt(l.FVAL)}${dir}${span(l)}`;
    case 'UNIFM': return `Uniform moment ${n4(l.FVAL)} kip-ft/ft${dir}${span(l)}`; // kip-in/in is the same number
    case 'TRAPF': return `Trapezoid ${scaled(l.FSTART, 12)} to ${perFt(l.FEND)}${dir}${span(l)}`;
    case 'TRAPM': return `Trapezoid moment ${n4(l.FSTART)} to ${n4(l.FEND)} kip-ft/ft${dir}${span(l)}`;
    case 'UNIFLOADSET': return `Load set ${l.SET ?? '?'}: ${l.FVAL === undefined ? 'not defined in the file' : `${psf(l.FVAL)}${dir}`}`;
    case 'FORCE': {
      const parts = ['FX', 'FY', 'FZ', 'MX', 'MY', 'MZ'].filter((k) => num(l[k]))
        .map((k) => `${k} ${k[0] === 'F' ? `${n4(l[k])} kip` : kipFt(l[k])}`);
      return `Joint load ${parts.join(', ') || '0'}`;
    }
    default: return `${l.TYPE}${dir} ${JSON.stringify(Object.fromEntries(Object.entries(l).filter(([k]) => k !== 'TYPE' && k !== 'DIR')))}`;
  }
}

/** Change-table label for a load field: "loads:Dead" -> "Dead loads", "load:LIVE.FZ" -> "LIVE joint load FZ", else null. */
export function loadField(field: string): string | null {
  const list = /^loads:(.+)$/i.exec(field);
  if (list) return `${list[1]} loads`;
  const one = /^load:([^.]+)\.(\w+)$/i.exec(field);
  return one ? `${one[1]} joint load ${one[2].toUpperCase()}` : null;
}

const WORDED = new Set(['POINTF', 'POINTM', 'UNIFF', 'UNIFM', 'TRAPF', 'TRAPM', 'UNIFLOADSET', 'FORCE']);

/** Change-table value for a load field, in the same words as the load panel. undefined when it isn't one, or
 *  holds a record type describeLoad has no words for: the caller's raw display (with valueUnits) is clearer. */
export function loadValue(field: string, kind: LoadedElement['kind'], v: unknown): string | undefined {
  if (/^loads:/i.test(field) && Array.isArray(v) && v.every((l) => WORDED.has((l as AppliedLoad | null)?.TYPE ?? ''))) {
    return v.length ? (v as AppliedLoad[]).map((l) => describeLoad(l, kind)).join(' + ') : 'none';
  }
  const one = /^load:[^.]+\.(\w+)$/i.exec(field);
  if (one && typeof v === 'number') return one[1].toUpperCase().startsWith('M') ? kipFt(v) : `${n4(v)} kip`;
  return undefined;
}

/** Every pattern, case and combo name in either model, for the picker. */
export function pickOptions(m: ModelLoads): Record<LoadPick['kind'], string[]> {
  const names = (f: (d: LoadDefinitions) => Record<string, unknown>) =>
    [...new Set(m.definitions ? [...Object.keys(f(m.definitions.a)), ...Object.keys(f(m.definitions.b))] : [])];
  const patterns = m.definitions ? names((d) => d.patterns)
    : [...new Set(m.elements.flatMap((e) => [...Object.keys(e.loads.a), ...Object.keys(e.loads.b)]))];
  return { pattern: patterns, case: names((d) => d.cases), combo: names((d) => d.combos) };
}

/** What the loads control shows: one pick at a scale, each pane drawing its own model. null in the app means loads are off. */
export interface LoadView { pick: LoadPick; scale: number }

/** Why the pick can't be drawn on one model, or null when it can. */
export const pickReason = (m: ModelLoads, side: LoadSide, pick: LoadPick) => {
  const f = pickFactors(m.definitions?.[side], pick);
  return 'reason' in f ? f.reason : null;
};

/** Whether the pick puts any load on any element of one model. */
export const hasLoads = (m: ModelLoads, side: LoadSide, pick: LoadPick) =>
  m.elements.some((el) => loadsFor(el, side, pick, m.definitions).length > 0);

/** Why one model's pane draws nothing for the pick, or null when it draws loads. `file`: that model's file name. */
export function loadNote(m: ModelLoads, side: LoadSide, pick: LoadPick, file: string): string | null {
  const reason = pickReason(m, side, pick);
  if (reason) return `${pick.name} not drawn: ${reason}`;
  return hasLoads(m, side, pick) ? null : `No applied loads in ${file.replace(/\.[^.]+$/, '')} for ${pick.name}`;
}

/** Loads on: the first pattern that loads an element in either model (so not a self-weight-only one). */
export function defaultLoadView(m: ModelLoads): LoadView {
  const patterns = pickOptions(m).pattern;
  const pick = (name: string): LoadPick => ({ kind: 'pattern', name });
  const name = patterns.find((p) => hasLoads(m, 'a', pick(p)) || hasLoads(m, 'b', pick(p))) ?? patterns[0] ?? '';
  return { pick: pick(name), scale: 1 };
}
