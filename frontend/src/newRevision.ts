// Add a version to the revision log: rules shared by the form (AddVersion.tsx) and the dev-server route
// (saveRevision.ts), so the browser and the server refuse the same things. Pure, no React, no node.
import type { Revision } from './revisions';

export const SUMMARY_SOFT = 50; // git-style, shown as a counter
export const SUMMARY_MAX = 72; // refused over this
export const SCRUBBED_DIR = 'C:\\Models\\Hackathon\\';
export const NAME_RULE = 'letters, digits, _ . - only, ending in .e2k';

// A Windows user-profile folder and everything under it up to the file name, e.g. C:\Users\jdoe\OneDrive\Proj\.
const USER_DIR = /[A-Za-z]:\\Users\\(?:[^\\\r\n]+\\)+/gi;
// The `$ File ... saved` header and the save log lines are the only places ETABS writes the save path.
const PATH_LINE = /^(\$ File |.* File saved as )/;

/** Replace user-profile folders in the header and save log with SCRUBBED_DIR. Every other line is left as is. */
export function scrubPaths(text: string): { text: string; replaced: number } {
  let replaced = 0;
  const out = text.split('\n').map((line) => (PATH_LINE.test(line)
    ? line.replace(USER_DIR, () => { replaced++; return SCRUBBED_DIR; })
    : line));
  return { text: out.join('\n'), replaced };
}

/** The `File saved as ...` lines of the `$ LOG` section, oldest first, trimmed. */
export const saveLog = (text: string) =>
  text.split('\n').map((l) => l.trim()).filter((l) => / File saved as .+ at /.test(l));

// "10/27/2026 1:13:44 PM" -> "2026-10-27T13:13:44"
function isoDate(stamp: string): string {
  const m = stamp.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ?([AP]M)?/i);
  if (!m) return '';
  const [, mo, d, y, h, mi, s, ap] = m;
  const hour = (Number(h) % 12) + (ap?.toUpperCase() === 'PM' ? 12 : 0);
  const two = (n: string | number) => String(n).padStart(2, '0');
  return `${y}-${two(mo)}-${two(d)}T${two(ap ? hour : h)}:${mi}:${s}`;
}

/**
 * Default date: the `$ File ... saved <time>` header, which is when this file was exported and what the
 * existing manifest dates use; falls back to the newest save in the save log. '' when neither is there.
 */
export function defaultDate(text: string): string {
  const header = text.match(/^\$ File .* saved (.+)$/m);
  return (header && isoDate(header[1])) || isoDate(saveLog(text).at(-1)?.split(' at ').pop() ?? '');
}

/**
 * Suggested parent: the existing version whose save log is the longest prefix of the new file's.
 * An identical log is the same save exported again (Hack_v02 and Hack_v02a); on a tie the version listed
 * first wins. No suggestion (a new root) when no version shares at least one save.
 */
export function suggestParent(newLog: string[], logs: { file: string; log: string[] }[]): string | null {
  let best: { file: string; n: number } | null = null;
  for (const { file, log } of logs) {
    const isPrefix = log.length > 0 && log.length <= newLog.length && log.every((l, i) => l === newLog[i]);
    if (isPrefix && log.length > (best?.n ?? 0)) best = { file, n: log.length };
  }
  return best?.file ?? null;
}

/** Problems with a new revision, empty when it can be saved. `taken` is every model file name already in use. */
export function revisionErrors(r: Revision, existing: Revision[], taken: string[] = []): string[] {
  const errors: string[] = [];
  const known = new Set(existing.map((e) => e.file));
  const used = new Set([...known, ...taken].map((f) => f.toLowerCase()));
  if (!/^[A-Za-z0-9][\w.-]{0,59}\.e2k$/.test(r.file) || r.file.includes('__'))
    errors.push(`File name must be ${NAME_RULE} (no "__", at most 64 characters).`);
  else if (used.has(r.file.toLowerCase())) errors.push(`${r.file} already exists. Pick another file name.`);
  for (const p of r.parents) if (!known.has(p)) errors.push(`Parent ${p} is not in the revision log.`);
  if (new Set(r.parents).size !== r.parents.length) errors.push('A parent is picked twice.');
  if (!r.summary.trim()) errors.push('Write a summary line.');
  else if (r.summary.length > SUMMARY_MAX) errors.push(`Summary is ${r.summary.length} characters; keep it to ${SUMMARY_MAX}.`);
  if (/[\r\n]/.test(r.summary)) errors.push('Summary is one line; put the rest in the body.');
  if (!r.author.trim()) errors.push('Add an author.');
  else if (r.author.length > 100 || /[\r\n]/.test(r.author)) errors.push('Author is one line, at most 100 characters.');
  if (r.body.length > 10_000) errors.push('Body is longer than 10,000 characters.');
  if (r.date && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(r.date)) errors.push('Date must look like 2026-10-27T13:12:24.');
  return errors;
}

/** Model file name for an upload: "Hack_v07.$et" -> "Hack_v07.e2k" (same text format, and diffs read *.e2k). */
export const modelFileName = (upload: string) => upload.replace(/\.(e2k|\$et)$/i, '') + '.e2k';
