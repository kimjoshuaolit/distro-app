// The camera window in one line (Story 3.2's wording), shared by the Camera
// panel on the event page and the O2 dashboard (3.3). Pure; `fmt` formats an
// ISO time for the page it's on.
import { uploadsUntil, windowPhase, type WindowPhase } from '../../supabase/functions/_shared/window-rules.ts'

export function windowLine(
  open: string | null,
  close: string | null,
  now: Date,
  fmt: (iso: string) => string,
): { phase: WindowPhase; text: string } {
  const phase = windowPhase(open, close, now)
  if (phase === 'unset') return { phase, text: 'No window set — the camera isn’t open.' }
  if (phase === 'scheduled') return { phase, text: `Not open yet · opens ${fmt(open!)}` }
  if (phase === 'open') return { phase, text: close ? `Open now · closes ${fmt(close)}` : 'Open now · no close time' }
  // Closed: a close time exists. Say whether late uploads still land.
  const until = uploadsUntil(close)
  if (until !== null && now.getTime() > Date.parse(until)) {
    return { phase, text: `Closed ${fmt(close!)} · uploads have closed too` }
  }
  return { phase, text: `Closed ${fmt(close!)}${until ? ` · late uploads accepted until ${fmt(until)}` : ''}` }
}
