// Drag handle between two panes. Drag to resize; the optional button hides or shows the pane.
// Window listeners (not pointer capture) so a drag keeps going over the 3D canvases.
import { useRef } from 'react';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function Splitter({ dir, onDrag, label, open, onToggle, arrows }: {
  dir: 'x' | 'y';                 // x: vertical bar dragged sideways; y: horizontal bar dragged up/down
  onDrag: (delta: number) => void; // pixels moved since the last call
  label: string;                   // pane name, for the button and screen readers
  open?: boolean;
  onToggle?: () => void;
  arrows?: [string, string];       // [shown when open, shown when hidden]
}) {
  const last = useRef(0);
  const start = (e: React.PointerEvent) => {
    if (open === false) return; // nothing to resize while hidden
    e.preventDefault();
    last.current = dir === 'x' ? e.clientX : e.clientY;
    const move = (m: PointerEvent) => {
      const p = dir === 'x' ? m.clientX : m.clientY;
      onDrag(p - last.current);
      last.current = p;
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = dir === 'x' ? 'col-resize' : 'row-resize';
  };
  return (
    <div
      role="separator"
      aria-orientation={dir === 'x' ? 'vertical' : 'horizontal'}
      aria-label={`Resize ${label}`}
      onPointerDown={start}
      className={`group relative z-10 flex shrink-0 items-center justify-center bg-slate-200 hover:bg-slate-400 ${
        dir === 'x' ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'} ${open === false ? 'cursor-default' : ''}`}
    >
      {onToggle && arrows && (
        <button
          aria-label={`${open ? 'Hide' : 'Show'} ${label}`}
          title={`${open ? 'Hide' : 'Show'} ${label}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggle}
          className={`absolute flex items-center justify-center rounded border border-slate-300 bg-white text-xs leading-none text-slate-600 shadow-sm hover:bg-slate-100 ${
            dir === 'x' ? 'h-8 w-4' : 'h-4 w-8'}`}
        >
          {open ? arrows[0] : arrows[1]}
        </button>
      )}
    </div>
  );
}
