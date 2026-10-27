// @vitest-environment node
// Save route: validates before writing, scrubs user paths, appends to revisions.json, and undoes a failed save.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { COMPARE_HEADER } from './compareE2k';
import { formatManifest, handleSaveRevision, SAVE_ROUTE, type SaveDirs } from './saveRevision';

const MODELS = new URL('./demo_viewer/models/', import.meta.url);
const real = (name: string) => readFileSync(new URL(name, MODELS));
// v04 as it would come off a teammate's machine: a user folder in the header and the save log.
const unscrubbed = real('Hack_v04.e2k').toString('latin1').replaceAll('C:\\Models\\Hackathon\\', 'C:\\Users\\jdoe\\OneDrive - Co\\Proj\\');

let dirs: SaveDirs;
let calls: string[];
beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'vantage-save-'));
  const models = join(root, 'models');
  cpSync(MODELS, models, { recursive: true });
  mkdirSync(join(root, 'diffs'));
  writeFileSync(join(root, 'diffs', 'manifest.json'), '{"models": []}\n');
  calls = [];
  dirs = { models, diffs: join(root, 'diffs'), regenerate: async () => { calls.push('regenerate'); } };
});

const fields = { file: 'Hack_v04b.e2k', parents: 'Hack_v04.e2k', summary: 'Try a branch off v04', body: '', author: 'QA', date: '2026-10-27T13:27:15' };
function post(over: Record<string, string | string[]> = {}, model: File | null = new File([Buffer.from(unscrubbed, 'latin1')], 'Hack_v04.e2k'),
  headers: Record<string, string> = { [COMPARE_HEADER]: '1' }) {
  const body = new FormData();
  if (model) body.append('model', model);
  for (const [k, v] of Object.entries({ ...fields, ...over })) for (const s of [v].flat()) body.append(k, s);
  return handleSaveRevision(new Request(`http://127.0.0.1${SAVE_ROUTE}`, { method: 'POST', body, headers }), dirs);
}
const listing = () => [readdirSync(dirs.models).sort(), readFileSync(join(dirs.models, 'revisions.json'), 'utf-8')];

describe('POST /local/revisions', () => {
  it('the committed revisions.json is already in the layout the route writes', () => {
    const text = real('revisions.json').toString();
    expect(formatManifest(JSON.parse(text).revisions)).toBe(text);
  });

  it('writes the scrubbed model, regenerates, then appends the entry', async () => {
    const r = await post();
    expect(r.status).toBe(201);
    expect((await r.json()).scrubbedPaths).toBe(9); // the header plus 8 save log lines
    expect(readFileSync(join(dirs.models, 'Hack_v04b.e2k'))).toEqual(real('Hack_v04.e2k'));
    expect(calls).toEqual(['regenerate']);
    const revs = JSON.parse(readFileSync(join(dirs.models, 'revisions.json'), 'utf-8')).revisions;
    expect(revs.at(-1)).toEqual({ ...fields, parents: ['Hack_v04.e2k'] });
    expect(revs).toHaveLength(9);
  });

  it('refuses bad input with nothing written and nothing run', async () => {
    const before = listing();
    const cases: [number, Promise<Response>][] = [
      [403, post({}, undefined, {})],
      [400, post({}, null)],
      [400, post({}, new File(['x'], 'notes.txt'))],
      [400, post({}, new File([], 'empty.e2k'))],
      [400, post({}, new File(['not a model\r\n'], 'junk.e2k'))],
      [400, post({ file: '../Hack_v07.e2k' })],
      [400, post({ file: 'Hack_v04.e2k' })],
      [400, post({ parents: 'Hack_v99.e2k' })],
      [400, post({ summary: 'x'.repeat(73) })],
      [400, post({ summary: '' })],
    ];
    for (const [status, r] of cases) expect((await r).status).toBe(status);
    expect(listing()).toEqual(before);
    expect(calls).toEqual([]);
  });

  it('a file name taken on disk but not in the log is refused too', async () => {
    writeFileSync(join(dirs.models, 'stray.e2k'), 'x');
    const r = await post({ file: 'STRAY.e2k' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('STRAY.e2k already exists. Pick another file name.');
  });

  it('a failed regenerate removes the model, keeps revisions.json, and restores the diffs', async () => {
    const before = listing();
    const diffsBefore = readFileSync(join(dirs.diffs, 'manifest.json'), 'utf-8');
    dirs.regenerate = async () => {
      writeFileSync(join(dirs.diffs, 'manifest.json'), 'half written');
      writeFileSync(join(dirs.diffs, 'Hack_v04b__Hack_v04b.json'), '{}');
      throw new Error('could not parse Hack_v04b.e2k');
    };
    const r = await post();
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe('Nothing was saved. Regenerating the diffs failed: could not parse Hack_v04b.e2k');
    expect(listing()).toEqual(before);
    expect(readdirSync(dirs.diffs)).toEqual(['manifest.json']);
    expect(readFileSync(join(dirs.diffs, 'manifest.json'), 'utf-8')).toBe(diffsBefore);
  });
});
