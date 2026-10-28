// Left-panel taxonomy: how an ETABS user thinks about a model, section by section.
// Each change gets one category. Categories the engine does not compare are listed as "Not compared",
// never as "0 changes", so a reviewer does not read a gap as a clean check.
import type { Change } from './keeptabsTypes';

export interface Category { id: string; title: string; compared: boolean; note?: string }
export interface Section { title: string; items: Category[] }

export const SECTIONS: Section[] = [
  { title: 'Model Settings', items: [
    { id: 'settings', title: 'Units, design codes, model options', compared: false },
    { id: 'stories', title: 'Stories & Grids', compared: true, note: 'grid lines not compared' },
  ] },
  { title: 'Definitions', items: [
    { id: 'materials', title: 'Materials', compared: true },
    { id: 'frameSections', title: 'Frame Sections', compared: true },
    { id: 'shellSections', title: 'Shell Sections (slab, wall, deck)', compared: true },
    { id: 'linkProps', title: 'Link / Spring Properties', compared: true, note: 'link properties not compared' },
    { id: 'functions', title: 'Functions (response spectrum, time history)', compared: true },
  ] },
  { title: 'Objects', items: [
    { id: 'objects', title: 'Joints, Frames, Shells, Links: added / removed / moved', compared: true },
  ] },
  { title: 'Assignments', items: [
    { id: 'sectionAssign', title: 'Section assignment', compared: true },
    { id: 'modifiers', title: 'Property modifiers', compared: true },
    { id: 'releases', title: 'Releases, end offsets / rigid zones, insertion points, local axes', compared: true },
    { id: 'restraints', title: 'Restraints & springs', compared: true },
    { id: 'diaphragms', title: 'Diaphragms', compared: true },
    { id: 'meshing', title: 'Meshing', compared: false },
    { id: 'labels', title: 'Pier / spandrel / group labels', compared: false },
  ] },
  { title: 'Loading', items: [
    { id: 'loadPatterns', title: 'Load Patterns', compared: true },
    { id: 'appliedLoads', title: 'Applied Loads (incl. added mass)', compared: true },
    { id: 'massSource', title: 'Mass Source', compared: true },
  ] },
  { title: 'Analysis', items: [
    { id: 'loadCases', title: 'Load Cases', compared: true },
    { id: 'combos', title: 'Load Combinations', compared: true },
    { id: 'analysisOptions', title: 'Analysis Options', compared: true },
  ] },
  { title: 'Design', items: [
    { id: 'designPrefs', title: 'Preferences / codes', compared: false },
    { id: 'designOverwrites', title: 'Overwrites', compared: false },
    { id: 'designCombos', title: 'Design combos & groups', compared: false },
  ] },
  { title: 'Other', items: [
    { id: 'labelOnly', title: 'Label-only (not physical)', compared: true },
    { id: 'other', title: 'Uncategorized', compared: true },
  ] },
];

export const CATEGORY_TITLE: Record<string, string> =
  Object.fromEntries(SECTIONS.flatMap((s) => s.items.map((c) => [c.id, c.title])));

/** Category for an engine definition table. */
export function tableCategory(table: string): string {
  return ({
    stories: 'stories', materials: 'materials', frameSections: 'frameSections', shellSections: 'shellSections',
    pointSprings: 'linkProps', lineSprings: 'linkProps', areaSprings: 'linkProps', functions: 'functions',
    loadPatterns: 'loadPatterns', loadSets: 'appliedLoads', massSource: 'massSource',
    loadCases: 'loadCases', combos: 'combos', analysisOptions: 'analysisOptions', diaphragms: 'diaphragms',
  } as Record<string, string>)[table] ?? 'other';
}

/** Category for a changed element field (e2k keyword, any case, e.g. "SECTION" or "loads:Dead"). */
export function fieldCategory(field: string): string {
  const f = field.split(':')[0].toUpperCase();
  if (f === 'LABEL') return 'labelOnly';
  if (f === 'SECTION') return 'sectionAssign';
  if (/MASS/.test(f)) return 'appliedLoads'; // added mass assigns
  if (/^ANG$|RELEASE|OFFSET|RIGIDZONE|LENGTHOFF|CARDINAL|INSERTION|AXIS/.test(f)) return 'releases';
  if (/^DIAPH/.test(f)) return 'diaphragms';
  if (/^(RESTRAINT|SPRING)/.test(f)) return 'restraints';
  if (/^LOAD/.test(f)) return 'appliedLoads';
  if (/^PROPMOD/.test(f)) return 'modifiers';
  return 'other';
}

/** The category a change is listed under. Any rename is label-only, whatever it renamed. */
export function categoryOf(c: Change): string {
  return c.type === 'label_only' ? 'labelOnly' : c.category;
}
