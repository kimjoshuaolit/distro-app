// Loads the film LUT the photo bake develops with. Fetched once and kept; a
// failed load is not kept, so the next shot tries again. The bake never waits
// on the network for long and never fails for want of it (AD-1): without the
// LUT a shot still gets the camera's optics, just not the film colour.
import lutUrl from './film/fuji-fp-100c.bin?url'
import { LUT_BYTES } from './retro.ts'

const LOAD_TIMEOUT_MS = 3000

let loaded: Uint8Array | null = null
let pending: Promise<Uint8Array | null> | null = null

/** Check that bytes are a whole 33-point LUT; anything else is unusable. */
export function asFilmLut(buffer: ArrayBuffer): Uint8Array | null {
  return buffer.byteLength === LUT_BYTES ? new Uint8Array(buffer) : null
}

async function fetchLut(): Promise<Uint8Array | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS)
  try {
    const res = await fetch(lutUrl, { signal: controller.signal })
    return res.ok ? asFilmLut(await res.arrayBuffer()) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** The film LUT, or null if it can't be had right now. Never throws. */
export function loadFilmLut(): Promise<Uint8Array | null> {
  if (loaded) return Promise.resolve(loaded)
  pending ??= fetchLut().then((lut) => {
    loaded = lut
    pending = null
    return lut
  })
  return pending
}
