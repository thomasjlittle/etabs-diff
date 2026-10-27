// etabs-diff output contract, schemaVersion 0.1 (near-final, not frozen).
// One JSON file per comparison of model A (before) and model B (after).
// The engine writes it; the viewer reads only this file.
// Every element appears, unchanged ones included, with drawable geometry,
// so a viewer can draw the whole model from this file alone.
// Plain-words field guide: CONTRACT.md in this folder.

export type Vec3 = [number, number, number];   // global X, Y, Z in inches, for drawing only (B's coordinates; A's for removed)
export type Affect = 'geometry' | 'stiffness' | 'mass' | 'load';
export type Change = { field: string; before: unknown; after: unknown; affects: Affect[] };

export type ElementDiff = {
  key: string;                          // geometric match key: level-relative (story, x, y, dz), tolerance-rounded; never a label
  kind: 'point' | 'frame' | 'area';     // points: only those with a restraint, spring, or load
  subtype: 'beam' | 'column' | 'brace' | 'floor' | 'wall' | 'other' | 'joint';
  label: string;                        // display only, so people can find it in ETABS (B's label, A's when removed)
  story: string;                        // story the element is tied to (B's, A's when removed)
  status: 'unchanged' | 'added' | 'removed' | 'modified' | 'affected';
  geometry: Vec3[];                     // point: [xyz]; frame: [i, j]; area: corners in drawing order
  changes: Change[];                    // empty when unchanged; for affected, the upstream definition changes
  via?: string[];                       // affected only, e.g. ["frameSection:W14X22", "material:A992Fy50"]
  movedTo?: string;                     // removed only: key of the added element this one moved to
  movedFrom?: string;                   // added only: key of the removed element this one moved from
};

export type TableDiff = { added: string[]; removed: string[]; modified: Record<string, Change[]> };

export type DiffOutput = {
  schemaVersion: '0.1';
  meta: {
    a: { file: string; etabsVersion: string; units: string };
    b: { file: string; etabsVersion: string; units: string };
    lengthUnit: 'in';                   // all geometry normalized to inches
    tolerance: number;                  // inches; default from PREFERENCE MERGETOL
  };
  stories: { name: string; elevA: number | null; elevB: number | null }[];  // bottom up, inches; null when absent on that side
  elements: ElementDiff[];              // EVERY element in the union of A and B
  tables: {
    stories: TableDiff; materials: TableDiff; frameSections: TableDiff;
    shellSections: TableDiff; pointSprings: TableDiff; loadPatterns: TableDiff;
  };
  summary: Record<ElementDiff['status'], number>;
};
