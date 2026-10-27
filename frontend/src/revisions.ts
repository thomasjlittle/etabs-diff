// Revision log: model history from frontend/demo_viewer/models/revisions.json, laid out like `git log --graph`.
// The manifest is edited by hand or appended by the Add version form (saveRevision.ts). It lists parents before
// children (oldest first), which is checked in revisions.test.ts and is what keeps the history free of cycles.
import manifest from '../demo_viewer/models/revisions.json';

export interface Revision {
  file: string;          // model file name in frontend/demo_viewer/models/
  parents: string[];     // file names; empty for a root, two or more for a merge
  summary: string;       // git-style summary line, about 50 characters
  body: string;          // optional longer message, '' when there is none
  author: string;
  date: string;          // ETABS save time from the file header (local, no zone), '' when unknown
}

export const REVISIONS: Revision[] = manifest.revisions;

/** Model name as the diffs and the review view use it: "Hack_v02.e2k" -> "Hack_v02". */
export const modelName = (file: string) => file.replace(/\.[^.]+$/, '');

/** Problems with a manifest, empty when valid. `files` is every model file that exists. */
export function manifestErrors(revs: Revision[], files: string[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const r of revs) {
    if (seen.has(r.file)) errors.push(`${r.file} is listed twice`);
    if (!files.includes(r.file)) errors.push(`${r.file} does not exist`);
    if (!r.summary.trim()) errors.push(`${r.file} has no summary`);
    for (const p of r.parents) if (!seen.has(p)) errors.push(`${r.file}: parent ${p} is not listed before it`);
    seen.add(r.file);
  }
  return errors;
}

export interface GraphRow {
  rev: Revision;
  lane: number;               // column the node sits in
  above: (string | null)[];   // what each lane carries into this row (the file it is waiting for)
  below: (string | null)[];   // what each lane carries out of it
}

/** Newest-first rows with lanes, the way `git log --graph` assigns them. Lanes are reused, never shifted. */
export function layoutGraph(revs: Revision[]): GraphRow[] {
  let lanes: (string | null)[] = [];
  const free = (ls: (string | null)[]) => (ls.indexOf(null) === -1 ? ls.length : ls.indexOf(null));
  return [...revs].reverse().map((rev) => {
    const above = lanes;
    const hit = above.indexOf(rev.file);
    const lane = hit === -1 ? free(above) : hit;
    // Every lane that was waiting for this revision ends here; its first parent takes over the node's lane.
    const below = above.map((f) => (f === rev.file ? null : f));
    below[lane] = rev.parents[0] ?? null;
    for (const p of rev.parents.slice(1)) if (!below.includes(p)) below[free(below)] = p;
    while (below.length && below[below.length - 1] === null) below.pop();
    lanes = below;
    return { rev, lane, above, below };
  });
}
