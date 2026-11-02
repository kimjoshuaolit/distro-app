// The retro "bake" (AD-8): an Instax Mini-style print look (bright, soft,
// milky shadows, cool shadows and creamy highlights, corner falloff, fine
// grain), cropped to the Instax image shape and composited into a compressed
// JPEG. Pixel transforms are pure and deterministic (unit-tested); the canvas
// orchestration is DOM-only.

// Tuning surface — adjust against real device output (AD-8 assumption).
export const RETRO = {
  maxEdge: 1600, // long-edge downscale target
  jpegQuality: 0.82,
  aspect: 46 / 62, // Instax Mini image area, short edge over long edge
  gamma: 0.85, // < 1 brightens the mids: Instax prints run bright
  black: 24, // milky shadows: true black prints as a soft charcoal
  white: 250, // highlights bloom to a creamy white rather than clip
  saturation: 0.88,
  shadowTint: [-6, 2, 10], // RGB pushed into the shadows: cool cyan
  highlightTint: [4, 2, -4], // RGB pushed into the highlights: cream
  vignette: 0.18, // brightness lost in the far corners
  grain: 8, // +/- noise range: finer than a disposable's
} as const

// The tone curve as a lookup: 256 entries beats a Math.pow per channel.
const TONE = Array.from(
  { length: 256 },
  (_, v) => RETRO.black + (RETRO.white - RETRO.black) * (v / 255) ** RETRO.gamma,
)

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** Instax colour: soften saturation, run the tone curve, split-tone by brightness. */
export function applyInstaxGrade(data: Uint8ClampedArray): void {
  const [sr, sg, sb] = RETRO.shadowTint
  const [hr, hg, hb] = RETRO.highlightTint
  for (let i = 0; i < data.length; i += 4) {
    const l = luma(data[i], data[i + 1], data[i + 2])
    const r = TONE[Math.round(Math.min(255, Math.max(0, l + (data[i] - l) * RETRO.saturation)))]
    const g = TONE[Math.round(Math.min(255, Math.max(0, l + (data[i + 1] - l) * RETRO.saturation)))]
    const b = TONE[Math.round(Math.min(255, Math.max(0, l + (data[i + 2] - l) * RETRO.saturation)))]
    const t = luma(r, g, b) / 255
    const s = (1 - t) ** 2
    const h = t ** 2
    data[i] = r + sr * s + hr * h
    data[i + 1] = g + sg * s + hg * h
    data[i + 2] = b + sb * s + hb * h
  }
}

/** Darken toward the corners, gently: barely touches the middle of the frame. */
export function applyVignette(data: Uint8ClampedArray, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const dy = (y + 0.5) / h - 0.5
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5) / w - 0.5
      const d = 2 * (dx * dx + dy * dy) // 0 at the centre, ~1 in a corner
      const k = 1 - RETRO.vignette * d * d
      const i = (y * w + x) * 4
      data[i] *= k
      data[i + 1] *= k
      data[i + 2] *= k
    }
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

/** The centred Instax-shaped crop of a frame, keeping the frame's orientation. */
export function instaxCrop(w: number, h: number): { x: number; y: number; w: number; h: number } {
  const target = w > h ? 1 / RETRO.aspect : RETRO.aspect
  if (w / h > target) {
    const cw = Math.round(h * target)
    return { x: Math.floor((w - cw) / 2), y: 0, w: cw, h }
  }
  const ch = Math.round(w / target)
  return { x: 0, y: Math.floor((h - ch) / 2), w, h: ch }
}

type PhotoSource = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement

function sourceSize(src: PhotoSource): { w: number; h: number } {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight }
  if (src instanceof HTMLCanvasElement) return { w: src.width, h: src.height }
  return { w: src.naturalWidth, h: src.naturalHeight }
}

/** Crop and draw the source, bake the Instax look, and export a compressed JPEG blob. */
export async function bakePhoto(source: PhotoSource, opts: { seed?: number } = {}): Promise<Blob> {
  const { w: sw, h: sh } = sourceSize(source)
  if (!sw || !sh) throw new Error('Camera frame not ready')
  const crop = instaxCrop(sw, sh)
  const scale = Math.min(1, RETRO.maxEdge / Math.max(crop.w, crop.h))
  const w = Math.round(crop.w * scale)
  const h = Math.round(crop.h * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')

  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  applyInstaxGrade(img.data)
  applyVignette(img.data, w, h)
  applyGrain(img.data, opts.seed ?? (Date.now() >>> 0))
  ctx.putImageData(img, 0, 0)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      RETRO.jpegQuality,
    )
  })
}
