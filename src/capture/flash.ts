// The flash. A web page can't fire a phone's real photo flash, so the back
// camera uses the torch and the selfie camera lights the guest with a white
// screen. Torch support varies and can't be detected reliably on iPhones, so
// every step is best-effort: a flash that fails must never cost a shot (AD-1).
// The decisions are pure (unit-tested); Camera wires them to the page.
import type { FacingMode } from './cameraMemory.ts'

export type FlashMode = 'auto' | 'on' | 'off'
export type FlashPlan = 'none' | 'torch' | 'screen'

const ORDER: FlashMode[] = ['auto', 'on', 'off']

export function nextFlashMode(mode: FlashMode): FlashMode {
  return ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]
}

// Tuning surface: adjust against real phones.
export const FLASH = {
  darkLuma: 60, // average brightness (0-255) below which Auto fires
  torchSettleMs: 400, // the camera's exposure needs a moment to catch up
  screenSettleMs: 250,
  torchTimeoutMs: 500, // never let a stuck torch hold up the shutter
  sampleSize: 32, // brightness is read from a tiny copy of the frame
} as const

/** Average brightness of RGBA pixels (0-255), or null with nothing to read. */
export function averageLuma(data: Uint8ClampedArray): number | null {
  const pixels = Math.floor(data.length / 4)
  if (pixels === 0) return null
  let sum = 0
  for (let i = 0; i < pixels * 4; i += 4) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  }
  return sum / pixels
}

/** An unreadable frame counts as not dark: Auto stays out of the way. */
export function isDark(luma: number | null): boolean {
  return luma !== null && luma < FLASH.darkLuma
}

export function planFlash(params: {
  mode: FlashMode
  facing: FacingMode
  kind: 'photo' | 'clip'
  dark: boolean
}): FlashPlan {
  const { mode, facing, kind, dark } = params
  if (mode === 'off' || (mode === 'auto' && !dark)) return 'none'
  if (facing === 'environment') return 'torch'
  // A white screen would hide the guest's own viewfinder for a whole clip.
  return kind === 'photo' ? 'screen' : 'none'
}

export type FlashEffects = {
  torch: (on: boolean) => Promise<unknown>
  screen: (on: boolean) => Promise<unknown> | void
  wait: (ms: number) => Promise<void>
}

/** Light up, let the exposure settle, shoot, and always turn the light off. */
export async function withFlash<T>(
  plan: FlashPlan,
  fx: FlashEffects,
  shoot: () => Promise<T>,
): Promise<T> {
  if (plan === 'none') return shoot()
  const light = plan === 'torch' ? fx.torch : fx.screen
  await light(true)
  await fx.wait(plan === 'torch' ? FLASH.torchSettleMs : FLASH.screenSettleMs)
  try {
    return await shoot()
  } finally {
    await light(false)
  }
}

/** Turn the torch on or off. Never throws, and gives up rather than stall. */
export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  const torch = { advanced: [{ torch: on }] } as unknown as MediaTrackConstraints
  try {
    return await Promise.race([
      track.applyConstraints(torch).then(() => true),
      new Promise<boolean>((resolve) =>
        window.setTimeout(() => resolve(false), FLASH.torchTimeoutMs),
      ),
    ])
  } catch {
    return false
  }
}

/** How bright the viewfinder is right now, or null if it can't be read. */
export function measureLuma(video: HTMLVideoElement): number | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = FLASH.sampleSize
    canvas.height = FLASH.sampleSize
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, FLASH.sampleSize, FLASH.sampleSize)
    return averageLuma(ctx.getImageData(0, 0, FLASH.sampleSize, FLASH.sampleSize).data)
  } catch {
    return null
  }
}
