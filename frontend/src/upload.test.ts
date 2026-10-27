// Open a diff file: a diff_engine JSON picked in the browser gives the same review as the committed pair.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareModels, loadScenario, openDiffFile } from './App';
import v01a_v04 from '../demo_viewer/diffs/Hack_v01a__Hack_v04.json';

const file = (name: string, text: string) => new File([text], name);

describe('openDiffFile', () => {
  it('a diff of v01a -> v04 shows the same review as the precomputed pair', async () => {
    const r = await openDiffFile(file('diff.json', JSON.stringify(v01a_v04)));
    expect(r).toEqual(await loadScenario('hack-models', { original: 'Hack_v01a', second: 'Hack_v04' }));
    expect(r.mock).toBe(false);
  });

  it('a model file picked by mistake is rejected with how to make a diff', async () => {
    await expect(openDiffFile(file('Hack_v01a.e2k', '$ File Hack_v01a.e2k\n$ PROGRAM INFORMATION\n')))
      .rejects.toThrow('Hack_v01a.e2k is not a diff_engine output file. Make one from backend/ with: python3 -m diff_engine');
  });

  it('JSON that is not a diff is rejected', async () => {
    await expect(openDiffFile(file('package.json', '{"name": "x"}'))).rejects.toThrow('is not a diff_engine output file');
  });
});

// Upload two models: the browser side of POST /local/compare. fetch is mocked here; compareE2k.test.ts runs the real route.
describe('compareModels', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('posts Original as a and Second as b, and shows the same review as the precomputed pair', async () => {
    const fetch = reply(200, v01a_v04);
    vi.stubGlobal('fetch', fetch);
    const r = await compareModels(file('Hack_v01a.e2k', 'A'), file('Hack_v04.e2k', 'B'));
    expect(r).toEqual(await loadScenario('hack-models', { original: 'Hack_v01a', second: 'Hack_v04' }));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/local/compare');
    expect((init.headers as Record<string, string>)['x-vantage-compare']).toBe('1');
    const body = init.body as FormData;
    expect([(body.get('a') as File).name, (body.get('b') as File).name]).toEqual(['Hack_v01a.e2k', 'Hack_v04.e2k']);
  });

  it('an engine error is shown as the server worded it', async () => {
    vi.stubGlobal('fetch', reply(422, { error: 'The diff engine could not compare these files: bad UNITS' }));
    await expect(compareModels(file('a.e2k', ''), file('b.e2k', ''))).rejects.toThrow('bad UNITS');
  });

  it('no dev server (preview build or server stopped) says how to start it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    await expect(compareModels(file('a.e2k', ''), file('b.e2k', ''))).rejects.toThrow('npm run dev');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(compareModels(file('a.e2k', ''), file('b.e2k', ''))).rejects.toThrow('did not answer');
  });
});
