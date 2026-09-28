import { useEffect, useRef, useState } from 'react'
import { ExportError, getParticipation, issueExportUrls, listExportShots, OperatorReadError } from '../lib/operatorApi'
import { buildPlan } from './exportPlan'
import { manifestFor, runExport, type ExportProgress, type ExportSummary } from './exportRunner'
import './DownloadAll.css'

// The File System Access API's folder picker (Chrome / Edge on desktop). Not
// in TypeScript's DOM lib yet, so declared here.
type DirectoryPicker = (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
const picker = (): DirectoryPicker | null => {
  const fn = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
  return typeof fn === 'function' ? fn.bind(window) : null
}

type WakeLock = { release: () => Promise<void> }
const requestWakeLock = async (): Promise<WakeLock | null> => {
  try {
    const api = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLock> } }).wakeLock
    return (await api?.request('screen')) ?? null
  } catch {
    return null // not supported / not allowed: the tab just has to stay awake on its own
  }
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'running'; progress: ExportProgress }
  | { kind: 'done'; summary: ExportSummary; manifestFailed: boolean }
  | { kind: 'error'; message: string }

/** Marks the folder as this event's, so two events never mix in one folder. */
const MARKER = '.dispo-retro-cam-event'
/** A download that sends nothing for this long is dropped (and retried once). */
const IDLE_TIMEOUT_MS = 60_000

const count = (n: number) => n.toLocaleString()

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** The folder's subfolder (created when asked), or the folder itself for ''. */
async function folder(root: FileSystemDirectoryHandle, dir: string, create: boolean) {
  return dir ? root.getDirectoryHandle(dir, { create }) : root
}

/** Is `dir/name` already saved? A zero-byte file (a download that failed) doesn't count. */
async function savedAlready(root: FileSystemDirectoryHandle, dir: string, name: string): Promise<boolean> {
  try {
    const file = await (await (await folder(root, dir, false)).getFileHandle(name)).getFile()
    return file.size > 0
  } catch {
    return false
  }
}

/**
 * Stream one signed GET straight into `dir/name`. The writable commits only on
 * success (an aborted one is discarded), so a saved file is always complete: a
 * body shorter than its Content-Length, or one that stalls for a minute, fails
 * instead of being committed.
 */
async function streamTo(root: FileSystemDirectoryHandle, url: string, dir: string, name: string, signal: AbortSignal) {
  const local = new AbortController()
  const stop = () => local.abort()
  signal.addEventListener('abort', stop)
  let idle = window.setTimeout(stop, IDLE_TIMEOUT_MS)
  const poke = () => {
    window.clearTimeout(idle)
    idle = window.setTimeout(stop, IDLE_TIMEOUT_MS)
  }
  try {
    const res = await fetch(url, { signal: local.signal })
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {})
      throw new Error(`GET failed (${res.status})`)
    }
    // Content-Length counts encoded bytes; only compare when the body isn't encoded.
    const encoding = res.headers.get('content-encoding')
    const expected = !encoding || encoding === 'identity' ? Number(res.headers.get('content-length') ?? NaN) : NaN
    let writable: FileSystemWritableFileStream
    try {
      const handle = await (await folder(root, dir, true)).getFileHandle(name, { create: true })
      writable = await handle.createWritable()
    } catch (err) {
      await res.body.cancel().catch(() => {})
      throw err
    }
    let bytes = 0
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        poke()
        controller.enqueue(chunk)
      },
      flush() {
        if (Number.isFinite(expected) && bytes !== expected) throw new Error(`Short body (${bytes}/${expected})`)
      },
    })
    await res.body.pipeThrough(counter).pipeTo(writable, { signal: local.signal })
    return bytes
  } finally {
    window.clearTimeout(idle)
    signal.removeEventListener('abort', stop)
  }
}

async function readText(root: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    return await (await (await root.getFileHandle(name)).getFile()).text()
  } catch {
    return null
  }
}

async function writeText(root: FileSystemDirectoryHandle, name: string, text: string) {
  const writable = await (await root.getFileHandle(name, { create: true })).createWritable()
  await writable.write(text)
  await writable.close()
}

const isSessionError = (err: unknown) =>
  (err instanceof ExportError && err.code === 'not_operator') ||
  (err instanceof OperatorReadError && (err.status === 401 || err.status === 403))

/**
 * Download all (Story 3.4) on the O2 dashboard: pick a folder and every
 * uploaded shot streams into one folder per guest, plus the hosted montage and
 * manifest.csv. Re-running skips what's already saved.
 */
export default function DownloadAll({ eventId }: { eventId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [signedOut, setSignedOut] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const running = phase.kind === 'preparing' || phase.kind === 'running'

  // Leaving mid-run would drop the rest: ask first. Stop cleanly on unmount.
  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])
  useEffect(() => () => controllerRef.current?.abort(), [])

  // Keep the laptop awake while running. Browsers drop the lock when the tab
  // is hidden, so take it again on the way back.
  useEffect(() => {
    if (!running) return
    let lock: WakeLock | null = null
    let live = true
    const take = async () => {
      if (document.visibilityState !== 'visible') return
      const next = await requestWakeLock()
      if (live) lock = next
      else await next?.release().catch(() => {})
    }
    void take()
    document.addEventListener('visibilitychange', take)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', take)
      void lock?.release().catch(() => {})
    }
  }, [running])

  const pick = picker()
  if (!pick) {
    return (
      <section className="op__window dl" aria-labelledby="dlHeading">
        <h2 id="dlHeading" className="op__h2">
          Download all
        </h2>
        <p className="op__body">
          Saving every roll needs <strong>Chrome or Edge on a laptop</strong> — this browser can’t write to a folder.
        </p>
      </section>
    )
  }

  async function start() {
    if (running || !pick) return
    let root: FileSystemDirectoryHandle
    try {
      root = await pick({ id: 'dispo-download-all', mode: 'readwrite' })
    } catch {
      return // picker closed: nothing to do
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setSignedOut(false)
    setPhase({ kind: 'preparing' })
    try {
      // One event per folder: a folder another event's download already
      // claimed would mix guests and skip this event's montage.
      const owner = (await readText(root, MARKER))?.trim()
      if (owner && owner !== eventId) {
        setPhase({
          kind: 'error',
          message: 'That folder already holds another event’s download — pick an empty folder (or that event’s).',
        })
        return
      }
      if (!owner) await writeText(root, MARKER, `${eventId}\n`)

      // Shots first, then guests: every listed shot's guest has joined by then.
      const shots = await listExportShots(eventId)
      const guests = await getParticipation(eventId)
      const plan = buildPlan(
        guests.map((g) => ({ guestId: g.guestId, firstName: g.firstName, joinedAt: g.joinedAt })),
        shots,
      )
      const summary = await runExport(plan, {
        sign: async (ids, montage) => {
          try {
            return await issueExportUrls(eventId, ids, montage)
          } catch (err) {
            if (isSessionError(err)) {
              setSignedOut(true)
              controller.abort() // no point trying the rest
            }
            throw err
          }
        },
        exists: (dir, name) => savedAlready(root, dir, name),
        download: (url, dir, name, signal) => streamTo(root, url, dir, name, signal),
        onProgress: (progress) => setPhase({ kind: 'running', progress }),
        signal: controller.signal,
        includeMontage: true,
      })
      let manifestFailed = false
      const manifest = manifestFor(plan, summary)
      if (manifest !== null) {
        try {
          await writeText(root, 'manifest.csv', manifest)
        } catch {
          manifestFailed = true // e.g. open in Excel (Windows locks it) — the files are fine
        }
      }
      setPhase({ kind: 'done', summary, manifestFailed })
    } catch (err) {
      if (isSessionError(err)) {
        setSignedOut(true)
        setPhase({ kind: 'idle' })
        return
      }
      const denied = err instanceof DOMException && err.name === 'NotAllowedError'
      setPhase({
        kind: 'error',
        message: denied
          ? 'The browser didn’t allow saving to that folder — try again and choose “Allow”.'
          : 'Couldn’t start the download — check your connection and try again.',
      })
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }

  return (
    <section className="op__window dl" aria-labelledby="dlHeading">
      <h2 id="dlHeading" className="op__h2">
        Download all
      </h2>
      <p className="op__body">
        Every uploaded photo and clip, one folder per guest, plus the montage and a <code>manifest.csv</code>. Running
        it again only adds what’s new.
      </p>

      {phase.kind === 'preparing' && (
        <p className="op__body" role="status">
          Listing everything…
        </p>
      )}

      {phase.kind === 'running' && (
        <div className="dl__progress">
          <progress value={phase.progress.done} max={Math.max(phase.progress.total, 1)} aria-label="Download progress" />
          <p className="op__body">
            {count(phase.progress.done)} of {count(phase.progress.total)} files · {size(phase.progress.bytes)}
          </p>
          <p className="op__hint">Keep this tab open until it finishes.</p>
        </div>
      )}

      {signedOut ? (
        <p className="op__notice" role="alert">
          Your sign-in has ended — sign out, sign back in, and run it again. Files already saved stay put.
        </p>
      ) : (
        phase.kind === 'done' && <Summary summary={phase.summary} manifestFailed={phase.manifestFailed} />
      )}

      {phase.kind === 'error' && (
        <p className="op__notice" role="alert">
          {phase.message}
        </p>
      )}

      <div className="op__actions op__actions--tight">
        {running ? (
          <button type="button" className="op__secondary" onClick={() => controllerRef.current?.abort()}>
            Cancel
          </button>
        ) : (
          <button type="button" className="op__primary" onClick={start}>
            {phase.kind === 'done' ? 'Download again' : 'Download all'}
          </button>
        )}
      </div>
    </section>
  )
}

function Summary({ summary, manifestFailed }: { summary: ExportSummary; manifestFailed: boolean }) {
  if (summary.halted) {
    return (
      <p className="op__notice" role="alert">
        Couldn’t get download links — check your connection and run it again ({count(summary.saved)} new files saved
        so far).
      </p>
    )
  }
  if (summary.cancelled) {
    return (
      <p className="op__body" role="status">
        Stopped after {count(summary.saved)} new files. Run it again to pick up where you left off.
      </p>
    )
  }
  if (summary.total === 0) {
    return (
      <p className="op__body" role="status">
        Nothing to download yet — no shots have been uploaded.
      </p>
    )
  }
  const parts = [`Saved ${count(summary.saved)}`]
  if (summary.skipped > 0) parts.push(`${count(summary.skipped)} already there`)
  return (
    <>
      <p className="op__body" role="status">
        {parts.join(' · ')} ({size(summary.bytes)}).
      </p>
      {summary.failed > 0 && (
        <p className="op__notice" role="alert">
          {count(summary.failed)} couldn’t be saved — run it again to retry them.
        </p>
      )}
      {manifestFailed && (
        <p className="op__notice" role="alert">
          Couldn’t update <code>manifest.csv</code> — if it’s open in Excel, close it and run again. The photos and
          clips are saved.
        </p>
      )}
    </>
  )
}
