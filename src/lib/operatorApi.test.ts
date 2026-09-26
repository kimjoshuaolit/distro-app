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
