// Left-panel categories: field and table rules, the mock fallback, and every real Hack pair.
import { describe, expect, it } from 'vitest';
import mock from './mock/mock-result.json';
import type { Result } from './keeptabsTypes';
import { CATEGORY_TITLE, SECTIONS, categoryOf, fieldCategory, tableCategory } from './categories';
import { loadScenario, MODELS } from './App';

describe('categories', () => {
  it('e2k keywords land in the ETABS assignment they belong to', () => {
    expect(fieldCategory('SECTION')).toBe('sectionAssign');
    expect(fieldCategory('PROPMODI22')).toBe('modifiers');
    expect(fieldCategory('RIGIDZONE')).toBe('releases'); // was "Property modifiers" under the old groups
    expect(fieldCategory('RELEASE')).toBe('releases');
    expect(fieldCategory('ANG')).toBe('releases');
    expect(fieldCategory('CARDINALPT')).toBe('releases');
    expect(fieldCategory('DIAPH')).toBe('diaphragms');
    expect(fieldCategory('RESTRAINT')).toBe('restraints');
    expect(fieldCategory('loads:Dead')).toBe('appliedLoads');
    expect(fieldCategory('props.release')).toBe('releases');
    expect(fieldCategory('SOMETHINGNEW')).toBe('other');
  });

  it('tables land in their definition, loading or analysis category', () => {
    expect(tableCategory('analysisOptions')).toBe('analysisOptions');
    expect(tableCategory('diaphragms')).toBe('diaphragms');
    expect(tableCategory('pointSprings')).toBe('linkProps');
    expect(tableCategory('loadSets')).toBe('appliedLoads');
    expect(tableCategory('unknownTable')).toBe('other');
  });

  it('category ids are unique', () => {
    const ids = SECTIONS.flatMap((s) => s.items.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mock changes fall back on their group', () => {
    const r = mock as unknown as Result;
    const of = (id: string) => categoryOf(r.changes.find((c) => c.id === id)!);
    expect([of('C01'), of('C02'), of('C03'), of('C04'), of('C06'), of('C07')])
      .toEqual(['stories', 'objects', 'objects', 'labelOnly', 'sectionAssign', 'materials']);
  });

  it('every change in every Hack pair has a listed category, and none is uncategorized', async () => {
    for (const a of MODELS) for (const b of MODELS) {
      const r = await loadScenario('hack-models', { original: a, second: b });
      for (const c of r.changes) {
        expect(CATEGORY_TITLE[categoryOf(c)], `${a}->${b} ${c.id}`).toBeDefined();
        expect(categoryOf(c), `${a}->${b} ${c.id} ${c.subject ?? ''} ${Object.keys(c.after ?? c.before ?? {})}`).not.toBe('other');
      }
    }
  });
});
