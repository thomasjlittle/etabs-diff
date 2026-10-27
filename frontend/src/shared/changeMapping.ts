// Mapping for the schema.py contract. Unknown tables and properties stay visible in Other.
const tableSubcategories = new Map<string, string>(Object.entries({
  stories: 'modelSettings/storiesGrids',
  grids: 'modelSettings/storiesGrids',
  options: 'modelSettings/options',
  materials: 'definitions/materials',
  frameSections: 'definitions/frameSections',
  shellSections: 'definitions/shellSections',
  linkProps: 'definitions/linkProps',
  pointSprings: 'definitions/linkProps',
  lineSprings: 'definitions/linkProps',
  areaSprings: 'definitions/linkProps',
  functions: 'definitions/functions',
  loads: 'loading/applied',
  loadPatterns: 'loading/patterns',
  massSource: 'loading/massSource',
  loadCases: 'analysis/cases',
  combos: 'analysis/combos',
  analysisOptions: 'analysis/options',
  designPreferences: 'design/preferences',
  designOverwrites: 'design/overwrites',
  designCombos: 'design/combosGroups',
  designGroups: 'design/combosGroups',
}))

const objectSubcategories = new Map<string, string>(Object.entries({
  frames: 'objects/frames', nodes: 'objects/joints', areas: 'objects/shells', links: 'objects/links',
}))

export function subcategoryFor(table: string, field?: string): string {
  const object = objectSubcategories.get(table)
  if (!object) return tableSubcategories.get(table) ?? 'other/uncategorized'
  if (!field || ['label', 'nodes', 'xyz', 'i', 'j', 'corners', 'story', 'kind'].includes(field)) return object
  if (field === 'section') return 'assignments/section'
  if (!field.startsWith('props.')) return 'other/uncategorized'
  const prop = field.slice(6).toLowerCase().replace(/[_\s-]/g, '')
  if (prop.startsWith('mod')) return 'assignments/modifiers'
  if (/^(release|offset|endoffset|insertion|cardinal|localax)/.test(prop)) return 'assignments/releases'
  if (/^(restraint|spring)/.test(prop)) return 'assignments/restraints'
  if (prop.startsWith('diaphragm')) return 'assignments/diaphragms'
  if (/^(mesh|automesh)/.test(prop)) return 'assignments/meshing'
  if (/^(pier|spandrel|group)/.test(prop)) return 'assignments/labels'
  // Added mass is an inertial assignment, reported with Mass Source rather than applied loads.
  if (/^(mass|addedmass|linemass|areamass|pointmass|jointmass)/.test(prop)) return 'loading/massSource'
  return 'other/uncategorized'
}

export const definitionTables = new Set(['materials', 'frameSections', 'shellSections'])

export const tableElementTypes = new Map<string, string>(Object.entries({
  nodes: 'joint', frames: 'frame', areas: 'shell', links: 'link', stories: 'story',
  materials: 'material', frameSections: 'frameSection', shellSections: 'shellSection',
  loads: 'load', loadPatterns: 'loadPattern', loadCases: 'loadCase', combos: 'combo', massSource: 'massSource',
}))

export function propertyLabel(field: string): string {
  const labels: Record<string, string> = {
    section: 'Section', label: 'Label', nodes: 'Nodes', xyz: 'Coordinates', elev: 'Elevation',
    'props.lineMass': 'Line mass', 'props.releaseI': 'Release I', 'props.releaseJ': 'Release J',
  }
  if (Object.prototype.hasOwnProperty.call(labels, field)) return labels[field]
  if (field.startsWith('props.mod')) return `${field.slice(9)} modifier`
  return field
}

// Sort object keys so equivalent values group together even when their input key order differs.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]))
  }
  return value
}

export function displayValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value === '' ? '""' : value
  return JSON.stringify(canonical(value))
}
