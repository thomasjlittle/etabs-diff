// Start screen: two drop zones, Swap, Compare only when both models are picked, and errors shown in place.
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UploadStart, fileSize, isModelFile } from './UploadStart';

const file = (name: string, text = 'x') => new File([text], name);

function Harness({ onCompare = () => {}, error = null }: { onCompare?: () => void; error?: string | null }) {
  const [a, setA] = useState<File | null>(null);
  const [b, setB] = useState<File | null>(null);
  return <UploadStart original={a} revised={b} onOriginal={setA} onRevised={setB}
    onCompare={onCompare} onSample={() => {}} busy={false} error={error} />;
}

const pick = (label: string, f: File) => fireEvent.change(screen.getByLabelText(`${label} model file`), { target: { files: [f] } });
const compare = () => screen.getByRole('button', { name: 'Compare' }) as HTMLButtonElement;

describe('UploadStart', () => {
  afterEach(cleanup);
  it('Compare is enabled only once both Original and Revised are picked', () => {
    const onCompare = vi.fn();
    render(<Harness onCompare={onCompare} />);
    expect(compare().disabled).toBe(true);
    pick('Original', file('Hack_v01a.e2k'));
    expect(compare().disabled).toBe(true);
    pick('Revised', file('Hack_v04.$ET'));
    expect(compare().disabled).toBe(false);
    fireEvent.click(compare());
    expect(onCompare).toHaveBeenCalledOnce();
  });

  it('shows the picked file name, and Swap exchanges the two', () => {
    render(<Harness />);
    pick('Original', file('v1.e2k'));
    pick('Revised', file('v2.e2k'));
    fireEvent.click(screen.getByRole('button', { name: 'Swap Original and Revised' }));
    expect(screen.getByTestId('drop-Original').textContent).toContain('v2.e2k');
    expect(screen.getByTestId('drop-Revised').textContent).toContain('v1.e2k');
  });

  it('a file that is not .e2k or .$et is refused with a message', () => {
    render(<Harness />);
    pick('Original', file('model.EDB'));
    expect(screen.getByRole('alert').textContent).toContain('model.EDB is not an ETABS text export');
    expect(compare().disabled).toBe(true);
  });

  it('dropping a file onto a zone picks it', () => {
    render(<Harness />);
    fireEvent.drop(screen.getByTestId('drop-Revised'), { dataTransfer: { files: [file('after.e2k')] } });
    expect(screen.getByTestId('drop-Revised').textContent).toContain('after.e2k');
  });

  it('an engine error shows on the start screen', () => {
    render(<Harness error="python3 was not found on PATH." />);
    expect(screen.getByRole('alert').textContent).toContain('Could not compare these models: python3 was not found on PATH.');
  });

  it('helpers: extension check ignores case, sizes read in B / KB / MB', () => {
    expect([isModelFile(file('a.E2K')), isModelFile(file('a.$et')), isModelFile(file('a.json'))]).toEqual([true, true, false]);
    expect([fileSize(500), fileSize(2048), fileSize(3 * 1024 * 1024)]).toEqual(['500 B', '2 KB', '3.0 MB']);
  });
});
