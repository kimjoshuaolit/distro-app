import { describe, it, expect, vi } from 'vitest'
import type { PlanEntry } from './exportPlan'
import { CONCURRENCY, manifestFor, runExport, SIGN_BATCH, type ExportDeps, type ExportProgress, type Signed } from './exportRunner'

const entry = (n: number, dir = 'Rosa'): PlanEntry => ({
  shotId: `s${n}`,
  guestName: dir,
  dir,
  name: `${n}.jpg`,
  type: 'photo',
  takenAt: '2026-11-14T21:00:00Z',
})
const plan = (count: number) => Array.from({ length: count }, (_, i) => entry(i + 1))

/** A fake folder + server. `saved` holds "dir/name" of files on disk. */
function world(opts: { saved?: string[]; failOnce?: string[]; failAlways?: string[]; montage?: Signed['montage'] } = {}) {
  const saved = new Set(opts.saved ?? [])
  const failedOnce = new Set<string>()
  const signCalls: Array<[string[], boolean]> = []
  let generation = 0
  let inFlight = 0
  let maxInFlight = 0
  const sign = vi.fn(async (ids: string[], montage: boolean): Promise<Signed> => {
    signCalls.push([ids, montage])
    generation++
    const out: Signed = { urls: Object.fromEntries(ids.map((id) => [id, `https://r2/${id}?g=${generation}`])) }
    if (montage) out.montage = opts.montage === undefined ? { url: 'https://r2/montage', ext: 'mp4' } : opts.montage
    return out
  })
  const download = vi.fn(async (url: string, dir: string, name: string, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await Promise.resolve()
    inFlight--
    const id = /r2\/([^?]+)/.exec(url)![1]
    if (opts.failAlways?.includes(id)) throw new Error('403')
    if (opts.failOnce?.includes(id) && !failedOnce.has(id)) {
      failedOnce.add(id)
      throw new Error('expired')
    }
    saved.add(dir ? `${dir}/${name}` : name)
    return 100
  })
  const exists = vi.fn(async (dir: string, name: string) => saved.has(dir ? `${dir}/${name}` : name))
  const progress: ExportProgress[] = []
  const controller = new AbortController()
  const deps = (over: Partial<ExportDeps> = {}): ExportDeps => ({
    sign,
    exists,
    download,
    onProgress: (p) => progress.push(p),
    signal: controller.signal,
    includeMontage: false,
    ...over,
  })
  return { saved, sign, signCalls, download, exists, progress, controller, deps, maxInFlight: () => maxInFlight }
}

describe('runExport', () => {
  it('saves everything into an empty folder, signing in batches, a few at a time', async () => {
    const w = world()
    const summary = await runExport(plan(SIGN_BATCH + 5), w.deps({ includeMontage: true }))
    expect(summary).toMatchObject({ total: SIGN_BATCH + 6, saved: SIGN_BATCH + 6, skipped: 0, failed: 0, bytes: (SIGN_BATCH + 6) * 100, cancelled: false, montageName: 'montage.mp4' })
    expect(w.saved.has('Rosa/1.jpg') && w.saved.has('montage.mp4')).toBe(true)
    expect(w.signCalls.map(([ids, m]) => [ids.length, m])).toEqual([[SIGN_BATCH, false], [5, false], [0, true]])
    expect(w.maxInFlight()).toBeLessThanOrEqual(CONCURRENCY)
    expect(w.maxInFlight()).toBeGreaterThan(1)
    expect(w.progress.at(-1)).toMatchObject({ done: SIGN_BATCH + 6 })
  })

  it('a re-run downloads only what is missing and never touches saved files', async () => {
    const w = world({ saved: ['Rosa/1.jpg', 'Rosa/2.jpg', 'montage.mp4'] })
    const summary = await runExport(plan(4), w.deps({ includeMontage: true }))
    expect(summary).toMatchObject({ saved: 2, skipped: 3, failed: 0, montageName: 'montage.mp4' })
    expect(w.download.mock.calls.map((c) => c[2])).toEqual(expect.arrayContaining(['3.jpg', '4.jpg']))
    expect(w.download).toHaveBeenCalledTimes(2)
    expect(w.signCalls[0][0]).toEqual(['s3', 's4']) // only the missing ones get links
  })

  it('an everything-saved re-run signs nothing', async () => {
    const w = world({ saved: ['Rosa/1.jpg', 'Rosa/2.jpg'] })
    const summary = await runExport(plan(2), w.deps())
    expect(summary).toMatchObject({ saved: 0, skipped: 2 })
    expect(w.sign).not.toHaveBeenCalled()
  })

  it('a failed file is re-signed and retried once', async () => {
    const w = world({ failOnce: ['s2'] })
    const summary = await runExport(plan(3), w.deps())
    expect(summary).toMatchObject({ saved: 3, failed: 0 })
    expect(w.signCalls.map(([ids]) => ids)).toEqual([['s1', 's2', 's3'], ['s2']])
    expect(w.download.mock.calls.filter((c) => c[0].startsWith('https://r2/s2')).map((c) => c[0])).toEqual([
      'https://r2/s2?g=1',
      'https://r2/s2?g=2', // a fresh link
    ])
  })

  it('a file that keeps failing is counted, and the run carries on', async () => {
    const w = world({ failAlways: ['s1'] })
    const summary = await runExport(plan(3), w.deps())
    expect(summary).toMatchObject({ saved: 2, failed: 1, done: 3 })
    expect([...summary.failedIds]).toEqual(['s1'])
  })

  it('a signing outage halts the run (after one retry) instead of failing every file', async () => {
    const w = world()
    const sign = vi.fn().mockRejectedValue(new Error('500'))
    const summary = await runExport(plan(SIGN_BATCH * 3), w.deps({ sign, includeMontage: true }))
    expect(summary).toMatchObject({ saved: 0, failed: 0, halted: true, cancelled: false, montageName: null })
    expect(sign).toHaveBeenCalledTimes(2) // the first batch, tried twice — then stop
    expect(w.download).not.toHaveBeenCalled()
  })

  it('a montage that keeps failing is counted as failed (never "nothing hosted")', async () => {
    const w = world({ failAlways: ['montage'] })
    const summary = await runExport(plan(1), w.deps({ includeMontage: true }))
    expect(summary).toMatchObject({ total: 2, done: 2, saved: 1, failed: 1, montageName: null })
    expect(w.signCalls.filter(([, m]) => m)).toHaveLength(2) // tried twice with fresh links
  })

  it('a montage that fails once is re-signed and saved', async () => {
    const w = world({ failOnce: ['montage'] })
    const summary = await runExport([], w.deps({ includeMontage: true }))
    expect(summary).toMatchObject({ total: 1, saved: 1, failed: 0, montageName: 'montage.mp4' })
  })

  it('a folder check that throws counts as "not saved" (downloads it)', async () => {
    const w = world()
    const exists = vi.fn().mockRejectedValue(new Error('TypeMismatch'))
    const summary = await runExport(plan(1), w.deps({ exists }))
    expect(summary).toMatchObject({ saved: 1, skipped: 0 })
  })

  it('no montage hosted: nothing to save, nothing failed', async () => {
    const w = world({ montage: null })
    const summary = await runExport(plan(1), w.deps({ includeMontage: true }))
    expect(summary).toMatchObject({ total: 1, saved: 1, failed: 0, montageName: null })
  })

  it('nothing uploaded and no montage: an empty, successful run', async () => {
    const w = world({ montage: null })
    const summary = await runExport([], w.deps({ includeMontage: true }))
    expect(summary).toMatchObject({ total: 0, done: 0, saved: 0, failed: 0, cancelled: false })
  })

  it('the manifest lists only files in the folder, and only after a complete run', async () => {
    const entries = plan(3)
    const base = { total: 4, done: 4, saved: 3, skipped: 0, failed: 1, bytes: 0, cancelled: false, halted: false, montageName: 'montage.mp4' }
    const csv = manifestFor(entries, { ...base, failedIds: new Set(['s2']) })!
    expect(csv).toContain('Rosa/1.jpg')
    expect(csv).not.toContain('Rosa/2.jpg') // failed this run: not in the folder
    expect(csv).toContain('montage.mp4')
    expect(manifestFor(entries, { ...base, failedIds: new Set(), cancelled: true })).toBeNull()
    expect(manifestFor(entries, { ...base, failedIds: new Set(), halted: true })).toBeNull()
    expect(manifestFor([], { ...base, total: 0, failedIds: new Set() })).toBeNull()
  })

  it('Cancel stops scheduling new work', async () => {
    const w = world()
    let calls = 0
    const download: ExportDeps['download'] = async (url, dir, name, signal) => {
      if (++calls === 2) w.controller.abort()
      return w.download(url, dir, name, signal)
    }
    const summary = await runExport(plan(SIGN_BATCH * 2), w.deps({ download, includeMontage: true }))
    expect(summary.cancelled).toBe(true)
    expect(summary.saved).toBeLessThan(SIGN_BATCH)
    expect(w.signCalls).toHaveLength(1) // the second batch and the montage never start
    expect(summary.failed).toBe(0) // cancelled work isn't "failed"
  })
})
