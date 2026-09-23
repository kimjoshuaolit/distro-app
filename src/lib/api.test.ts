import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const invoke = vi.fn()

// A chainable postgrest-style query recorder: every builder call is logged and
// the awaited result is whatever `queryResult` holds.
const queryCalls: Array<[string, unknown[]]> = []
let queryResult: { data: unknown; error: unknown } = { data: [], error: null }
const from = vi.fn((table: string) => {
  queryCalls.push(['from', [table]])
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'setHeader', 'abortSignal']) {
    builder[m] = (...args: unknown[]) => {
      queryCalls.push([m, args])
      return builder
    }
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(queryResult)
  return builder
})

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => from(table),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}))

const {
  getEventStatus,
  joinEvent,
  JoinError,
  issueUploadUrl,
  putToR2,
  confirmUpload,
  putTimeoutMs,
  getServerRoll,
  issueViewUrls,
} = await import('./api.ts')

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

const typedError = (code: string, message = code) => ({
  data: null,
  error: { context: { json: async () => ({ error: { code, message } }) } },
})

const clipShot = {
  id: '11111111-1111-4111-8111-111111111111',
  eventId: OPEN_ID,
  guestId: 'g1',
  type: 'clip' as const,
  blob: new Blob(['0123456789'], { type: 'video/webm;codecs=vp9,opus' }),
  capturedAt: '2026-09-19T12:00:00.000Z',
  uploadStatus: 'local' as const,
}

describe('issueUploadUrl', () => {
  it('sends the shot identity, type, content type and byte size, with a timeout', async () => {
    invoke.mockResolvedValue({
      data: { uploadUrl: 'https://r2/put', r2Key: 'k', shotId: 's', expiresIn: 300 },
      error: null,
    })
    await expect(issueUploadUrl('tok', clipShot)).resolves.toMatchObject({ uploadUrl: 'https://r2/put' })

    const [name, opts] = invoke.mock.calls[0]
    expect(name).toBe('issue-upload-url')
    expect(opts.body).toEqual({
      deviceToken: 'tok',
      clientShotId: clipShot.id,
      type: 'clip',
      contentType: 'video/webm;codecs=vp9,opus',
      size: 10,
      capturedAt: clipShot.capturedAt,
    })
    expect(opts.timeout).toBeGreaterThan(0)
  })

  it('surfaces the server cap as UploadError("cap_reached") — the queue relies on this', async () => {
    invoke.mockResolvedValue(typedError('cap_reached'))
    await expect(issueUploadUrl('tok', clipShot)).rejects.toMatchObject({
      name: 'UploadError',
      code: 'cap_reached',
    })
  })

  it('maps a transport failure (no readable body) to transient server_error', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    await expect(issueUploadUrl('tok', clipShot)).rejects.toMatchObject({ code: 'server_error' })
  })

  it('rejects a success response without an upload URL', async () => {
    invoke.mockResolvedValue({ data: {}, error: null })
    await expect(issueUploadUrl('tok', clipShot)).rejects.toMatchObject({ code: 'server_error' })
  })
})

describe('putToR2', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('PUTs the blob with its content type and an abort signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await putToR2('https://r2/put', clipShot.blob)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://r2/put')
    expect(init).toMatchObject({ method: 'PUT', headers: { 'Content-Type': clipShot.blob.type } })
    expect(init.body).toBe(clipShot.blob)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('treats a 4xx (expired/mismatched signature) as put_failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    await expect(putToR2('u', clipShot.blob)).rejects.toMatchObject({ code: 'put_failed' })
  })

  it('treats 5xx / 429 as transient server_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(putToR2('u', clipShot.blob)).rejects.toMatchObject({ code: 'server_error' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    await expect(putToR2('u', clipShot.blob)).rejects.toMatchObject({ code: 'server_error' })
  })

  it('scales the PUT timeout with size', () => {
    expect(putTimeoutMs(0)).toBe(30_000)
    expect(putTimeoutMs(50 * 1024 * 1024)).toBe(30_000 + 50 * 2_000)
  })
})

describe('getServerRoll', () => {
  beforeEach(() => {
    queryCalls.length = 0
    queryResult = { data: [], error: null }
  })

  it('reads shots through RLS with the device token header on that request', async () => {
    queryResult = {
      data: [
        { client_shot_id: 'a', type: 'photo', upload_status: 'uploaded', captured_at: '2026-09-19T12:00:00+00:00' },
        { client_shot_id: null, type: 'photo', upload_status: 'local', captured_at: null }, // legacy row
      ],
      error: null,
    }
    const roll = await getServerRoll('tok-123')

    expect(queryCalls).toContainEqual(['from', ['shots']])
    expect(queryCalls).toContainEqual(['setHeader', ['x-device-token', 'tok-123']])
    expect(queryCalls.find(([m]) => m === 'abortSignal')?.[1][0]).toBeInstanceOf(AbortSignal)
    const select = queryCalls.find(([m]) => m === 'select')?.[1][0] as string
    expect(select).not.toMatch(/r2_key|guest_id|device_token/) // metadata only
    expect(roll).toEqual([
      { clientShotId: 'a', type: 'photo', uploadStatus: 'uploaded', capturedAt: '2026-09-19T12:00:00+00:00' },
    ])
  })

  it('throws on a read error so the caller falls back to the device roll', async () => {
    queryResult = { data: null, error: { message: 'offline' } }
    await expect(getServerRoll('tok')).rejects.toThrow()
  })
})

describe('issueViewUrls', () => {
  it('asks for URLs for the given ids and returns the map', async () => {
    invoke.mockResolvedValue({ data: { urls: { a: 'https://r2/a' }, expiresIn: 600 }, error: null })
    await expect(issueViewUrls('tok', ['a', 'b'])).resolves.toEqual({
      urls: { a: 'https://r2/a' },
      expiresIn: 600,
    })
    const [name, opts] = invoke.mock.calls[0]
    expect(name).toBe('issue-view-urls')
    expect(opts.body).toEqual({ deviceToken: 'tok', clientShotIds: ['a', 'b'] })
    expect(opts.timeout).toBeGreaterThan(0)
  })

  it('throws on a function error', async () => {
    invoke.mockResolvedValue(typedError('guest_not_found'))
    await expect(issueViewUrls('tok', ['a'])).rejects.toThrow()
  })
})

describe('confirmUpload', () => {
  it('confirms by client shot id with a timeout', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await confirmUpload('tok', clipShot.id)
    const [name, opts] = invoke.mock.calls[0]
    expect(name).toBe('confirm-upload')
    expect(opts.body).toEqual({ deviceToken: 'tok', clientShotId: clipShot.id })
    expect(opts.timeout).toBeGreaterThan(0)
  })

  it('surfaces a not-yet-visible object as UploadError("not_uploaded")', async () => {
    invoke.mockResolvedValue(typedError('not_uploaded'))
    await expect(confirmUpload('tok', clipShot.id)).rejects.toMatchObject({
      name: 'UploadError',
      code: 'not_uploaded',
    })
  })
})
