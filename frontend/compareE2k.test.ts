// @vitest-environment node
// Upload route: two real ETABS models posted to the dev server give the same diff as the engine CLI committed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPARE_HEADER, COMPARE_ROUTE, handleCompare } from './compareE2k';
import v01a_v04 from './demo_viewer/diffs/Hack_v01a__Hack_v04.json';

const model = (name: string) => new File([readFileSync(new URL(`./demo_viewer/models/${name}`, import.meta.url))], name);

function post(files: Record<string, File>, headers: Record<string, string> = { [COMPARE_HEADER]: '1' }) {
  const body = new FormData();
  for (const [k, f] of Object.entries(files)) body.append(k, f);
  return handleCompare(new Request(`http://127.0.0.1${COMPARE_ROUTE}`, { method: 'POST', body, headers }));
}

describe('POST /local/compare', () => {
  it('v01a -> v04 uploaded equals the committed engine diff for that pair', async () => {
    const r = await post({ a: model('Hack_v01a.e2k'), b: model('Hack_v04.e2k') });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(v01a_v04);
  }, 60_000);

  it('two uploads with the same file name do not overwrite each other', async () => {
    const a = new File([await model('Hack_v01a.e2k').arrayBuffer()], 'model.e2k');
    const b = new File([await model('Hack_v04.e2k').arrayBuffer()], 'model.e2k');
    const d = await (await post({ a, b })).json();
    expect(d.summary).toEqual(v01a_v04.summary);
    expect([d.meta.a.file, d.meta.b.file]).toEqual(['model.e2k', 'model.e2k']);
  }, 60_000);

  it('a missing Second file is a 400 with a plain message', async () => {
    const r = await post({ a: model('Hack_v01a.e2k') });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('Choose both an Original and a Second model file.');
  });

  it('a request without the header is refused before anything runs', async () => {
    const r = await post({ a: model('Hack_v01a.e2k'), b: model('Hack_v04.e2k') }, {});
    expect(r.status).toBe(403);
  });
});
