import type { UploaderState } from './useUploader.ts'

/**
 * What to tell a guest who's done shooting (roll finished, or the camera
 * closed) about their uploads. Phone browsers pause a page as soon as the
 * guest switches apps or locks the phone, so shots still on the phone only
 * upload while this page is open: say so, plainly, until everything's saved.
 * null while the queue hasn't been looked at yet (say nothing rather than guess).
 */
export function uploadNote(state: UploaderState, pending: number): { text: string; waiting: boolean } | null {
  if (state === 'checking') return null
  if (pending <= 0) return { text: 'Everything’s saved. You can close this page.', waiting: false }
  const shots = `${pending} ${pending === 1 ? 'shot' : 'shots'}`
  if (state === 'offline') {
    return {
      text: `You’re offline: ${shots} waiting on your phone. Open your camera link again once you’re back online.`,
      waiting: true,
    }
  }
  return {
    text: `${shots} still uploading. Keep this page open until it says All saved, or open your camera link again later.`,
    waiting: true,
  }
}
