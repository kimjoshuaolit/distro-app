import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const invoke = vi.fn()

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}))

const { getEventStatus, joinEvent, JoinError } = await import('./api.ts')

const OPEN_ID = '00000000-0000-0000-0000-000000000001'

beforeEach(() => {
  rpc.mockReset()
  invoke.mockReset()
})

describe('getEventStatus', () => {
  it('returns invalid for a malformed id without calling the RPC', async () => {
    expect(await getEventStatus('not-a-uuid')).toEqual({ state: 'invalid' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns error on a transient RPC failure (not invalid)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network' } })
    expect(await getEventStatus(OPEN_ID)).toEqual({ state: 'error' })
  })

  it('returns invalid when the event is unknown (empty result)', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    expect(await getEventStatus(OPEN_ID)).toEqual({ state: 'invalid' })
  })

  it('returns open when is_open is true', async () => {
    rpc.mockResolvedValue({ data: [{ is_open: true, opens_at: null, closes_at: null }], error: null })
    expect(await getEventStatus(OPEN_ID)).toEqual({ state: 'open' })
  })

  it('returns pending when the window is in the future', async () => {
    const opensAt = new Date(Date.now() + 86_400_000).toISOString()
    rpc.mockResolvedValue({ data: [{ is_open: false, opens_at: opensAt, closes_at: null }], error: null })
    expect(await getEventStatus(OPEN_ID)).toEqual({ state: 'pending', opensAt })
  })

  it('returns ended when the window has passed', async () => {
    const opensAt = new Date(Date.now() - 86_400_000).toISOString()
    rpc.mockResolvedValue({ data: [{ is_open: false, opens_at: opensAt, closes_at: opensAt }], error: null })
    expect(await getEventStatus(OPEN_ID)).toEqual({ state: 'ended' })
  })
})

describe('joinEvent', () => {
  it('returns the guest identity + allotment on success', async () => {
    invoke.mockResolvedValue({
      data: {
        guestId: 'g1',
        deviceToken: 'tok',
        firstName: 'Ana',
        photosRemaining: 25,
        clipsRemaining: 5,
      },
      error: null,
    })
    await expect(joinEvent(OPEN_ID, 'Ana')).resolves.toEqual({
      guestId: 'g1',
      deviceToken: 'tok',
      firstName: 'Ana',
      photosRemaining: 25,
      clipsRemaining: 5,
    })
  })

  it('decodes a typed error code from the function response body', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        context: {
          json: async () => ({ error: { code: 'event_closed', message: 'closed' } }),
        },
      },
    })
    await expect(joinEvent(OPEN_ID, 'Ana')).rejects.toMatchObject({
      name: 'JoinError',
      code: 'event_closed',
      message: 'closed',
    })
  })

  it('falls back to server_error when the error body is unreadable', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(joinEvent(OPEN_ID, 'Ana')).rejects.toMatchObject({
      name: 'JoinError',
      code: 'server_error',
    })
  })

  it('throws when the response has no data and no error', async () => {
    invoke.mockResolvedValue({ data: null, error: null })
    await expect(joinEvent(OPEN_ID, 'Ana')).rejects.toBeInstanceOf(JoinError)
  })
})
