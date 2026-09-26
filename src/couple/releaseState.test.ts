import { describe, it, expect } from 'vitest'
import { initialReleaseState, releaseReducer, shownReleased, type ReleaseEvent, type ReleaseState } from './releaseState'

const run = (events: ReleaseEvent[], from: ReleaseState = initialReleaseState) => events.reduce(releaseReducer, from)
const ready = (released: boolean) => run([{ type: 'loaded', attempt: 0, released }])

describe('releaseReducer — loading', () => {
  it('starts loading and private', () => {
    expect(initialReleaseState.phase).toBe('loading')
    expect(shownReleased(initialReleaseState)).toBe(false)
  })

  it('shows the loaded value', () => {
    expect(ready(true)).toMatchObject({ phase: 'ready', released: true })
    expect(ready(false)).toMatchObject({ phase: 'ready', released: false })
  })

  it('a failed load can be retried, and a stale answer from the old attempt is ignored', () => {
    const failed = run([{ type: 'loadFailed', attempt: 0 }])
    expect(failed.phase).toBe('failed')
    const retrying = releaseReducer(failed, { type: 'retry' })
    expect(retrying).toMatchObject({ phase: 'loading', attempt: 1 })
    expect(releaseReducer(retrying, { type: 'loaded', attempt: 0, released: true })).toBe(retrying)
    expect(releaseReducer(retrying, { type: 'loaded', attempt: 1, released: true })).toMatchObject({
      phase: 'ready',
      released: true,
    })
  })

  it('retry only means something after a failure', () => {
    expect(releaseReducer(initialReleaseState, { type: 'retry' })).toBe(initialReleaseState)
    expect(releaseReducer(ready(false), { type: 'retry' })).toMatchObject({ phase: 'ready' })
  })
})

describe('releaseReducer — saving', () => {
  it('can’t toggle before the value is loaded', () => {
    expect(releaseReducer(initialReleaseState, { type: 'toggle' })).toBe(initialReleaseState)
  })

  it('toggling asks to save the explicit opposite and shows it right away', () => {
    const s = releaseReducer(ready(false), { type: 'toggle' })
    expect(s.saving).toEqual({ request: 1, value: true })
    expect(shownReleased(s)).toBe(true)
    expect(s.released).toBe(false)
  })

  it('a second tap while saving does nothing (no flip-back)', () => {
    const s = releaseReducer(ready(false), { type: 'toggle' })
    expect(releaseReducer(s, { type: 'toggle' })).toBe(s)
  })

  it('a confirmed save becomes the value', () => {
    const s = run([{ type: 'toggle' }, { type: 'saved', request: 1, released: true }], ready(false))
    expect(s).toMatchObject({ released: true, saving: null, saveFailed: false })
    expect(shownReleased(s)).toBe(true)
  })

  it('a failed save reverts the switch and flags the failure; the next tap clears it', () => {
    const failed = run([{ type: 'toggle' }, { type: 'saveFailed', request: 1 }], ready(false))
    expect(failed).toMatchObject({ released: false, saving: null, saveFailed: true })
    expect(shownReleased(failed)).toBe(false)
    const again = releaseReducer(failed, { type: 'toggle' })
    expect(again).toMatchObject({ saveFailed: false, saving: { request: 2, value: true } })
  })

  it('ignores an answer for a request that isn’t in flight', () => {
    const s = releaseReducer(ready(false), { type: 'toggle' })
    expect(releaseReducer(s, { type: 'saved', request: 99, released: true })).toBe(s)
    expect(releaseReducer(s, { type: 'saveFailed', request: 99 })).toBe(s)
    const done = releaseReducer(s, { type: 'saved', request: 1, released: true })
    expect(releaseReducer(done, { type: 'saveFailed', request: 1 })).toBe(done)
  })

  it('trusts the server’s saved value over the one asked for', () => {
    const s = run([{ type: 'toggle' }, { type: 'saved', request: 1, released: false }], ready(false))
    expect(s.released).toBe(false)
  })

  it('either way round: on → off', () => {
    const s = run([{ type: 'toggle' }, { type: 'saved', request: 1, released: false }], ready(true))
    expect(s.released).toBe(false)
  })
})
