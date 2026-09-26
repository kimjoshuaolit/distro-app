// The sharing switch's state (2.4), kept pure so it's unit-tested without
// React. useRelease runs the reads and writes this state asks for.

export type ReleaseState = {
  /** Loading the current value, it failed, or it's on screen. */
  phase: 'loading' | 'failed' | 'ready'
  /** Which load this is — a stale answer from an older one is ignored. */
  attempt: number
  /** The value the server last confirmed. */
  released: boolean
  /** The save in flight, if any: the value asked for, tagged with its request number. */
  saving: { request: number; value: boolean } | null
  /** The last request number handed out. */
  lastRequest: number
  /** The last save failed (the switch went back to `released`). */
  saveFailed: boolean
}

export type ReleaseEvent =
  | { type: 'loaded'; attempt: number; released: boolean }
  | { type: 'loadFailed'; attempt: number }
  | { type: 'retry' }
  | { type: 'toggle' }
  | { type: 'saved'; request: number; released: boolean }
  | { type: 'saveFailed'; request: number }

export const initialReleaseState: ReleaseState = {
  phase: 'loading',
  attempt: 0,
  released: false,
  saving: null,
  lastRequest: 0,
  saveFailed: false,
}

/** What the switch shows: the value being saved (optimistic), else the confirmed one. */
export function shownReleased(state: ReleaseState): boolean {
  return state.saving ? state.saving.value : state.released
}

export function releaseReducer(state: ReleaseState, event: ReleaseEvent): ReleaseState {
  switch (event.type) {
    case 'loaded':
      if (state.phase !== 'loading' || event.attempt !== state.attempt) return state
      return { ...state, phase: 'ready', released: event.released }
    case 'loadFailed':
      if (state.phase !== 'loading' || event.attempt !== state.attempt) return state
      return { ...state, phase: 'failed' }
    case 'retry':
      if (state.phase !== 'failed') return state
      return { ...state, phase: 'loading', attempt: state.attempt + 1 }
    case 'toggle': {
      // One save at a time: the switch is busy until the server answers.
      if (state.phase !== 'ready' || state.saving) return state
      const request = state.lastRequest + 1
      return { ...state, saving: { request, value: !state.released }, lastRequest: request, saveFailed: false }
    }
    case 'saved':
      if (state.saving?.request !== event.request) return state
      return { ...state, released: event.released, saving: null }
    case 'saveFailed':
      if (state.saving?.request !== event.request) return state
      return { ...state, saving: null, saveFailed: true }
  }
}
