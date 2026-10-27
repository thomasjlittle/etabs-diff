// Vantage result schema (UI-only, "vantage-0.1"). Separate from types.ts, which mirrors backend schema.py.
// an adapter from engine output to this shape comes later. All mock data is synthetic.

export type Vec3 = [number, number, number];

/** Which file an element appears in. "both" = present and identical in baseline and revised. */
export type Side = 'baseline' | 'revised' | 'both';

export interface Meta {
  schema_version: string;
  source: { baseline: string; revised: string };
  units: { length: string; force: string };
  coordinate_system: { axes: string; aligned: boolean; offset: Vec3 };
  match_tolerance: number; // in length units
  mock: boolean;
}

export interface Story { name: string; elevation: number; side: Side }

export interface Node { id: string; xyz: Vec3; side: Side }

export interface Member {
  id: string;                    // geometry-based: canonical end coordinates, never the label
  kind: 'beam' | 'column' | 'brace';
  end_nodes: [string, string];   // canonical order, so a reversed listing gives the same id
  label?: string;                // display only (revised label when present)
  story: string;
  side: Side;
}

export type ChangeType = 'added' | 'removed' | 'modified' | 'label_only';
export type Value = number | string | number[] | null;

export interface Evidence {
  file: 'baseline' | 'revised';
  lines: [number, number];       // first and last line, 1-based
  raw: string[];
}

export interface Change {
  id: string;
  type: ChangeType;
  group: string;                 // Group.id
  category?: string;             // left-panel category id (categories.ts); derived from group when absent
  member_ids: string[];          // for a move: [baseline member, revised member]
  subject?: string;              // for non-member records, e.g. "Material STEEL-COL"
  extent: { members: number; distance: number };
  before: Record<string, Value> | null;
  after: Record<string, Value> | null;
  units?: Record<string, string>; // per field; "length" means meta.units.length
  evidence: Evidence[];
}

export interface Group { id: string; title: string; change_ids: string[] }

export interface Coverage { group: string; record: string; status: 'compared' | 'seen_not_compared' }

export interface Ambiguous { id: string; description: string; candidates: string[] }

export interface Result {
  mock: boolean;
  meta: Meta;
  stories: Story[];
  nodes: Node[];
  members: Member[];
  changes: Change[];
  groups: Group[];
  warnings: { coverage: Coverage[]; ambiguous: Ambiguous[]; error: string | null };
}
