/// <reference types="node" />
// Dev-server route: add an uploaded model as a new version in the revision log.
// Writes the file into demo_viewer/models/, regenerates the pair diffs, then appends the entry to revisions.json.
// Same posture as compareE2k.ts: dev server only (127.0.0.1), custom header required, nothing written until
// everything checks out, and a failed step undoes what this request wrote.
import { execFile } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPARE_HEADER, fail, json, localRoute, MAX_BYTES } from './compareE2k';
import { modelFileName, revisionErrors, scrubPaths } from './src/newRevision';
import type { Revision } from './src/revisions';

export const SAVE_ROUTE = '/local/revisions';
const BACKEND = fileURLToPath(new URL('../backend', import.meta.url));
const VIEWER = fileURLToPath(new URL('./demo_viewer', import.meta.url));

export interface SaveDirs {
  models: string; // holds the .e2k files and revisions.json
  diffs: string; // what regenerate() rewrites; restored on failure
  regenerate: () => Promise<void>;
}

/** `python3 -m diff_engine.demo_diffs` from backend/: every ordered pair of models into demo_viewer/diffs/. */
const demoDiffs = () => new Promise<void>((ok, no) => {
  execFile('python3', ['-m', 'diff_engine.demo_diffs'], { cwd: BACKEND, timeout: 300_000 }, (err, _out, stderr) => {
    if (!err) return ok();
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return no(new Error('python3 was not found on PATH.'));
    no(new Error(stderr.trim().split('\n').pop() || err.message));
  });
});

const DEFAULT_DIRS: SaveDirs = { models: join(VIEWER, 'models'), diffs: join(VIEWER, 'diffs'), regenerate: demoDiffs };

/** revisions.json in its hand-edited layout: one key per line, parents on one line. */
export function formatManifest(revs: Revision[]): string {
  const value = (v: unknown) => (Array.isArray(v) ? `[${v.map((s) => JSON.stringify(s)).join(', ')}]` : JSON.stringify(v));
  const entry = (r: Revision) =>
    `    {\n${Object.entries(r).map(([k, v]) => `      ${JSON.stringify(k)}: ${value(v)}`).join(',\n')}\n    }`;
  return `{\n  "revisions": [\n${revs.map(entry).join(',\n')}\n  ]\n}\n`;
}

async function snapshot(dir: string): Promise<Map<string, Buffer>> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return new Map(await Promise.all(names.map(async (n) => [n, await readFile(join(dir, n))] as const)));
}

async function restore(dir: string, saved: Map<string, Buffer>) {
  for (const n of await readdir(dir).catch(() => [] as string[])) if (!saved.has(n)) await rm(join(dir, n), { force: true });
  for (const [n, bytes] of saved) await writeFile(join(dir, n), bytes);
}

// ponytail: one save at a time in this process (revisions.json is read-modify-write); fine for one local user.
let queue: Promise<unknown> = Promise.resolve();

/** POST multipart form: file, file name, parents (repeated), summary, body, author, date. */
export async function handleSaveRevision(req: Request, dirs: SaveDirs = DEFAULT_DIRS): Promise<Response> {
  if (req.method !== 'POST') return fail(405, 'Use POST.');
  if (req.headers.get(COMPARE_HEADER) !== '1') return fail(403, `Missing ${COMPARE_HEADER} header.`);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, 'Expected a form with a model file and the revision fields.');
  }
  const upload = form.get('model');
  if (!(upload instanceof File)) return fail(400, 'Choose a model file (.e2k or .$et).');
  if (!/\.(e2k|\$et)$/i.test(upload.name)) return fail(400, `${upload.name} is not a .e2k or .$et file.`);
  if (upload.size === 0 || upload.size > MAX_BYTES) return fail(400, 'The model file is empty or larger than 200 MB.');
  const text = (k: string) => { const v = form.get(k); return typeof v === 'string' ? v : ''; };
  const rev: Revision = {
    file: text('file') || modelFileName(upload.name),
    parents: form.getAll('parents').filter((p): p is string => typeof p === 'string'),
    summary: text('summary').trim(), body: text('body').trim(), author: text('author').trim(), date: text('date'),
  };
  const run = queue.then(() => save(upload, rev, dirs));
  queue = run.catch(() => {});
  return run;
}

async function save(upload: File, rev: Revision, dirs: SaveDirs): Promise<Response> {
  const manifestPath = join(dirs.models, 'revisions.json');
  const manifestText = await readFile(manifestPath, 'utf-8');
  const revisions: Revision[] = JSON.parse(manifestText).revisions;
  const errors = revisionErrors(rev, revisions, await readdir(dirs.models));
  if (errors.length) return fail(400, errors.join(' '));

  // latin1 maps every byte to one char and back, so only the scrubbed paths change.
  const { text: scrubbed, replaced } = scrubPaths(Buffer.from(await upload.arrayBuffer()).toString('latin1'));
  // The engine reads any text as a (possibly empty) model, so check this is an ETABS text export first.
  if (!/^\$ PROGRAM INFORMATION/m.test(scrubbed)) return fail(400, `${upload.name} is not an ETABS text export (no $ PROGRAM INFORMATION section).`);
  const modelPath = join(dirs.models, rev.file);
  const diffs = await snapshot(dirs.diffs);
  try {
    await writeFile(modelPath, scrubbed, { encoding: 'latin1', flag: 'wx' }); // wx: never overwrite a model
  } catch (e) {
    return fail(409, `Could not write ${rev.file}: ${(e as Error).message}`);
  }
  try {
    await dirs.regenerate();
    await writeFile(manifestPath, formatManifest([...revisions, rev]));
  } catch (e) {
    await rm(modelPath, { force: true });
    await writeFile(manifestPath, manifestText);
    await restore(dirs.diffs, diffs);
    return fail(422, `Nothing was saved. Regenerating the diffs failed: ${(e as Error).message}`);
  }
  return json(201, JSON.stringify({ revision: rev, scrubbedPaths: replaced }));
}

export const saveRevisionPlugin = () => localRoute('keeptabs-save-revision', SAVE_ROUTE, handleSaveRevision);
