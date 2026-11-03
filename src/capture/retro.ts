// The retro "bake" (AD-8): photos are developed like an instant film shot on
// a cheap plastic camera. The colour comes from a film LUT measured from Fuji
// FP-100C instant film (see film/README.md); the camera comes from simple
// optics: a little over-exposure, colour fringing, softness, glow, red
// halation around highlights, corner falloff, and clumpy grain. Everything is
// cropped to the Instax Mini image shape and saved as a compressed JPEG.
// Pixel maths is pure and deterministic (unit-tested); the canvas
// orchestration is DOM-only. Tuned against real photos in a side-by-side look
// lab (look "A"), which is why the numbers are oddly specific.

// Tuning surface — adjust against real device output (AD-8 assumption).
// Radii are fractions of the image width, so the look holds at any size.
export const RETRO = {
  maxEdge: 1600, // long-edge downscale target
  jpegQuality: 0.85,
  aspect: 46 / 62, // Instax Mini image area, short edge over long edge
  exposure: 0.15, // stops brighter: instant film runs bright
  aberration: 0.0018, // red and green magnified a touch more than blue: colour fringes
  soft: 0.45, // share of a slightly blurred copy mixed in: a cheap lens
  softRadius: 0.0015,
  bloom: 0.14, // glow added around everything bright
  bloomRadius: 0.02,
  halation: 0.44, // red halo around hot highlights, from light scattering in the film
  halationRadius: 0.012,
  halationFrom: 0.55, // linear brightness where highlights start to halate
  halationTint: [1, 0.32, 0.12],
  vignette: 0.32, // brightness lost in the far corners
  grain: 0.045, // grain strength, 0-1 scale
  grainSize: 1.6, // pixels per grain clump
  grainColour: 0.25, // share of per-channel noise mixed into the clumps
} as const

/** Film LUTs are 33-point cubes, bytes laid out [blue][green][red][rgb]. */
export const LUT_SIZE = 33
export const LUT_BYTES = LUT_SIZE ** 3 * 3

// sRGB <-> linear light. Optics happen in linear light; the film LUT expects sRGB.
const TO_LINEAR = Float32Array.from({ length: 256 }, (_, v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

function toSrgb(v: number): number {
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** Blur radius in pixels for a fraction of the width: never less than one. */
export function radius(fraction: number, w: number): number {
  return Math.max(1, Math.round(w * fraction))
}

function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const len = horizontal ? w : h
  const lines = horizontal ? h : w
  const step = (horizontal ? 1 : w) * 3
  const span = 2 * r + 1
  for (let line = 0; line < lines; line++) {
    const base = (horizontal ? line * w : line) * 3
    for (let c = 0; c < 3; c++) {
      const at = (k: number) => src[base + Math.min(len - 1, Math.max(0, k)) * step + c]
      let sum = 0
      for (let k = -r; k <= r; k++) sum += at(k)
      for (let k = 0; k < len; k++) {
        dst[base + k * step + c] = sum / span
        sum += at(k + r + 1) - at(k - r)
      }
    }
  }
}

/** Near-Gaussian blur of an RGB float image: three box passes per axis, edges clamped. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const a = Float32Array.from(src)
  const b = new Float32Array(src.length)
  for (let pass = 0; pass < 3; pass++) {
    boxPass(a, b, w, h, r, true)
    boxPass(b, a, w, h, r, false)
  }
  return a
}

/** Bilinear read of one channel, edges clamped. */
function bilinear(src: Float32Array, w: number, h: number, x: number, y: number, c: number): number {
  const cx = Math.min(w - 1, Math.max(0, x))
  const cy = Math.min(h - 1, Math.max(0, y))
  const x0 = Math.min(w - 2, Math.floor(cx))
  const y0 = Math.min(h - 2, Math.floor(cy))
  const fx = cx - x0
  const fy = cy - y0
  const i = (y0 * w + x0) * 3 + c
  const top = src[i] + (src[i + 3] - src[i]) * fx
  const bottom = src[i + w * 3] + (src[i + w * 3 + 3] - src[i + w * 3]) * fx
  return top + (bottom - top) * fy
}

/** Lateral colour fringing: each channel magnified about the centre by its own amount. */
export function aberrate(src: Float32Array, w: number, h: number): Float32Array {
  if (w < 2 || h < 2) return src
  const out = new Float32Array(src.length)
  const scale = [1 + RETRO.aberration * 2, 1 + RETRO.aberration, 1]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      for (let c = 0; c < 3; c++) {
        const k = scale[c]
        out[i + c] =
          k === 1
            ? src[i + c]
            : bilinear(src, w, h, (x + 0.5 - w / 2) / k + w / 2 - 0.5, (y + 0.5 - h / 2) / k + h / 2 - 0.5, c)
      }
    }
  }
  return out
}

/** Trilinear lookup of an sRGB colour (0-1) through a 33-point film LUT, into `out`. */
export function sampleLut(lut: Uint8Array, r: number, g: number, b: number, out: number[]): void {
  const n = LUT_SIZE - 1
  const sr = Math.min(1, Math.max(0, r)) * n
  const sg = Math.min(1, Math.max(0, g)) * n
  const sb = Math.min(1, Math.max(0, b)) * n
  const r0 = Math.min(n - 1, Math.floor(sr))
  const g0 = Math.min(n - 1, Math.floor(sg))
  const b0 = Math.min(n - 1, Math.floor(sb))
  const fr = sr - r0
  const fg = sg - g0
  const fb = sb - b0
  out[0] = out[1] = out[2] = 0
  for (let db = 0; db < 2; db++) {
    const wb = db ? fb : 1 - fb
    for (let dg = 0; dg < 2; dg++) {
      const wg = dg ? fg : 1 - fg
      for (let dr = 0; dr < 2; dr++) {
        const wt = wb * wg * (dr ? fr : 1 - fr)
        const i = (((b0 + db) * LUT_SIZE + (g0 + dg)) * LUT_SIZE + (r0 + dr)) * 3
        out[0] += lut[i] * wt
        out[1] += lut[i + 1] * wt
        out[2] += lut[i + 2] * wt
      }
    }
  }
  out[0] /= 255
  out[1] /= 255
  out[2] /= 255
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

/** Standard-normal noise (Box-Muller) from a seeded uniform source. */
function gaussian(rand: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
}

/**
 * Develop the frame in place: optics in linear light, then the film LUT, then
 * grain. `lut` may be null (it failed to load): the shot still gets the
 * camera's character, just without the film colour. Never throws on content.
 */
export function developFilm(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  lut: Uint8Array | null,
  seed: number,
): void {
  const n = w * h
  const gain = 2 ** RETRO.exposure
  let lin: Float32Array = new Float32Array(n * 3)
  for (let p = 0; p < n; p++) {
    lin[p * 3] = TO_LINEAR[data[p * 4]] * gain
    lin[p * 3 + 1] = TO_LINEAR[data[p * 4 + 1]] * gain
    lin[p * 3 + 2] = TO_LINEAR[data[p * 4 + 2]] * gain
  }

  // The lens: fringes, softness, glow.
  lin = aberrate(lin, w, h)
  const soft = boxBlur(lin, w, h, radius(RETRO.softRadius, w))
  for (let i = 0; i < lin.length; i++) lin[i] += (soft[i] - lin[i]) * RETRO.soft
  const bloom = boxBlur(lin, w, h, radius(RETRO.bloomRadius, w))
  for (let i = 0; i < lin.length; i++) lin[i] += bloom[i] * RETRO.bloom

  // The film: highlights scatter red light back into the emulsion.
  const hot = new Float32Array(lin.length)
  for (let i = 0; i < lin.length; i += 3) {
    const k = Math.min(1, Math.max(0, (luma(lin[i], lin[i + 1], lin[i + 2]) - RETRO.halationFrom) / (1 - RETRO.halationFrom)))
    hot[i] = lin[i] * k
    hot[i + 1] = lin[i + 1] * k
    hot[i + 2] = lin[i + 2] * k
  }
  const halo = boxBlur(hot, w, h, radius(RETRO.halationRadius, w))
  const [tr, tg, tb] = RETRO.halationTint
  for (let i = 0; i < lin.length; i += 3) {
    lin[i] += halo[i] * tr * RETRO.halation
    lin[i + 1] += halo[i + 1] * tg * RETRO.halation
    lin[i + 2] += halo[i + 2] * tb * RETRO.halation
  }

  // Grain clumps: coarse noise, smoothed up to full size.
  const rand = mulberry32(seed)
  const normal = gaussian(rand)
  const gw = Math.ceil(w / RETRO.grainSize)
  const gh = Math.ceil(h / RETRO.grainSize)
  const clumps = new Float32Array(gw * gh)
  for (let i = 0; i < clumps.length; i++) clumps[i] = normal()
  const clumpAt = (x: number, y: number) => {
    const sx = Math.min(gw - 1, Math.max(0, ((x + 0.5) * gw) / w - 0.5))
    const sy = Math.min(gh - 1, Math.max(0, ((y + 0.5) * gh) / h - 0.5))
    const x0 = Math.floor(sx)
    const y0 = Math.floor(sy)
    const x1 = Math.min(gw - 1, x0 + 1)
    const y1 = Math.min(gh - 1, y0 + 1)
    const fx = sx - x0
    const fy = sy - y0
    const top = clumps[y0 * gw + x0] + (clumps[y0 * gw + x1] - clumps[y0 * gw + x0]) * fx
    const bottom = clumps[y1 * gw + x0] + (clumps[y1 * gw + x1] - clumps[y1 * gw + x0]) * fx
    return top + (bottom - top) * fy
  }

  // Corner falloff, back to sRGB, the film colour, then grain.
  const film = [0, 0, 0]
  for (let y = 0; y < h; y++) {
    const dy = ((y + 0.5) / h) * 2 - 1
    for (let x = 0; x < w; x++) {
      const dx = ((x + 0.5) / w) * 2 - 1
      const d = (dx * dx + dy * dy) / 2 // 0 at the centre, 1 in a corner
      const fall = 1 - RETRO.vignette * d ** 1.5
      const p = y * w + x
      const r = toSrgb(lin[p * 3] * fall)
      const g = toSrgb(lin[p * 3 + 1] * fall)
      const b = toSrgb(lin[p * 3 + 2] * fall)
      if (lut) sampleLut(lut, r, g, b, film)
      else {
        film[0] = r
        film[1] = g
        film[2] = b
      }
      const weight = 0.35 + 0.65 * (1 - Math.min(1, Math.max(0, luma(film[0], film[1], film[2])))) ** 1.2
      const clump = clumpAt(x, y)
      for (let c = 0; c < 3; c++) {
        const v = film[c] + (clump + normal() * RETRO.grainColour) * RETRO.grain * weight
        data[p * 4 + c] = Math.round(Math.min(1, Math.max(0, v)) * 255)
      }
    }
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

/** Crop and draw the source, develop the film look, and export a compressed JPEG blob. */
export async function bakePhoto(
  source: PhotoSource,
  opts: { seed?: number; lut?: Uint8Array | null } = {},
): Promise<Blob> {
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
  developFilm(img.data, w, h, opts.lut ?? null, opts.seed ?? (Date.now() >>> 0))
  ctx.putImageData(img, 0, 0)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      RETRO.jpegQuality,
    )
  })
}
