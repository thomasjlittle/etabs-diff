// Loading two real exports through POST /api/diff, with fetch mocked (no backend needed).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import { loadFixtures, loadFromApi, type RawResult } from '../shared/load'
import { UploadControls } from './UploadControls'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const before = new File(['$ before'], 'tower-rev1.e2k')
const after = new File(['$ after'], 'tower-rev2.$et')

/** The sample result as the backend would send it; the parser can't know file names, so they are blank. */
async function backendResult(): Promise<RawResult> {
  const raw = structuredClone(await loadFixtures())
  raw.modelA.meta.file = ''
  raw.modelB.meta.file = ''
  return raw
}

function mockFetch(res: { ok: boolean; status?: number; statusText?: string; body: unknown }) {
  const text = typeof res.body === 'string' ? res.body : JSON.stringify(res.body)
  const fetchMock = vi.fn(async () => ({
    ok: res.ok,
    status: res.status ?? 200,
    statusText: res.statusText ?? '',
    json: async () => JSON.parse(text),
    text: async () => text,
  }) as unknown as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function pick(label: 'Before' | 'After', file: File) {
  fireEvent.change(screen.getByLabelText(`${label} model file`), { target: { files: [file] } })
}

const compareButton = () => screen.getByRole('button', { name: 'Compare' }) as HTMLButtonElement

describe('loadFromApi', () => {
  it('posts the two files as a and b and returns the checked result', async () => {
    const fetchMock = mockFetch({ ok: true, body: await backendResult() })
    const raw = await loadFromApi(before, after)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/diff')
    expect(init.method).toBe('POST')
    const form = init.body as FormData
    expect((form.get('a') as File).name).toBe('tower-rev1.e2k')
    expect((form.get('b') as File).name).toBe('tower-rev2.$et')
    expect(raw.modelA.meta.file).toBe('tower-rev1.e2k')
    expect(raw.modelB.meta.file).toBe('tower-rev2.$et')
  })

  it('a network failure says the backend is not running', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(loadFromApi(before, after)).rejects.toThrow(/backend isn't running on localhost:8000/)
  })

  it('a non-2xx status reports the status and the error text', async () => {
    mockFetch({ ok: false, status: 500, statusText: 'Internal Server Error', body: { detail: 'diff not implemented' } })
    await expect(loadFromApi(before, after)).rejects.toThrow('500 Internal Server Error: diff not implemented')
  })

  it('a non-2xx plain-text body is reported as is', async () => {
    mockFetch({ ok: false, status: 502, body: 'Bad Gateway' })
    await expect(loadFromApi(before, after)).rejects.toThrow('502: Bad Gateway')
  })

  it('a response in the wrong shape uses the checkShape message', async () => {
    mockFetch({ ok: true, body: { modelA: {}, modelB: {}, diff: {} } })
    await expect(loadFromApi(before, after)).rejects.toThrow(/modelA has no frames list; is it schema.py format\?/)
  })
})

describe('upload controls', () => {
  it('Compare stays disabled until both files are chosen', () => {
    render(<UploadControls onLoaded={() => {}} onUseSample={() => {}} usingSample />)
    expect(compareButton().disabled).toBe(true)
    pick('Before', before)
    expect(compareButton().disabled).toBe(true)
    pick('After', after)
    expect(compareButton().disabled).toBe(false)
  })

  it('shows the error from a failed comparison', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    render(<UploadControls onLoaded={() => {}} onUseSample={() => {}} usingSample />)
    pick('Before', before)
    pick('After', after)
    fireEvent.click(compareButton())
    expect((await screen.findByRole('alert')).textContent).toMatch(/backend isn't running on localhost:8000/)
  })
})

describe('app', () => {
  it('shows the sample by default, then the uploaded files after Compare, and back with Use sample', async () => {
    mockFetch({ ok: true, body: await backendResult() })
    render(<App />)
    await screen.findByText(/model-a\.e2k → model-b\.e2k/)
    expect(screen.queryByRole('button', { name: 'Use sample' })).toBeNull()

    pick('Before', before)
    pick('After', after)
    fireEvent.click(compareButton())
    await screen.findByText(/tower-rev1\.e2k → tower-rev2\.\$et/)

    fireEvent.click(screen.getByRole('button', { name: 'Use sample' }))
    await screen.findByText(/model-a\.e2k → model-b\.e2k/)
  })

  it('a new comparison starts with no active filter', async () => {
    mockFetch({ ok: true, body: await backendResult() })
    render(<App />)
    await screen.findByText(/model-a\.e2k → model-b\.e2k/)
    const groups = screen.getByRole('list', { name: 'Change groups' })
    fireEvent.click(groups.querySelector('button')!)
    expect(screen.queryByLabelText('Active filter')).not.toBeNull()

    // Same data as the sample, so the group ids match and a stale filter would still apply.
    pick('Before', before)
    pick('After', after)
    fireEvent.click(compareButton())
    await screen.findByText(/tower-rev1\.e2k → tower-rev2\.\$et/)
    expect(screen.queryByLabelText('Active filter')).toBeNull()
  })
})
