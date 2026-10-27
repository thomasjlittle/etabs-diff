// "Add version" form on the revision log page: upload a model, pick its parent(s), write a git-style message.
// Saved by the dev-server route in saveRevision.ts; a production build shows the form disabled.
import { useState, type FormEvent } from 'react';
import type { Revision } from './revisions';
import {
  defaultDate, modelFileName, NAME_RULE, revisionErrors, SCRUBBED_DIR, saveLog, scrubPaths, suggestParent, SUMMARY_MAX, SUMMARY_SOFT,
} from './newRevision';

// Served by saveRevision.ts; a literal so node code stays out of the bundle (same as compareE2k in App.tsx).
const SAVE_ROUTE = '/local/revisions';

/** A committed model's text, served raw by the dev server. '' when it can't be read. */
const fetchModel = (file: string) =>
  fetch(`/demo_viewer/models/${encodeURIComponent(file)}`).then((r) => (r.ok ? r.text() : ''), () => '');

const readText = (file: File) => new Promise<string>((ok, no) => {
  const reader = new FileReader(); // FileReader rather than file.text(), which jsdom lacks
  reader.onload = () => ok(reader.result as string);
  reader.onerror = () => no(new Error(`Could not read ${file.name}.`));
  reader.readAsText(file);
});

async function post(model: File, rev: Revision): Promise<string> {
  const body = new FormData();
  body.append('model', model);
  for (const [k, v] of Object.entries(rev)) for (const s of [v].flat()) body.append(k, s);
  let res: Response;
  try {
    res = await fetch(SAVE_ROUTE, { method: 'POST', body, headers: { 'x-vantage-compare': '1' } });
  } catch {
    throw new Error('The local dev server did not answer. Start it from frontend/ with: npm run dev');
  }
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `The dev server returned status ${res.status}.`);
  return `Added ${rev.file}. Diffs regenerated; the page reloads with it.`;
}

const input = 'w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-900';

export function AddVersion({ revisions, available = import.meta.env.DEV, loadModel = fetchModel, save = post }: {
  revisions: Revision[]; available?: boolean;
  loadModel?: (file: string) => Promise<string>; save?: (model: File, rev: Revision) => Promise<string>;
}) {
  const [model, setModel] = useState<File | null>(null);
  const [rev, setRev] = useState<Revision>({ file: '', parents: [], summary: '', body: '', author: '', date: '' });
  const [suggested, setSuggested] = useState<string | null>(null);
  const [scrubbed, setScrubbed] = useState(0);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Revision>) => setRev((r) => ({ ...r, ...patch }));
  const errors = model ? revisionErrors(rev, revisions) : [];

  const choose = async (f: File | null) => {
    setModel(f);
    setStatus(null);
    if (!f) return;
    const { text, replaced } = scrubPaths(await readText(f)); // compare logs the way they will be saved
    const logs = await Promise.all(revisions.map(async (r) => ({ file: r.file, log: saveLog(await loadModel(r.file)) })));
    const parent = suggestParent(saveLog(text), logs);
    setSuggested(parent);
    setScrubbed(replaced);
    set({ file: modelFileName(f.name), parents: parent ? [parent] : [], date: defaultDate(text) });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!model || errors.length) return;
    setSaving(true);
    try {
      setStatus({ ok: true, text: await save(model, rev) });
    } catch (err) {
      setStatus({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const n = rev.summary.length;
  return (
    <details className="border-b border-slate-200 px-4 py-2 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-slate-700">Add version</summary>
      {!available && <p className="mt-2 text-xs text-slate-500">Adding a version needs the dev server. Start it from frontend/ with: npm run dev</p>}
      <form onSubmit={submit} className="mt-2 max-w-3xl" aria-label="Add version">
        <fieldset disabled={!available || saving} className="grid grid-cols-[8rem_1fr] items-start gap-x-3 gap-y-2 disabled:opacity-50">
          <label htmlFor="av-model" className="pt-1 text-xs text-slate-500">Model file</label>
          <div>
            <input id="av-model" type="file" accept=".e2k,.$et" className="text-xs" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
            <p className="mt-1 text-xs text-slate-500">
              Windows user folders (C:\Users\…) in the file's $ File header and save log are replaced with {SCRUBBED_DIR} on save.
              Nothing else in the file changes.{model && ` ${scrubbed} path${scrubbed === 1 ? '' : 's'} to replace in this file.`}
            </p>
          </div>

          <label htmlFor="av-file" className="pt-1 text-xs text-slate-500">Save as</label>
          <input id="av-file" className={input} value={rev.file} placeholder={`Hack_v07.e2k (${NAME_RULE})`}
            onChange={(e) => set({ file: e.target.value })} />

          <label htmlFor="av-parents" className="pt-1 text-xs text-slate-500">Parents</label>
          <div>
            <select id="av-parents" multiple className={input} size={Math.min(6, Math.max(2, revisions.length))} value={rev.parents}
              onChange={(e) => set({ parents: [...e.target.selectedOptions].map((o) => o.value) })}>
              {[...revisions].reverse().map((r) => <option key={r.file} value={r.file}>{r.file}: {r.summary}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Ctrl or Cmd click to pick two for a merge; none picked starts a new root.
              {model && (suggested
                ? ` Suggested ${suggested}: its save log is the longest prefix of this file's.`
                : ' No version shares a save with this file, so no parent is suggested.')}
            </p>
          </div>

          <label htmlFor="av-summary" className="pt-1 text-xs text-slate-500">Summary</label>
          <div>
            <input id="av-summary" className={input} value={rev.summary} placeholder="Resize C3 to W16X36"
              onChange={(e) => set({ summary: e.target.value })} />
            <p className={`mt-1 text-xs ${n > SUMMARY_MAX ? 'text-red-700' : n > SUMMARY_SOFT ? 'text-amber-700' : 'text-slate-500'}`}>
              {n}/{SUMMARY_SOFT} characters, at most {SUMMARY_MAX}
            </p>
          </div>

          <label htmlFor="av-body" className="pt-1 text-xs text-slate-500">Body (optional)</label>
          <textarea id="av-body" className={input} rows={3} value={rev.body} onChange={(e) => set({ body: e.target.value })} />

          <label htmlFor="av-author" className="pt-1 text-xs text-slate-500">Author</label>
          <input id="av-author" className={input} value={rev.author} onChange={(e) => set({ author: e.target.value })} />

          <label htmlFor="av-date" className="pt-1 text-xs text-slate-500">Date</label>
          <input id="av-date" type="datetime-local" step={1} className={input} value={rev.date}
            onChange={(e) => set({ date: (e.target.value + ':00').slice(0, 19) })} />

          <span />
          <div className="flex flex-col gap-1">
            {errors.length > 0 && <ul className="list-disc pl-4 text-xs text-red-700">{errors.map((er) => <li key={er}>{er}</li>)}</ul>}
            <button type="submit" disabled={!model || errors.length > 0}
              className="self-start rounded bg-slate-800 px-3 py-1 text-xs text-white disabled:opacity-40">
              {saving ? 'Saving…' : 'Add version'}
            </button>
            {status && <p role={status.ok ? 'status' : 'alert'} className={`text-xs ${status.ok ? 'text-green-700' : 'text-red-700'}`}>{status.text}</p>}
          </div>
        </fieldset>
      </form>
    </details>
  );
}
