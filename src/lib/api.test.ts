import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const invoke = vi.fn()

// A chainable postgrest-style query recorder: every builder call is logged and
// the awaited result is `queryResponder(calls of this query)` when set, else
// whatever `queryResult` holds.
type QueryResult = { data: unknown; error: unknown }
const queryCalls: Array<[string, unknown[]]> = []
let queryResult: QueryResult = { data: [], error: null }
let queryResponder: ((calls: Array<[string, unknown[]]>) => QueryResult) | null = null
const from = vi.fn((table: string) => {
  const own: Array<[string, unknown[]]> = [['from', [table]]]
  queryCalls.push(['from', [table]])
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'range', 'setHeader', 'abortSignal']) {
    builder[m] = (...args: unknown[]) => {
      queryCalls.push([m, args])
      own.push([m, args])
      return builder
    }
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(queryResponder ? queryResponder(own) : queryResult)
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
  getCollection,
  issueCoupleViewUrls,
  COLLECTION_PAGE_SIZE,
  COLLECTION_GUEST_CHUNK,
} = await import('./api.ts')

const OPEN_ID = '00000000-0000-0000-0000-000000000001'

beforeEach(() => {
  rpc.mockReset()
  invoke.mockReset()
  queryResponder = null
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
    const roll = await getServerRoll('tok-123', 'guest-1')

    expect(queryCalls).toContainEqual(['from', ['shots']])
    expect(queryCalls).toContainEqual(['setHeader', ['x-device-token', 'tok-123']])
    // Pinned to this guest even if a couple session could see the whole event.
    expect(queryCalls).toContainEqual(['eq', ['guest_id', 'guest-1']])
    expect(queryCalls.find(([m]) => m === 'abortSignal')?.[1][0]).toBeInstanceOf(AbortSignal)
    const select = queryCalls.find(([m]) => m === 'select')?.[1][0] as string
    expect(select).not.toMatch(/r2_key|guest_id|device_token/) // metadata only
    expect(roll).toEqual([
      { clientShotId: 'a', type: 'photo', uploadStatus: 'uploaded', capturedAt: '2026-09-19T12:00:00+00:00' },
    ])
  })

  it('throws on a read error so the caller falls back to the device roll', async () => {
    queryResult = { data: null, error: { message: 'offline' } }
    await expect(getServerRoll('tok', 'guest-1')).rejects.toThrow()
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

describe('getCollection', () => {
  const EVENT = '00000000-0000-0000-0000-0000000000e1'
  const guestId = (n: number) => `g${String(n).padStart(4, '0')}`
  const arg = (calls: Array<[string, unknown[]]>, m: string) => calls.find(([name]) => name === m)?.[1]

  // Serve `guests` and `shots` tables from arrays, honoring eq/in/range like PostgREST.
  function serve(guests: Array<Record<string, unknown>>, shots: Array<Record<string, unknown>>) {
    queryResponder = (calls) => {
      const table = arg(calls, 'from')?.[0]
      let rows = table === 'guests' ? guests : shots
      for (const [m, args] of calls) {
        if (m === 'eq') rows = rows.filter((r) => r[args[0] as string] === args[1])
        if (m === 'in') rows = rows.filter((r) => (args[1] as unknown[]).includes(r[args[0] as string]))
      }
      const [lo, hi] = (arg(calls, 'range') ?? [0, rows.length]) as [number, number]
      return { data: rows.slice(lo, hi + 1), error: null }
    }
  }

  beforeEach(() => {
    queryCalls.length = 0
    queryResult = { data: [], error: null }
    queryResponder = null
  })

  it('reads the event\'s guests, then only their uploaded shots — metadata, never keys', async () => {
    serve(
      [
        { id: 'g1', event_id: EVENT, first_name: 'Rosa', created_at: '2026-09-19T10:00:00+00:00' },
        { id: 'g9', event_id: 'other-event', first_name: 'Uma', created_at: null },
      ],
      [
        { id: 's1', guest_id: 'g1', type: 'photo', captured_at: '2026-09-19T12:00:00+00:00', upload_status: 'uploaded' },
        { id: 's2', guest_id: 'g1', type: 'clip', captured_at: null, upload_status: 'local' },
        // Visible through RLS for another reason (e.g. another event), not this event's guest.
        { id: 's9', guest_id: 'g9', type: 'photo', captured_at: null, upload_status: 'uploaded' },
      ],
    )
    await expect(getCollection(EVENT)).resolves.toEqual({
      guests: [{ id: 'g1', firstName: 'Rosa', createdAt: '2026-09-19T10:00:00+00:00' }],
      shots: [{ id: 's1', guestId: 'g1', type: 'photo', capturedAt: '2026-09-19T12:00:00+00:00' }],
    })

    expect(queryCalls).toContainEqual(['eq', ['event_id', EVENT]])
    expect(queryCalls).toContainEqual(['eq', ['upload_status', 'uploaded']])
    expect(queryCalls).toContainEqual(['in', ['guest_id', ['g1']]])
    const selects = queryCalls.filter(([m]) => m === 'select').map(([, a]) => a[0] as string)
    expect(selects.join(' ')).not.toMatch(/r2_key|device_token|remaining/)
    expect(queryCalls.filter(([m]) => m === 'abortSignal').every(([, a]) => a[0] instanceof AbortSignal)).toBe(true)
  })

  it('does not read shots at all when the event has no guests', async () => {
    serve([], [])
    await expect(getCollection(EVENT)).resolves.toEqual({ guests: [], shots: [] })
    expect(queryCalls).not.toContainEqual(['from', ['shots']])
  })

  it('pages past max_rows until a short page, so large events load whole', async () => {
    const shots = Array.from({ length: COLLECTION_PAGE_SIZE * 2 + 5 }, (_, i) => ({
      id: `s${String(i).padStart(5, '0')}`,
      guest_id: 'g1',
      type: 'photo',
      captured_at: null,
      upload_status: 'uploaded',
    }))
    serve([{ id: 'g1', event_id: EVENT, first_name: 'Rosa', created_at: null }], shots)

    const { shots: got } = await getCollection(EVENT)
    expect(got).toHaveLength(COLLECTION_PAGE_SIZE * 2 + 5)
    expect(new Set(got.map((s) => s.id)).size).toBe(got.length)
    const ranges = queryCalls.filter(([m]) => m === 'range').map(([, a]) => a)
    // guests: one page; shots: three pages.
    expect(ranges).toEqual([
      [0, COLLECTION_PAGE_SIZE - 1],
      [0, COLLECTION_PAGE_SIZE - 1],
      [COLLECTION_PAGE_SIZE, COLLECTION_PAGE_SIZE * 2 - 1],
      [COLLECTION_PAGE_SIZE * 2, COLLECTION_PAGE_SIZE * 3 - 1],
    ])
    // Stable pages: ordered by a unique column.
    expect(queryCalls).toContainEqual(['order', ['id', { ascending: true }]])
  })

  it('filters shots in chunks of guest ids so the URL stays short', async () => {
    const guests = Array.from({ length: COLLECTION_GUEST_CHUNK + 1 }, (_, i) => ({
      id: guestId(i),
      event_id: EVENT,
      first_name: `G${i}`,
      created_at: null,
    }))
    const shots = guests.map((g, i) => ({ id: `s${i}`, guest_id: g.id, type: 'photo', captured_at: null, upload_status: 'uploaded' }))
    serve(guests, shots)

    const { shots: got } = await getCollection(EVENT)
    expect(got).toHaveLength(COLLECTION_GUEST_CHUNK + 1)
    const ins = queryCalls.filter(([m]) => m === 'in').map(([, a]) => (a[1] as string[]).length)
    expect(ins).toEqual([COLLECTION_GUEST_CHUNK, 1])
  })

  it('throws when any read fails (the screen offers a retry, never a blank shelf)', async () => {
    queryResponder = (calls) =>
      arg(calls, 'from')?.[0] === 'shots'
        ? { data: null, error: { message: 'offline' } }
        : { data: [{ id: 'g1', first_name: 'Rosa', created_at: null }], error: null }
    await expect(getCollection(EVENT)).rejects.toThrow()

    queryResponder = () => ({ data: null, error: { message: 'offline' } })
    await expect(getCollection(EVENT)).rejects.toThrow()
  })
})

describe('issueCoupleViewUrls', () => {
  it('asks for URLs for the event\'s shot ids with a timeout and returns the map', async () => {
    invoke.mockResolvedValue({ data: { urls: { s1: 'https://r2/s1' }, expiresIn: 600 }, error: null })
    await expect(issueCoupleViewUrls('ev', ['s1', 's2'])).resolves.toEqual({
      urls: { s1: 'https://r2/s1' },
      expiresIn: 600,
    })
    const [name, opts] = invoke.mock.calls[0]
    expect(name).toBe('issue-couple-view-urls')
    expect(opts.body).toEqual({ eventId: 'ev', shotIds: ['s1', 's2'] })
    expect(opts.timeout).toBeGreaterThan(0)
  })

  it('throws on a 403 (not this event\'s couple) or a 400', async () => {
    invoke.mockResolvedValue(typedError('not_couple', 'This reveal belongs to another couple.'))
    await expect(issueCoupleViewUrls('ev', ['s1'])).rejects.toThrow('This reveal belongs to another couple.')
    invoke.mockResolvedValue(typedError('bad_request'))
    await expect(issueCoupleViewUrls('ev', ['s1'])).rejects.toThrow()
  })

  it('throws on a transport failure, and treats a missing lifetime as uncacheable', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    await expect(issueCoupleViewUrls('ev', ['s1'])).rejects.toThrow()
    invoke.mockResolvedValue({ data: { urls: {} }, error: null })
    await expect(issueCoupleViewUrls('ev', ['s1'])).resolves.toEqual({ urls: {}, expiresIn: 0 })
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
