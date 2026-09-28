import { describe, it, expect, vi, beforeEach } from 'vitest'

const signInWithOtp = vi.fn()
const invoke = vi.fn()
const rpcCalls: Array<[string, unknown]> = []
let rpcResult: Record<string, { data: unknown; error: unknown; status?: number }> = {}
const queryCalls: Array<[string, unknown[]]> = []
let queryResult: { data: unknown; error: unknown; status?: number } = { data: [], error: null }

function chain(result: () => unknown, log: Array<[string, unknown[]]>) {
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'abortSignal', 'maybeSingle']) {
    builder[m] = (...args: unknown[]) => {
      log.push([m, args])
      return builder
    }
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result())
  return builder
}

vi.mock('./supabase', () => ({
  supabase: {
    auth: { signInWithOtp: (...args: unknown[]) => signInWithOtp(...args) },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    rpc: (name: string, args?: unknown) => {
      rpcCalls.push([name, args])
      return chain(() => rpcResult[name] ?? { data: null, error: null }, [])
    },
    from: (table: string) => {
      queryCalls.push(['from', [table]])
      return chain(() => queryResult, queryCalls)
    },
  },
}))

const {
  requestOperatorLink,
  isOperator,
  listEvents,
  getEvent,
  getEventSummary,
  getParticipation,
  listExportShots,
  issueExportUrls,
  saveEvent,
  setWindow,
  SaveEventError,
  WindowError,
  OperatorReadError,
} = await import('./operatorApi.ts')

const EVENT = '00000000-0000-0000-0000-000000000001'
const row = { id: EVENT, couple_names: 'Ana & Ben', window_open: '2026-11-14T06:00:00+00:00', window_close: '2026-11-14T18:00:00+00:00' }
const typedError = (code: string, message = 'x', field?: string) => ({
  data: null,
  error: { context: new Response(JSON.stringify({ error: { code, message, field } })) },
})

beforeEach(() => {
  signInWithOtp.mockReset()
  invoke.mockReset()
  rpcCalls.length = 0
  queryCalls.length = 0
  rpcResult = {}
  queryResult = { data: [], error: null }
})

describe('requestOperatorLink', () => {
  it('sends a normalized magic link back to /operator (which also picks the email wording)', async () => {
    signInWithOtp.mockResolvedValue({ error: null })
    await expect(requestOperatorLink(' Kim@Example.TEST ', 'https://app.test')).resolves.toEqual({ ok: true })
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'kim@example.test',
      options: { emailRedirectTo: 'https://app.test/operator', shouldCreateUser: true },
    })
  })

  it('maps the hook’s refusal to not_listed and rate limits to rate_limited', async () => {
    signInWithOtp.mockResolvedValue({ error: { status: 403 } })
    await expect(requestOperatorLink('x@example.test', 'o')).resolves.toEqual({ ok: false, reason: 'not_listed' })
    signInWithOtp.mockResolvedValue({ error: { status: 429 } })
    await expect(requestOperatorLink('x@example.test', 'o')).resolves.toEqual({ ok: false, reason: 'rate_limited' })
  })
})

describe('isOperator', () => {
  it('is true only when is_operator() answers true', async () => {
    rpcResult.is_operator = { data: true, error: null }
    await expect(isOperator()).resolves.toBe(true)
    rpcResult.is_operator = { data: false, error: null }
    await expect(isOperator()).resolves.toBe(false)
    rpcResult.is_operator = { data: 'true', error: null }
    await expect(isOperator()).resolves.toBe(false)
  })

  it('a failed check throws with its status (401 → sign out, else retry)', async () => {
    rpcResult.is_operator = { data: null, error: { message: 'jwt expired' }, status: 401 }
    const err = await isOperator().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OperatorReadError)
    expect(err).toMatchObject({ status: 401 })
  })
})

describe('listEvents', () => {
  it('reads through operator_events() — never the events table (that is the couple gate)', async () => {
    rpcResult.operator_events = { data: [row], error: null }
    await expect(listEvents()).resolves.toEqual([
      { id: EVENT, coupleNames: 'Ana & Ben', windowOpen: row.window_open, windowClose: row.window_close },
    ])
    expect(rpcCalls).toContainEqual(['operator_events', undefined])
    expect(queryCalls).toEqual([])
  })

  it('a non-operator simply gets none; a failure throws OperatorReadError', async () => {
    rpcResult.operator_events = { data: [], error: null }
    await expect(listEvents()).resolves.toEqual([])
    rpcResult.operator_events = { data: null, error: { message: 'x' }, status: 500 }
    await expect(listEvents()).rejects.toMatchObject({ name: 'OperatorReadError', status: 500 })
  })
})

describe('getEvent', () => {
  it('returns the event with its couple emails', async () => {
    rpcResult.operator_events = { data: [row], error: null }
    rpcResult.operator_couple_emails = { data: ['ana@example.test', 'ben@example.test'], error: null }
    await expect(getEvent(EVENT)).resolves.toMatchObject({
      id: EVENT,
      coupleNames: 'Ana & Ben',
      coupleEmails: ['ana@example.test', 'ben@example.test'],
    })
    expect(rpcCalls).toContainEqual(['operator_events', { p_event_id: EVENT }])
    expect(rpcCalls).toContainEqual(['operator_couple_emails', { p_event_id: EVENT }])
    expect(queryCalls).toEqual([])
  })

  it('a malformed id is "not found" without asking the server', async () => {
    for (const id of ['nope', '', '00000000-0000-0000-0000-00000000000']) {
      await expect(getEvent(id)).resolves.toBeNull()
    }
    expect(rpcCalls).toEqual([])
  })

  it('null when the event isn’t there; throws when either read fails', async () => {
    rpcResult.operator_events = { data: [], error: null }
    await expect(getEvent(EVENT)).resolves.toBeNull()
    rpcResult.operator_events = { data: [row], error: null }
    rpcResult.operator_couple_emails = { data: null, error: { message: 'x' }, status: 500 }
    await expect(getEvent(EVENT)).rejects.toMatchObject({ name: 'OperatorReadError' })
  })
})

describe('getEventSummary', () => {
  it('reads only operator_events — never the couple emails', async () => {
    rpcResult.operator_events = { data: [row], error: null }
    await expect(getEventSummary(EVENT)).resolves.toEqual({
      id: EVENT,
      coupleNames: 'Ana & Ben',
      windowOpen: row.window_open,
      windowClose: row.window_close,
    })
    expect(rpcCalls).toEqual([['operator_events', { p_event_id: EVENT }]])
  })

  it('null for a missing event or a malformed id; throws when the read fails', async () => {
    rpcResult.operator_events = { data: [], error: null }
    await expect(getEventSummary(EVENT)).resolves.toBeNull()
    await expect(getEventSummary('nope')).resolves.toBeNull()
    rpcResult.operator_events = { data: null, error: { message: 'x' }, status: 500 }
    await expect(getEventSummary(EVENT)).rejects.toMatchObject({ name: 'OperatorReadError', status: 500 })
  })
})

describe('getParticipation', () => {
  const guest = {
    guest_id: '00000000-0000-0000-0000-0000000000a1',
    first_name: 'Rosa',
    joined_at: '2026-11-14T20:00:00+00:00',
    photos_saved: 3,
    clips_saved: 1,
    on_the_way: 2,
    last_shot_at: null,
  }

  it('reads through operator_participation (never a table) and maps the rows', async () => {
    rpcResult.operator_participation = { data: [guest, { junk: true }], error: null }
    await expect(getParticipation(EVENT)).resolves.toEqual([
      { guestId: guest.guest_id, firstName: 'Rosa', joinedAt: guest.joined_at, photosSaved: 3, clipsSaved: 1, onTheWay: 2, lastShotAt: null },
    ])
    expect(rpcCalls).toEqual([['operator_participation', { p_event_id: EVENT }]])
    expect(queryCalls).toEqual([])
  })

  it('a malformed id has no guests, without asking the server', async () => {
    await expect(getParticipation('nope')).resolves.toEqual([])
    expect(rpcCalls).toEqual([])
  })

  it('throws OperatorReadError with the status when the read fails', async () => {
    rpcResult.operator_participation = { data: null, error: { message: 'x' }, status: 503 }
    await expect(getParticipation(EVENT)).rejects.toMatchObject({ name: 'OperatorReadError', status: 503 })
  })
})

describe('listExportShots', () => {
  const shotRow = (n: number) => ({
    shot_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    guest_id: '00000000-0000-4000-8000-0000000000a1',
    type: n % 2 ? 'photo' : 'clip',
    taken_at: '2026-11-14T21:00:00+00:00',
    ext: n % 2 ? 'jpg' : 'mp4',
  })

  it('reads through operator_export_shots and maps rows (never a table)', async () => {
    const page = [shotRow(1), shotRow(2), { junk: 1 }, { ...shotRow(3), type: 'gif' }]
    let call = 0
    rpcResult = new Proxy({} as typeof rpcResult, { get: () => ({ data: call++ === 0 ? page : [], error: null }) })
    const shots = await listExportShots(EVENT)
    expect(shots).toEqual([
      { shotId: shotRow(1).shot_id, guestId: shotRow(1).guest_id, type: 'photo', takenAt: shotRow(1).taken_at, ext: 'jpg' },
      { shotId: shotRow(2).shot_id, guestId: shotRow(2).guest_id, type: 'clip', takenAt: shotRow(2).taken_at, ext: 'mp4' },
    ])
    expect(rpcCalls[0]).toEqual(['operator_export_shots', { p_event_id: EVENT, p_after: null }])
    expect(rpcCalls).toHaveLength(2) // then an empty page ends it
    expect(queryCalls).toEqual([])
  })

  it('a page that doesn’t move past the last id stops the listing (no duplicates)', async () => {
    rpcResult.operator_export_shots = { data: [shotRow(1)], error: null } // the same page every time
    await expect(listExportShots(EVENT)).resolves.toHaveLength(1)
    expect(rpcCalls).toHaveLength(2)
  })

  it('follows pages with the last id seen until an empty page — whatever the page size', async () => {
    const pages = [
      Array.from({ length: 500 }, (_, i) => shotRow(i + 1)), // a server cap below the function's 1000
      [shotRow(501)],
      [],
    ]
    let call = 0
    rpcResult = new Proxy({} as typeof rpcResult, {
      get: () => ({ data: pages[Math.min(call++, pages.length - 1)], error: null }),
    })
    const shots = await listExportShots(EVENT)
    expect(shots).toHaveLength(501)
    expect(rpcCalls.map((c) => (c[1] as { p_after: unknown }).p_after)).toEqual([null, shotRow(500).shot_id, shotRow(501).shot_id])
  })

  it('a malformed id lists nothing without asking; a failed read throws', async () => {
    await expect(listExportShots('nope')).resolves.toEqual([])
    expect(rpcCalls).toEqual([])
    rpcResult.operator_export_shots = { data: null, error: { message: 'x' }, status: 500 }
    await expect(listExportShots(EVENT)).rejects.toMatchObject({ name: 'OperatorReadError', status: 500 })
  })
})

describe('issueExportUrls', () => {
  it('posts ids (and the montage flag) to issue-export-urls and returns the links', async () => {
    invoke.mockResolvedValue({ data: { urls: { a: 'https://r2/a', b: 7 }, montage: { url: 'https://r2/m', ext: 'mp4' }, expiresIn: 600 }, error: null })
    await expect(issueExportUrls(EVENT, ['a', 'b'], true)).resolves.toEqual({
      urls: { a: 'https://r2/a' },
      montage: { url: 'https://r2/m', ext: 'mp4' },
    })
    const [name, opts] = invoke.mock.calls[0]
    expect(name).toBe('issue-export-urls')
    expect(opts.body).toEqual({ eventId: EVENT, shotIds: ['a', 'b'], montage: true })
  })

  it('no montage hosted is null; a malformed montage answer is an error', async () => {
    invoke.mockResolvedValue({ data: { urls: {}, montage: null }, error: null })
    await expect(issueExportUrls(EVENT, [], true)).resolves.toEqual({ urls: {}, montage: null })
    invoke.mockResolvedValue({ data: { urls: {}, montage: { url: 1 } }, error: null })
    await expect(issueExportUrls(EVENT, [], true)).rejects.toMatchObject({ name: 'ExportError', code: 'server_error' })
    invoke.mockResolvedValue({ data: { urls: {} }, error: null })
    await expect(issueExportUrls(EVENT, [], true)).rejects.toMatchObject({ code: 'server_error' })
  })

  it('a token the gateway refuses (401) reads as not_operator', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response('{"msg":"Invalid JWT"}', { status: 401 }) } })
    await expect(issueExportUrls(EVENT, ['a'], false)).rejects.toMatchObject({ code: 'not_operator' })
  })

  it('carries the server code; a malformed answer is a server_error', async () => {
    invoke.mockResolvedValue(typedError('not_operator'))
    await expect(issueExportUrls(EVENT, ['a'], false)).rejects.toMatchObject({ code: 'not_operator' })
    invoke.mockResolvedValue({ data: { urls: [] }, error: null })
    await expect(issueExportUrls(EVENT, ['a'], false)).rejects.toMatchObject({ code: 'server_error' })
  })
})

describe('setWindow', () => {
  it('posts the action to set-window and returns the new window', async () => {
    invoke.mockResolvedValue({ data: { windowOpen: 'a', windowClose: 'b' }, error: null })
    await expect(setWindow(EVENT, 'close')).resolves.toEqual({ windowOpen: 'a', windowClose: 'b' })
    const [name, opts] = invoke.mock.calls[0]
    expect(name).toBe('set-window')
    expect(opts.body).toEqual({ eventId: EVENT, action: 'close' })
    expect(opts.timeout).toBeGreaterThan(0)
  })

  it('carries the server code; a malformed answer is a server_error', async () => {
    invoke.mockResolvedValue(typedError('not_operator'))
    const err = await setWindow(EVENT, 'open').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WindowError)
    expect(err).toMatchObject({ code: 'not_operator' })
    for (const data of [null, {}, { windowOpen: 'a' }, { windowOpen: 1, windowClose: 'b' }]) {
      invoke.mockResolvedValue({ data, error: null })
      await expect(setWindow(EVENT, 'open'), JSON.stringify(data)).rejects.toMatchObject({ code: 'server_error' })
    }
  })
})

describe('saveEvent', () => {
  const req = {
    eventId: null,
    coupleNames: 'Ana & Ben',
    windowOpen: '2026-11-14T06:00:00.000Z',
    windowClose: '2026-11-14T18:00:00.000Z',
    coupleEmails: ['ana@example.test'],
  }

  it('posts to save-event with a timeout and returns the saved id', async () => {
    invoke.mockResolvedValue({ data: { eventId: EVENT }, error: null })
    await expect(saveEvent(req)).resolves.toBe(EVENT)
    const [name, opts] = invoke.mock.calls[0]
    expect(name).toBe('save-event')
    expect(opts.body).toEqual(req)
    expect(opts.timeout).toBeGreaterThan(0)
  })

  it('carries the server code, message and blamed field', async () => {
    invoke.mockResolvedValue(typedError('bad_request', 'At most two couple emails.', 'coupleEmails'))
    const err = await saveEvent(req).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SaveEventError)
    expect(err).toMatchObject({ code: 'bad_request', message: 'At most two couple emails.', field: 'coupleEmails' })
    invoke.mockResolvedValue(typedError('not_operator'))
    await expect(saveEvent(req)).rejects.toMatchObject({ code: 'not_operator', field: null })
  })

  it('a transport failure or malformed response is a server_error', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    await expect(saveEvent(req)).rejects.toMatchObject({ code: 'server_error' })
    for (const data of [null, {}, { eventId: 42 }, { eventId: '' }]) {
      invoke.mockResolvedValue({ data, error: null })
      await expect(saveEvent(req), JSON.stringify(data)).rejects.toMatchObject({ code: 'server_error' })
    }
  })
})
