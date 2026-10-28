/// <reference types="node" />
// Dev-server route: POST two .e2k/.$et files, get the diff_engine JSON back (same as `python3 -m diff_engine a b`).
// Runs on the dev server only (npm run dev, bound to 127.0.0.1), so model files never leave this machine.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export const COMPARE_ROUTE = '/local/compare';
// Required on every request: a custom header makes the browser preflight, so another site can't post here.
export const COMPARE_HEADER = 'x-keeptabs-local';
const BACKEND = fileURLToPath(new URL('../backend', import.meta.url));
export const MAX_BYTES = 200 * 1024 * 1024;

export interface Upload { name: string; bytes: Uint8Array }

/** Keep only the file name; it is shown in the review as meta.a.file / meta.b.file. */
function safeName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[^\w.$ -]/g, '_').trim();
  return base && base !== '.' && base !== '..' ? base : 'model.e2k';
}

/** Run the engine CLI on two models. Uploads go to a temp folder that is removed afterwards. */
export async function compareE2k(a: Upload, b: Upload): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'keeptabs-compare-'));
  try {
    // a/ and b/ so two uploads with the same name don't overwrite each other
    const [pathA, pathB] = await Promise.all(([['a', a], ['b', b]] as const).map(async ([sub, f]) => {
      await mkdir(join(dir, sub));
      const path = join(dir, sub, safeName(f.name));
      await writeFile(path, f.bytes);
      return path;
    }));
    const out = join(dir, 'diff.json');
    await new Promise<void>((ok, fail) => {
      execFile('python3', ['-m', 'diff_engine', pathA, pathB, '-o', out], { cwd: BACKEND, timeout: 120_000 },
        (err, _stdout, stderr) => {
          if (!err) return ok();
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fail(new Error('python3 was not found on PATH.'));
          fail(new Error(stderr.trim().replace(/^error: /, '') || err.message));
        });
    });
    return await readFile(out, 'utf-8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const json = (status: number, body: string) => new Response(body, { status, headers: { 'content-type': 'application/json' } });
export const fail = (status: number, error: string) => json(status, JSON.stringify({ error }));

/** POST multipart form with files "a" (original) and "b" (second). */
export async function handleCompare(req: Request): Promise<Response> {
  if (req.method !== 'POST') return fail(405, 'Use POST.');
  if (req.headers.get(COMPARE_HEADER) !== '1') return fail(403, `Missing ${COMPARE_HEADER} header.`);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, 'Expected a form with two files, a and b.');
  }
  const [a, b] = [form.get('a'), form.get('b')];
  if (!(a instanceof File) || !(b instanceof File)) return fail(400, 'Choose both an Original and a Second model file.');
  try {
    const upload = async (f: File) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    return json(200, await compareE2k(await upload(a), await upload(b)));
  } catch (e) {
    return fail(422, `The diff engine could not compare these files: ${(e as Error).message}`);
  }
}

/** Dev-server plugin serving `handle` at `route`, with the request body capped at MAX_BYTES. */
export function localRoute(name: string, route: string, handle: (req: Request) => Promise<Response>): Plugin {
  return {
    name,
    configureServer(server) {
      server.middlewares.use(route, async (req, res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.statusCode = 413;
            res.end(JSON.stringify({ error: 'Files are larger than 200 MB.' }));
            return;
          }
          chunks.push(chunk);
        }
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const body = req.method === 'POST' ? Buffer.concat(chunks) : undefined;
        const r = await handle(new Request(`http://127.0.0.1${route}`, { method: req.method, headers, body }));
        res.statusCode = r.status;
        res.setHeader('content-type', 'application/json');
        res.end(await r.text());
      });
    },
  };
}

export const compareE2kPlugin = () => localRoute('keeptabs-compare-e2k', COMPARE_ROUTE, handleCompare);
