// The retro "bake" (AD-8): warm grade + grain + burned-in event-local date
// stamp, composited into a compressed JPEG. Pixel transforms are pure and
// deterministic (unit-tested); the canvas orchestration is DOM-only.

// Tuning surface — adjust against real device output (AD-8 assumption).
export const RETRO = {
  maxEdge: 1600, // long-edge downscale target
  jpegQuality: 0.82,
  warmR: 1.06, // channel multipliers for a warm FunSaver grade
  warmG: 1.01,
  warmB: 0.92,
  lift: 8, // lift shadows a touch for a faded-film look
  grain: 14, // +/- noise range
} as const

/** Warm color grade + shadow lift, in place. Uint8ClampedArray clamps on store. */
export function applyWarmGrade(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i] * RETRO.warmR + RETRO.lift
    data[i + 1] = data[i + 1] * RETRO.warmG + RETRO.lift
    data[i + 2] = data[i + 2] * RETRO.warmB + RETRO.lift
  }
}

// Small, fast, seedable PRNG so grain is deterministic per shot (testable).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Add luminance grain in place, deterministic for a given seed. */
export function applyGrain(data: Uint8ClampedArray, seed: number): void {
  const rand = mulberry32(seed)
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() * 2 - 1) * RETRO.grain
    data[i] += n
    data[i + 1] += n
    data[i + 2] += n
  }
}

/** Event-local date, disposable-camera style: `'26 09 19`. */
export function formatStamp(date: Date): string {
  const yy = String(date.getFullYear()).slice(2)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `'${yy} ${mm} ${dd}`
}

/** Draw the glowing orange date stamp, bottom-right. */
export function drawDateStamp(ctx: CanvasRenderingContext2D, date: Date, w: number, h: number): void {
  const size = Math.max(12, Math.round(h * 0.035))
  ctx.save()
  ctx.font = `${size}px "Courier New", monospace`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.shadowColor = 'rgba(255, 138, 30, 0.9)'
  ctx.shadowBlur = size * 0.6
  ctx.fillStyle = '#FF8A1E'
  ctx.fillText(formatStamp(date), w - size, h - size)
  ctx.restore()
}

type PhotoSource = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement

function sourceSize(src: PhotoSource): { w: number; h: number } {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight }
  if (src instanceof HTMLCanvasElement) return { w: src.width, h: src.height }
  return { w: src.naturalWidth, h: src.naturalHeight }
}

/** Draw the source, bake the retro look, and export a compressed JPEG blob. */
export async function bakePhoto(
  source: PhotoSource,
  opts: { date: Date; seed?: number },
): Promise<Blob> {
  const { w: sw, h: sh } = sourceSize(source)
  if (!sw || !sh) throw new Error('Camera frame not ready')
  const scale = Math.min(1, RETRO.maxEdge / Math.max(sw, sh))
  const w = Math.round(sw * scale)
  const h = Math.round(sh * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')

  ctx.drawImage(source, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  applyWarmGrade(img.data)
  applyGrain(img.data, opts.seed ?? (Date.now() >>> 0))
  ctx.putImageData(img, 0, 0)
  drawDateStamp(ctx, opts.date, w, h)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      RETRO.jpegQuality,
    )
  })
}
