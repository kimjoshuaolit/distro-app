// Download all — what goes where (Story 3.4). Pure (no DOM, no network), so
// it's unit-tested in node. Names are the resume key: the same event always
// plans the same folders and file names, so a re-run finds what's already saved.

export type ExportGuest = { guestId: string; firstName: string; joinedAt: string }

export type ExportShot = {
  shotId: string
  guestId: string
  type: 'photo' | 'clip'
  /** When it was taken (capture time, else reservation time) — ISO. */
  takenAt: string
  ext: string
}

export type PlanEntry = {
  shotId: string
  guestName: string
  /** The guest's folder (one path segment). */
  dir: string
  name: string
  type: 'photo' | 'clip'
  takenAt: string
}

/** Names the root already uses; a guest folder never takes them. */
const ROOT_FILES = /^(manifest\.csv|montage(\..*)?)$/i
// Windows refuses these as a file or folder name, with or without an extension.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const MAX_NAME = 60

/**
 * A guest's name as a Windows/macOS-safe folder name: path and wildcard
 * characters and control characters become `_`, whitespace collapses,
 * trailing dots/spaces go, reserved device names get a `_`, empty → "Guest".
 */
export function safeName(raw: string): string {
  let s = raw
    // One spelling per name: macOS treats NFC "Zoë" and NFD "Zoë" as the same folder.
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    .replace(/[. ]+$/, '')
  if (s === '') s = 'Guest'
  if (RESERVED.test(s) || ROOT_FILES.test(s)) s = `${s}_`
  return s
}

/**
 * One folder per guest, decided in join order across ALL of the event's guests
 * (so names never shift between runs): "Sam", then "Sam (2)". Compared
 * case-insensitively — Windows and macOS treat "sam" and "Sam" as one folder.
 */
export function guestFolders(guests: ExportGuest[]): Map<string, string> {
  const ordered = [...guests].sort(
    (a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt) || a.guestId.localeCompare(b.guestId),
  )
  const used = new Set<string>()
  const folders = new Map<string, string>()
  for (const g of ordered) {
    const base = safeName(g.firstName)
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`
    used.add(name.toLowerCase())
    folders.set(g.guestId, name)
  }
  return folders
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-11-14 21.40.05" in this computer's local time (dots: Windows has no ':' in names). */
export function localStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '0000-00-00 00.00.00'
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`
  )
}

const safeExt = (ext: string) => (/^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin')

/** The shot's short tag: the first 4 hex characters of its id. */
const tagOf = (shotId: string) => shotId.replace(/[^0-9a-f]/gi, '').slice(0, 4).toLowerCase() || 'x'

/**
 * Every shot's folder and file name, guests in join order and each guest's
 * shots by when they were taken (then id): `Rosa/2026-11-14 21.40.05 photo 3f2a.jpg`.
 * The tag comes from the shot's own id, so a name never depends on which other
 * shots exist — a late upload can't take the name of a shot already saved.
 * Only a fully identical name (same second, same tag) gets " (2)". A shot whose
 * guest isn't in the list (joined after it was fetched) gets its own
 * "Guest <id>" folder.
 */
export function buildPlan(
  guests: ExportGuest[],
  shots: ExportShot[],
  stamp: (iso: string) => string = localStamp,
): PlanEntry[] {
  const folders = guestFolders(guests)
  const names = new Map(guests.map((g) => [g.guestId, g.firstName]))
  const order = new Map([...folders.keys()].map((id, i) => [id, i]))
  const sorted = [...shots].sort(
    (a, b) =>
      (order.get(a.guestId) ?? Infinity) - (order.get(b.guestId) ?? Infinity) ||
      a.guestId.localeCompare(b.guestId) ||
      Date.parse(a.takenAt) - Date.parse(b.takenAt) ||
      a.shotId.localeCompare(b.shotId),
  )
  const usedIn = new Map<string, Set<string>>()
  return sorted.map((s) => {
    const dir = folders.get(s.guestId) ?? `Guest ${s.guestId.slice(0, 8)}`
    const used = usedIn.get(dir) ?? new Set<string>()
    usedIn.set(dir, used)
    const base = `${stamp(s.takenAt)} ${s.type} ${tagOf(s.shotId)}`
    const ext = safeExt(s.ext)
    let name = `${base}.${ext}`
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n}).${ext}`
    used.add(name.toLowerCase())
    return { shotId: s.shotId, guestName: names.get(s.guestId) ?? 'Guest', dir, name, type: s.type, takenAt: s.takenAt }
  })
}

const FORMULA_START = /^[=+\-@\t\r]/

/**
 * One CSV cell: quoted when needed, and never read as a spreadsheet formula.
 * Free text gets a leading `'`; a path gets `./` instead, so it stays a real path.
 */
function cell(value: string, kind: 'text' | 'path' = 'text'): string {
  const v = FORMULA_START.test(value) ? (kind === 'path' ? `./${value}` : `'${value}`) : value
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * manifest.csv: one row per saved file (guest, path, type, when taken — ISO),
 * plus the montage. UTF-8 with a BOM and CRLF so Excel opens names correctly.
 */
export function manifestCsv(entries: PlanEntry[], montageName: string | null): string {
  const rows = [['guest', 'file', 'type', 'taken_at']]
  for (const e of entries) rows.push([e.guestName, `${e.dir}/${e.name}`, e.type, e.takenAt])
  if (montageName) rows.push(['', montageName, 'montage', ''])
  const line = (r: string[]) => r.map((v, i) => cell(v, i === 1 ? 'path' : 'text')).join(',')
  return '﻿' + rows.map(line).join('\r\n') + '\r\n'
}
