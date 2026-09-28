// Download all — the run (Story 3.4). Pure scheduling with every side effect
// injected (signing, the folder, the network), so it's unit-tested in node;
// DownloadAll.tsx wires it to the File System Access API.
//
// Links are signed just in time, a batch at a time (they live 10 minutes and
// the whole event can be gigabytes). A file already saved is skipped, never
// overwritten; a failure is re-signed and retried once, then counted, and a
// re-run picks it up.
import { manifestCsv, type PlanEntry } from './exportPlan'

/**
 * Files per signing call: two rounds of the pool, so every link in a batch is
 * used within a couple of downloads of being signed — well inside its 10
 * minutes even for clips on a slow line (and a stale one is re-signed once).
 */
export const SIGN_BATCH = 8
/** Downloads at a time. */
export const CONCURRENCY = 4

export type Signed = { urls: Record<string, string>; montage?: { url: string; ext: string } | null }

export type ExportProgress = {
  total: number
  /** Saved + skipped + failed so far. */
  done: number
  saved: number
  /** Already in the folder. */
  skipped: number
  failed: number
  bytes: number
}

export type ExportSummary = ExportProgress & {
  cancelled: boolean
  /** Signing was unreachable, so the run stopped early (instead of failing every file). */
  halted: boolean
  /** Shots that couldn't be saved this run (left out of the manifest). */
  failedIds: Set<string>
  /** The montage's saved name, if there is one (saved now or earlier). */
  montageName: string | null
}

export type ExportDeps = {
  /** Sign shot ids (≤ SIGN_BATCH), and the montage when asked. Throws on failure. */
  sign: (shotIds: string[], montage: boolean) => Promise<Signed>
  /** Is `name` already saved (and non-empty) in `dir` ('' = the chosen folder)? */
  exists: (dir: string, name: string) => Promise<boolean>
  /** Stream `url` into `dir/name`; resolves with bytes written. Throws on failure. */
  download: (url: string, dir: string, name: string, signal: AbortSignal) => Promise<number>
  onProgress: (progress: ExportProgress) => void
  signal: AbortSignal
  includeMontage: boolean
}

/** Run `task` over `items`, `limit` at a time; stops taking new items once aborted. */
async function pool<T>(items: T[], limit: number, signal: AbortSignal, task: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (!signal.aborted && next < items.length) await task(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export async function runExport(plan: PlanEntry[], deps: ExportDeps): Promise<ExportSummary> {
  const { signal } = deps
  const progress: ExportProgress = {
    total: plan.length + (deps.includeMontage ? 1 : 0),
    done: 0,
    saved: 0,
    skipped: 0,
    failed: 0,
    bytes: 0,
  }
  const failedIds = new Set<string>()
  const report = () => deps.onProgress({ ...progress })
  const tally = (kind: 'saved' | 'skipped' | 'failed', bytes = 0) => {
    progress[kind]++
    progress.done++
    progress.bytes += bytes
    report()
  }

  /** Sign, tolerating one failed call; null = signing is down for this batch. */
  const signOnce = async (ids: string[], montage: boolean): Promise<Signed | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) return null
      try {
        return await deps.sign(ids, montage)
      } catch {
        // one more try
      }
    }
    return null
  }

  /** Download one file: bytes written, or null on failure (never throws). */
  const tryDownload = async (url: string | undefined, dir: string, name: string): Promise<number | null> => {
    if (!url || signal.aborted) return null
    try {
      return await deps.download(url, dir, name, signal)
    } catch {
      return null
    }
  }

  let halted = false
  report()
  for (let i = 0; i < plan.length && !signal.aborted && !halted; i += SIGN_BATCH) {
    const batch = plan.slice(i, i + SIGN_BATCH)
    const missing: PlanEntry[] = []
    for (const e of batch) {
      if (signal.aborted) break
      if (await deps.exists(e.dir, e.name).catch(() => false)) tally('skipped')
      else missing.push(e)
    }
    if (missing.length === 0 || signal.aborted) continue

    const signed = await signOnce(missing.map((e) => e.shotId), false)
    if (signed === null) {
      // Signing is down (or the session ended): stop rather than fail every
      // remaining file one batch at a time. A re-run carries on from here.
      if (!signal.aborted) halted = true
      break
    }
    const retry: PlanEntry[] = []
    await pool(missing, CONCURRENCY, signal, async (e) => {
      const bytes = await tryDownload(signed?.urls[e.shotId], e.dir, e.name)
      if (bytes !== null) tally('saved', bytes)
      else if (!signal.aborted) retry.push(e)
    })
    if (retry.length === 0 || signal.aborted) continue

    // One more go with fresh links (an expired link or a network blip).
    const fresh = await signOnce(retry.map((e) => e.shotId), false)
    await pool(retry, CONCURRENCY, signal, async (e) => {
      const bytes = await tryDownload(fresh?.urls[e.shotId], e.dir, e.name)
      if (bytes !== null) tally('saved', bytes)
      else if (!signal.aborted) {
        failedIds.add(e.shotId)
        tally('failed')
      }
    })
  }

  let montageName: string | null = null
  if (deps.includeMontage && !signal.aborted && !halted) {
    let saved = false
    for (let attempt = 0; attempt < 2 && !saved && !signal.aborted; attempt++) {
      const signed = await signOnce([], true)
      if (signed && signed.montage === null) {
        // Nothing hosted: nothing to save, and nothing failed.
        progress.total--
        report()
        saved = true
        break
      }
      const m = signed?.montage
      if (!m) continue
      const name = `montage.${/^[a-z0-9]{1,8}$/.test(m.ext) ? m.ext : 'mp4'}`
      if (await deps.exists('', name).catch(() => false)) {
        montageName = name
        tally('skipped')
        saved = true
        break
      }
      const bytes = await tryDownload(m.url, '', name)
      if (bytes !== null) {
        montageName = name
        tally('saved', bytes)
        saved = true
      }
    }
    if (!saved && !signal.aborted) tally('failed')
  }

  return { ...progress, cancelled: signal.aborted, halted, failedIds, montageName }
}

/**
 * The manifest to write after a run, or null for none: only a run that went
 * all the way through (not cancelled, not halted, something to list) writes
 * one, and it lists only files that are actually in the folder — never a shot
 * that failed this time.
 */
export function manifestFor(plan: PlanEntry[], summary: ExportSummary): string | null {
  if (summary.cancelled || summary.halted || summary.total === 0) return null
  return manifestCsv(
    plan.filter((e) => !summary.failedIds.has(e.shotId)),
    summary.montageName,
  )
}
