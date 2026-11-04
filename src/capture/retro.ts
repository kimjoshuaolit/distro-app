// The photo bake (AD-8): the frame is cropped to the Instax Mini image shape,
// downscaled, and saved as a compressed JPEG. No colour grade: the couple
// chose plain, true-to-life photos (the film look lived in git history up to
// 173cd1d if it's ever wanted back). Crop maths is pure (unit-tested); the
// canvas orchestration is DOM-only.

export const RETRO = {
  maxEdge: 1600, // long-edge downscale target
  jpegQuality: 0.85,
  aspect: 46 / 62, // Instax Mini image area, short edge over long edge
} as const

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

/** Crop and draw the source, and export a compressed JPEG blob. */
export async function bakePhoto(source: PhotoSource): Promise<Blob> {
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

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      RETRO.jpegQuality,
    )
  })
}
