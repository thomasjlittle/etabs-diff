// keepTABS result schema (UI-only). engineAdapter.ts builds it from the engine's output (demo_viewer/contract.ts).
import type { ModelLoads } from './loads';

export type Vec3 = [number, number, number];

/** Which file an element appears in. "both" = present and identical in baseline and revised. */
export type Side = 'baseline' | 'revised' | 'both';

export interface Meta {
  source: { baseline: string; revised: string };
  units: { length: string; force: string };
}

export interface Story { name: string; elevation: number; side: Side }

export interface Node { id: string; xyz: Vec3; side: Side }

export interface Member {
  id: string;                    // geometry-based: canonical end coordinates, never the label
  kind: 'beam' | 'column' | 'brace';
  end_nodes: [string, string];   // canonical order, so a reversed listing gives the same id
  label?: string;                // display only (revised label when present)
  story: string;
  grid?: string;
  side: Side;
}

export type ChangeType = 'added' | 'removed' | 'modified' | 'label_only';
export type Value = number | string | number[] | null;

export interface Change {
  id: string;
  type: ChangeType;
  category: string;              // left-panel category id (categories.ts)
  member_ids: string[];          // for a move: [baseline member, revised member]
  subject?: string;              // for non-member records, e.g. "Material STEEL-COL"
  extent: { members: number; distance: number };
  before: Record<string, Value> | null;
  after: Record<string, Value> | null;
  units?: Record<string, string>; // per field; "length" means meta.units.length
}

export interface Result {
  mock: boolean;                 // synthetic data (the seeded demo), not a real model
  meta: Meta;
  stories: Story[];
  nodes: Node[];
  members: Member[];
  changes: Change[];
  loads?: ModelLoads;            // applied loads per element, and pattern / case / combo definitions
}
