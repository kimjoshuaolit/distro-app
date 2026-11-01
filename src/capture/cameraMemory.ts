// Has this guest already turned the camera on? Remembered (with the lens they
// were using) so a reload or a trip to My Roll comes straight back to the
// viewfinder. It only skips our own "Turn on the camera" screen: the browser
// still decides whether to ask for permission again. Every access is guarded,
// so private modes that throw just show that screen.
export type FacingMode = 'user' | 'environment'

const KEY = 'drc:camera'

export function rememberedCamera(): FacingMode | null {
  try {
    const mode = localStorage.getItem(KEY)
    return mode === 'user' || mode === 'environment' ? mode : null
  } catch {
    return null
  }
}

export function rememberCamera(mode: FacingMode): void {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // ignore: the guest just sees the turn-on screen next time
  }
}

export function forgetCamera(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore: nothing was remembered
  }
}
