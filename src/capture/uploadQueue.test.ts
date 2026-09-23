import { describe, it, expect, vi, beforeEach } from 'vitest'
import { uploadShot, drainOnce, nextDelay, type UploadDeps } from './uploadQueue.ts'
import type { Shot } from './db.ts'

function makeShot(id: string, type: Shot['type'] = 'photo'): Shot {
  return {
    id,
    eventId: 'E',
    guestId: 'G',
    type,
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    capturedAt: '2026-09-19T12:00:00.000Z',
    uploadStatus: 'local',
  }
}

function makeDeps(overrides: Partial<UploadDeps> = {}): UploadDeps {
  return {
    issueUploadUrl: vi.fn().mockResolvedValue({ uploadUrl: 'https://r2/put' }),
    putToR2: vi.fn().mockResolvedValue(undefined),
    confirmUpload: vi.fn().mockResolvedValue(undefined),
    markUploaded: vi.fn().mockResolvedValue(undefined),
    markRejected: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

// A cap_reached error — thrown synchronously so no rejected promise floats.
const capError = () => {
  throw Object.assign(new Error('cap'), { code: 'cap_reached' })
}
const netError = () => {
  throw new Error('network down')
}

describe('nextDelay', () => {
  it('grows exponentially from the base', () => {
    expect(nextDelay(0)).toBe(1000)
    expect(nextDelay(1)).toBe(2000)
    expect(nextDelay(2)).toBe(4000)
  })
  it('is capped and floors negative attempts', () => {
    expect(nextDelay(99)).toBe(30_000)
    expect(nextDelay(-5)).toBe(1000)
  })
})

describe('uploadShot', () => {
  let deps: UploadDeps
  beforeEach(() => {
    deps = makeDeps()
  })

  it('reserves, PUTs, confirms, and marks uploaded on the happy path', async () => {
    const shot = makeShot('11111111-1111-4111-8111-111111111111')
    const outcome = await uploadShot(shot, 'dev', deps)

    expect(outcome).toBe('uploaded')
    expect(deps.issueUploadUrl).toHaveBeenCalledWith('dev', shot)
    expect(deps.putToR2).toHaveBeenCalledWith('https://r2/put', shot.blob)
    expect(deps.confirmUpload).toHaveBeenCalledWith('dev', shot.id)
    expect(deps.markUploaded).toHaveBeenCalledWith(shot.id)
    expect(deps.markRejected).not.toHaveBeenCalled()
  })

  it('marks the shot rejected and never PUTs when the cap is reached', async () => {
    deps = makeDeps({ issueUploadUrl: vi.fn(capError) })
    const shot = makeShot('22222222-2222-4222-8222-222222222222')

    const outcome = await uploadShot(shot, 'dev', deps)

    expect(outcome).toBe('cap_reached')
    expect(deps.markRejected).toHaveBeenCalledWith(shot.id)
    expect(deps.putToR2).not.toHaveBeenCalled()
    expect(deps.markUploaded).not.toHaveBeenCalled()
  })

  it('returns retry and leaves the shot local when the PUT fails', async () => {
    deps = makeDeps({ putToR2: vi.fn(netError) })
    const shot = makeShot('33333333-3333-4333-8333-333333333333')

    const outcome = await uploadShot(shot, 'dev', deps)

    expect(outcome).toBe('retry')
    expect(deps.markUploaded).not.toHaveBeenCalled()
    expect(deps.markRejected).not.toHaveBeenCalled()
  })

  it('returns retry when confirm fails after a successful PUT', async () => {
    deps = makeDeps({ confirmUpload: vi.fn(netError) })
    const shot = makeShot('44444444-4444-4444-8444-444444444444')

    const outcome = await uploadShot(shot, 'dev', deps)

    expect(outcome).toBe('retry')
    expect(deps.markUploaded).not.toHaveBeenCalled()
  })
})

// Async rejections shaped like the real UploadError (code on an Error). Plain
// async functions (not vi.fn) so vitest doesn't flag a tracked rejection.
const rejectWith = (code?: string) => async () => {
  throw code ? Object.assign(new Error(code), { name: 'UploadError', code }) : new TypeError('Failed to fetch')
}

describe('uploadShot error classification (async rejections)', () => {
  it('treats an async cap_reached from the server as terminal and marks it rejected', async () => {
    const deps = makeDeps({ issueUploadUrl: rejectWith('cap_reached') })
    const outcome = await uploadShot(makeShot('c-1'), 'dev', deps)
    expect(outcome).toBe('cap_reached')
    expect(deps.markRejected).toHaveBeenCalledWith('c-1')
  })

  it('skips a shot-specific failure without marking it (it stays local)', async () => {
    for (const code of ['bad_request', 'guest_not_found', 'shot_not_found', 'not_uploaded', 'put_failed']) {
      const deps = makeDeps({ issueUploadUrl: rejectWith(code) })
      expect(await uploadShot(makeShot('s-1'), 'dev', deps)).toBe('skipped')
      expect(deps.markUploaded).not.toHaveBeenCalled()
      expect(deps.markRejected).not.toHaveBeenCalled()
    }
  })

  it('treats network errors and server_error as transient retries', async () => {
    expect(await uploadShot(makeShot('n-1'), 'dev', makeDeps({ putToR2: rejectWith() }))).toBe('retry')
    expect(
      await uploadShot(makeShot('n-2'), 'dev', makeDeps({ confirmUpload: rejectWith('server_error') })),
    ).toBe('retry')
  })

  it('retries (does not lose the shot) if persisting the rejection fails', async () => {
    const deps = makeDeps({ issueUploadUrl: rejectWith('cap_reached'), markRejected: rejectWith() })
    expect(await uploadShot(makeShot('r-1'), 'dev', deps)).toBe('retry')
  })
})

describe('drainOnce', () => {
  it('skips a permanently failing shot and still uploads the rest', async () => {
    const issue = async (_dt: string, s: Shot) => {
      if (s.id === 'bad-1') throw Object.assign(new Error('bad'), { code: 'bad_request' })
      return { uploadUrl: 'u' }
    }
    const deps = makeDeps({ issueUploadUrl: issue })
    const res = await drainOnce([makeShot('bad-1'), makeShot('ok-2'), makeShot('ok-3')], 'dev', deps)

    expect(res.allSettled).toBe(false) // bad-1 still needs a later pass
    expect(deps.markUploaded).toHaveBeenCalledWith('ok-2')
    expect(deps.markUploaded).toHaveBeenCalledWith('ok-3')
  })

  it('uploads every shot in order when all succeed', async () => {
    const order: string[] = []
    const deps = makeDeps({
      issueUploadUrl: vi.fn(async (_dt: string, s: Shot) => {
        order.push(s.id)
        return { uploadUrl: 'u' }
      }),
    })
    const shots = [makeShot('a-1'), makeShot('b-2'), makeShot('c-3')]

    const res = await drainOnce(shots, 'dev', deps)

    expect(res.allSettled).toBe(true)
    expect(order).toEqual(['a-1', 'b-2', 'c-3'])
    expect(deps.markUploaded).toHaveBeenCalledTimes(3)
  })

  it('stops on the first transient failure so the batch can be retried', async () => {
    const deps = makeDeps({ putToR2: vi.fn(netError) })
    const shots = [makeShot('a-1'), makeShot('b-2')]

    const res = await drainOnce(shots, 'dev', deps)

    expect(res.allSettled).toBe(false)
    // Second shot never attempted after the first needs retry.
    expect(deps.issueUploadUrl).toHaveBeenCalledTimes(1)
  })

  it('treats cap_reached as terminal and continues to the next shot', async () => {
    const issue = vi
      .fn()
      .mockImplementationOnce(capError)
      .mockResolvedValue({ uploadUrl: 'u' })
    const deps = makeDeps({ issueUploadUrl: issue })
    const shots = [makeShot('a-1'), makeShot('b-2')]

    const res = await drainOnce(shots, 'dev', deps)

    expect(res.allSettled).toBe(true)
    expect(deps.markRejected).toHaveBeenCalledWith('a-1')
    expect(deps.markUploaded).toHaveBeenCalledWith('b-2')
  })
})
