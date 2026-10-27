// Pure data helpers: no React, no three.js, so the rules can be unit tested.
import type { Change, Member, Result, Value, Vec3 } from './vantageTypes';

/** Renames and reversed end order are bookkeeping, not physical changes. */
export const isPhysical = (c: Change) => c.type !== 'label_only';

/** Rank by extent only: members affected, then distance moved. Never by structural significance. */
export function byExtent(a: Change, b: Change) {
  return b.extent.members - a.extent.members || b.extent.distance - a.extent.distance || a.id.localeCompare(b.id);
}

export function headlineCounts(r: Result) {
  const n = (t: Change['type']) => r.changes.filter((c) => c.type === t).length;
  return { added: n('added'), removed: n('removed'), modified: n('modified'), label_only: n('label_only') };
}

/** A group is "seen, not compared" when every record type in it was seen but not compared. */
export function groupCoverage(r: Result, groupId: string): 'compared' | 'seen_not_compared' | 'none' {
  const rows = r.warnings.coverage.filter((c) => c.group === groupId);
  if (rows.length === 0) return 'none';
  return rows.every((c) => c.status === 'seen_not_compared') ? 'seen_not_compared' : 'compared';
}

export const memberMap = (r: Result) => new Map(r.members.map((m) => [m.id, m]));

// ---------- viewer rules ----------

export type ViewMode = 'baseline' | 'overlay' | 'revised';
export type ColorBy = 'change' | 'property';
/** How a member is drawn. "previous" / "revised_position" are the two ends of a move. */
export type DrawStyle = 'context' | 'added' | 'removed' | 'previous' | 'revised_position' | 'property';

/** Baseline view hides revised-only elements, revised view hides baseline-only ones. */
export const isVisible = (side: Member['side'], mode: ViewMode) =>
  mode === 'overlay' || side === 'both' || side === mode;

const isMove = (c: Change) => c.type === 'modified' && !!c.after && ('end_i' in c.after || 'end_j' in c.after);

/** Draw style per member. Label-only changes never change how a member is drawn. */
export function memberStyles(r: Result, colorBy: ColorBy): Map<string, DrawStyle> {
  const styles = new Map<string, DrawStyle>();
  for (const c of r.changes.filter(isPhysical)) {
    if (c.type === 'added') c.member_ids.forEach((id) => styles.set(id, 'added'));
    else if (c.type === 'removed') c.member_ids.forEach((id) => styles.set(id, 'removed'));
    else if (isMove(c)) {
      styles.set(c.member_ids[0], 'previous');
      styles.set(c.member_ids[1], 'revised_position');
    } else if (colorBy === 'property') c.member_ids.forEach((id) => styles.set(id, 'property'));
  }
  return styles;
}

/** The change a click on a member selects: a physical change first, else a label-only one. */
export function memberToChange(r: Result): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of [...r.changes].sort((a, b) => Number(isPhysical(a)) - Number(isPhysical(b))))
    c.member_ids.forEach((id) => map.set(id, c.id)); // physical ones are written last, so they win
  return map;
}

/** Moved endpoints: old and new position of each moved end, for the connecting arrow. */
export function moves(r: Result): { change: string; from: Vec3; to: Vec3 }[] {
  return r.changes.filter(isMove).flatMap((c) =>
    ['end_i', 'end_j'].filter((k) => k in c.after!).map((k) => ({
      change: c.id, from: c.before![k] as Vec3, to: c.after![k] as Vec3,
    })),
  );
}

/** Number of physical changes touching each story, for the story strip shading. */
export function storyChangeCounts(r: Result): Record<string, number> {
  const members = memberMap(r);
  const counts: Record<string, number> = {};
  for (const c of r.changes.filter(isPhysical)) {
    const stories = new Set(c.member_ids.map((id) => members.get(id)?.story).filter(Boolean) as string[]);
    stories.forEach((s) => (counts[s] = (counts[s] ?? 0) + 1));
  }
  return counts;
}

// ---------- formatting ----------

export function unitFor(c: Change, field: string, r: Result) {
  const u = c.units?.[field];
  return u === 'length' ? r.meta.units.length : u ?? '';
}

/** One decimal for round numbers (840.0); full precision otherwise, so 0.349 never shows as 0.3. */
const num = (n: number) => (Number.isInteger(n * 10) ? n.toFixed(1) : String(n));

export function fmt(v: Value | undefined, unit = '') {
  if (v === null || v === undefined) return '—';
  if (v === '') return '(none)';
  const s = Array.isArray(v) ? `(${v.map(num).join(', ')})` : typeof v === 'number' ? num(v) : v;
  return unit ? `${s} ${unit}` : s;
}

const KIND = { beam: 'Beam', column: 'Column', brace: 'Brace' } as const;

export const memberName = (m?: Member) => (m ? `${KIND[m.kind]} ${m.label ?? m.id} at ${m.story}` : 'Unknown member');

/** One plain-language sentence per change, from fixed templates. No severity words. */
export function describeChange(c: Change, r: Result, members = memberMap(r)): string {
  const m = members.get(c.member_ids[0]);
  const b = c.before ?? {};
  const a = c.after ?? {};
  const lu = r.meta.units.length;

  if (c.type === 'added' && 'story' in a)
    return `A new level, ${a.story}, was added at elevation ${fmt(a.elevation, lu)} with ${c.extent.members} members.`;
  if (c.type === 'added') return `${c.subject ?? memberName(m)} was added.`;
  if (c.type === 'removed') return `${c.subject ?? memberName(m)} was removed.`;
  if (c.type === 'label_only' && 'label' in a)
    return `${m ? KIND[m.kind] : 'Member'} at ${m?.story ?? '?'} was renamed from ${b.label} to ${a.label}. Label only, not a physical change.`;
  if (c.type === 'label_only')
    return `${memberName(m)} lists its end nodes in reverse order in the revised file. Same member, not a physical change.`;

  const ends = ['end_i', 'end_j'].filter((k) => k in a);
  if (ends.length) {
    const lift = typeof a.story_shift === 'number' ? a.story_shift : 0;
    const where = ends.length === 1 ? `one endpoint moved from ${fmt(b[ends[0]])} to ${fmt(a[ends[0]])}` : 'both endpoints moved';
    return lift
      ? `${memberName(m)} had ${where}, a shift of ${fmt(c.extent.distance, lu)} relative to its story. The story itself also moved ${fmt(lift, lu)}, reported separately.`
      : `${memberName(m)} had ${where}, a shift of ${fmt(c.extent.distance, lu)}.`;
  }
  if ('section' in a) return `${memberName(m)} was reassigned from section ${b.section} to ${a.section}.`;

  const parts = [...new Set([...Object.keys(b), ...Object.keys(a)])].map((k) => `${k} changed from ${fmt(b[k], unitFor(c, k, r))} to ${fmt(a[k], unitFor(c, k, r))}`);
  // "N members use it" only for definitions (materials, sections), which carry a subject.
  const users = c.subject && c.extent.members ? ` ${c.extent.members} member${c.extent.members === 1 ? ' uses' : 's use'} it.` : '';
  return `${c.subject ?? memberName(m)}: ${parts.join('; ')}.${users}`;
}

// ---------- load + selection state ----------

export type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; result: Result }
  | { status: 'error'; message: string };

export interface AppState { load: LoadState; selectedChangeId: string | null }

export type Action =
  | { type: 'load_start' }
  | { type: 'load_ok'; result: Result }
  | { type: 'load_fail'; message: string }
  | { type: 'select'; id: string | null };

/** Every load transition drops the previous result and selection, so nothing stale stays on screen. */
export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'load_start':
      return { load: { status: 'loading' }, selectedChangeId: null };
    case 'load_ok':
      return { load: { status: 'ready', result: action.result }, selectedChangeId: null };
    case 'load_fail':
      return { load: { status: 'error', message: action.message }, selectedChangeId: null };
    case 'select':
      return { ...state, selectedChangeId: action.id };
  }
}
