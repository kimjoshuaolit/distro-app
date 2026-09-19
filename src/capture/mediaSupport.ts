// Pick a clip container/codec the browser can actually record. Safari records
// video/mp4; Chrome/Firefox prefer webm. Injectable predicate for testing.

const CANDIDATES = [
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const

function defaultIsSupported(type: string): boolean {
  return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)
}

/** First recordable mime type, or null if the browser can't record video. */
export function pickClipMimeType(isSupported: (t: string) => boolean = defaultIsSupported): string | null {
  for (const type of CANDIDATES) {
    if (isSupported(type)) return type
  }
  return null
}
