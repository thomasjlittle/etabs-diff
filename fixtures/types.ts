export type Model = {
  meta: { file: string; etabsVersion: string; sourceUnits: string };
  stories: { name: string; elev: number }[];          // in, top down as in file
  nodes: Node[];                                       // 2nd pass
  frames: Frame[];
  areas: Area[];                                       // stretch, but 1D shell modifiers need it
  loads: Load[];                                       // 2nd pass
  materials: Record<string, Props>;
  frameSections: Record<string, Props>;                // props.material always set
  shellSections: Record<string, Props>;                // props.material always set
  loadPatterns: Record<string, Props>;
  loadCases: Record<string, Props>;
  combos: Record<string, { type: string; factors: Record<string, number> }>;
  massSource: Record<string, Props>;                   // 3rd pass
  unparsed: string[];                                  // section headers we skipped
};

export type Node = {
  id: string;                                          // `${label}@${story}`
  label: string; story: string;
  xyz: [number, number, number];                       // global, in
  props: Props;                                        // restraints, springs, added mass
};

export type Frame = {
  id: string;                                          // `${label}@${story}`, e.g. "B23@L4"
  label: string; story: string;
  kind: 'beam' | 'column' | 'brace';
  nodes: [string, string];                             // Node ids, i then j
  i: [number, number, number]; j: [number, number, number]; // global, in
  section: string;
  props: Props;                                        // releases, modifiers, offsets, local axis, added mass
};

export type Area = {
  id: string; label: string; story: string;
  kind: 'wall' | 'slab';
  nodes: string[];
  corners: [number, number, number][];
  section: string;
  props: Props;                                        // modifiers, diaphragm, pier / spandrel
};

export type Load = {
  id: string;                                          // `${on}|${pattern}|${type}|${dir}`
  on: string;                                          // Node, Frame or Area id
  pattern: string; type: string; dir: string;
  values: number[];                                    // kip, in
};

export type Props = Record<string, string | number>;   // raw keyword/value pairs

export type Change = { field: string; before: unknown; after: unknown; affects: ('geometry' | 'stiffness' | 'mass' | 'load')[] };
export type SetDiff = { added: string[]; removed: string[]; modified: Record<string, Change[]> };

export type Diff = {
  frames: SetDiff & { matchedBy: Record<string, 'label' | 'geometry'> };
  tables: Record<string, SetDiff>;                     // keyed by Model field: stories, nodes, areas, loads, materials, ...
};
