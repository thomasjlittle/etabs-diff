// etabs-diff output contract, schemaVersion 0.2 (near-final, not frozen). 0.2 adds loads and loadDefinitions.
// One JSON file per comparison of model A (before) and model B (after).
// The engine writes it; the viewer reads only this file.
// Every element appears, unchanged ones included, with drawable geometry,
// so a viewer can draw the whole model from this file alone.
// Plain-words field guide: CONTRACT.md in this folder.

export type Vec3 = [number, number, number];   // global X, Y, Z in inches, for drawing only (B's coordinates; A's for removed)
export type Affect = 'geometry' | 'stiffness' | 'mass' | 'load';
export type Change = { field: string; before: unknown; after: unknown; affects: Affect[]; kind?: 'renamed' };

// One applied load as written in the e2k, minus its pattern, in kip and inches. Raw e2k keys.
export type AppliedLoad = {
  TYPE: string;                         // frames: POINTF, POINTM, UNIFF, UNIFM, TRAPF, TRAPM; joints: FORCE; areas: UNIFF, UNIFLOADSET
  DIR?: string;                         // as written: GRAV, X, Y, Z, 1, 2, 3, ...
  FVAL?: number;                        // POINTF/UNIFF/area value; for UNIFLOADSET the set's value for this pattern
  FSTART?: number; FEND?: number;       // TRAPF/TRAPM
  FX?: number; FY?: number; FZ?: number; MX?: number; MY?: number; MZ?: number;  // joint loads
  RDIST?: number; DIST?: number;        // POINTF/POINTM on a frame: relative, and inches from the I end
  RDSTART?: number; DSTART?: number;    // UNIFF/UNIFM/TRAPF/TRAPM on a frame: relative, and inches from the I end
  RDEND?: number; DEND?: number;
  SET?: string;                         // UNIFLOADSET: the shell uniform load set it came from
  [key: string]: unknown;               // any other e2k key on the record, passed through
};
export type ElementLoads = {
  a: Record<string, AppliedLoad[]>;     // load pattern -> loads in model A; {} when absent or unloaded in A
  b: Record<string, AppliedLoad[]>;
};

export type Expansion = {
  expandable: boolean;
  patterns: Record<string, number>;     // load pattern -> effective factor; {} when not expandable
  reason: string | null;                // why not (envelope, SRSS, response spectrum, ...); null when expandable
};
export type LoadDefinitions = {
  patterns: Record<string, { type: string; selfWeight: number }>;
  cases: Record<string, { type: string; patterns: Record<string, number>; effective: Expansion }>;
  combos: Record<string, {
    type: string;
    cases: Record<string, number>;      // LOADCASE terms (ETABS may name a combo here too)
    combos: Record<string, number>;     // LOADCOMBO terms
    effective: Expansion;
  }>;
};

export type ElementDiff = {
  key: string;                          // geometric match key: level-relative (story, x, y, dz), tolerance-rounded; never a label
  kind: 'point' | 'frame' | 'area';     // points: those with a restraint, spring, mass, or load, or whose assigns changed
  subtype: 'beam' | 'column' | 'brace' | 'floor' | 'wall' | 'other' | 'joint';
  label: string;                        // display only, so people can find it in ETABS (B's label, A's when removed)
  story: string;                        // story the element is tied to (B's, A's when removed)
  status: 'unchanged' | 'added' | 'removed' | 'modified' | 'affected';
  geometry: Vec3[];                     // point: [xyz]; frame: [i, j]; area: corners in drawing order
  changes: Change[];                    // empty when unchanged; for affected, the upstream definition changes
  via?: string[];                       // affected only, e.g. ["frameSection:W14X22", "material:A992Fy50"]
  movedTo?: string;                     // removed only: key of the added element this one moved to
  movedFrom?: string;                   // added only: key of the removed element this one moved from
  loads?: ElementLoads;                 // 0.2: only on elements that carry a load in A or B, any status
};

export type TableDiff = { added: string[]; removed: string[]; modified: Record<string, Change[]> };

export type DiffOutput = {
  schemaVersion: '0.2';
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
    loadCases?: TableDiff; combos?: TableDiff; massSource?: TableDiff;  // one change per load term, e.g. "LOADPAT:Live"
    diaphragms?: TableDiff; functions?: TableDiff; analysisOptions?: TableDiff;  // diaphragm defs, spectrum / time history functions, PDELTA
  };
  summary: Record<ElementDiff['status'], number>;
  loadDefinitions?: { a: LoadDefinitions; b: LoadDefinitions };  // 0.2: every pattern, case and combo per model; the engine always writes it, optional so 0.1 files still read
};
