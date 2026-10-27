// Start screen: pick an Original and a Revised model, then Compare. Shown until a comparison is loaded.
import { useRef, useState, type DragEvent } from 'react';

export const MODEL_EXTENSIONS = ['.e2k', '.$et'];

export const isModelFile = (f: File) => MODEL_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext));

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function DropZone({ label, hint, file, onFile }: {
  label: string; hint: string; file: File | null; onFile: (f: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const take = (f: File | undefined) => {
    if (!f) return;
    if (!isModelFile(f)) {
      setRejected(`${f.name} is not an ETABS text export. Choose a .e2k or .$et file.`);
      return;
    }
    setRejected(null);
    onFile(f);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files[0]);
  };

  return (
    <div
      data-testid={`drop-${label}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={`flex min-h-44 flex-1 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center ${
        over ? 'border-blue-500 bg-blue-50' : file ? 'border-slate-400 bg-slate-50' : 'border-slate-300'}`}
    >
      <div className="text-sm font-semibold text-slate-800">{label}</div>
      <div className="text-xs text-slate-500">{hint}</div>
      {file ? (
        <>
          <div className="font-mono text-sm text-slate-900">{file.name}</div>
          <div className="text-xs text-slate-500">{fileSize(file.size)}</div>
          <div className="flex gap-3 text-xs">
            <button className="text-blue-700 underline" onClick={() => input.current?.click()}>Replace</button>
            <button className="text-blue-700 underline" onClick={() => onFile(null)}>Remove</button>
          </div>
        </>
      ) : (
        <>
          <div className="text-xs text-slate-500">Drop a .e2k or .$et file here, or</div>
          <button className="rounded bg-slate-800 px-3 py-1 text-xs text-white hover:bg-slate-700"
            onClick={() => input.current?.click()}>Browse…</button>
        </>
      )}
      {rejected && <p role="alert" className="text-xs text-red-700">{rejected}</p>}
      <input ref={input} type="file" accept={MODEL_EXTENSIONS.join(',')} aria-label={`${label} model file`} className="hidden"
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

export function UploadStart({ original, revised, onOriginal, onRevised, onCompare, onSample, busy, error }: {
  original: File | null; revised: File | null;
  onOriginal: (f: File | null) => void; onRevised: (f: File | null) => void;
  onCompare: () => void; onSample: () => void; busy: boolean; error: string | null;
}) {
  const swap = () => { onOriginal(revised); onRevised(original); };
  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-8">
      <div className="w-full max-w-3xl space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Compare two versions of an ETABS model</h2>
          <p className="text-sm text-slate-500">
            Export each version from ETABS as a text file (.e2k or .$et). Files are compared on this machine and are not kept.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DropZone label="Original" hint="The earlier version (before)" file={original} onFile={onOriginal} />
          <button aria-label="Swap Original and Revised" title="Swap Original and Revised"
            disabled={!original && !revised} onClick={swap}
            className="rounded-full bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200 disabled:opacity-40">⇄</button>
          <DropZone label="Revised" hint="The later version (after)" file={revised} onFile={onRevised} />
        </div>
        {error && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Could not compare these models: {error}
          </p>
        )}
        <div className="flex items-center gap-4">
          <button onClick={onCompare} disabled={!original || !revised || busy}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-40">
            {busy ? 'Comparing models…' : 'Compare'}
          </button>
          <button className="text-sm text-blue-700 underline" onClick={onSample}>or try a sample comparison</button>
        </div>
      </div>
    </div>
  );
}
