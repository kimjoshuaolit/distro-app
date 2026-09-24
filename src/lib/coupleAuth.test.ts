import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const signInWithOtp = vi.fn()
const signOutMock = vi.fn()

const queryCalls: Array<[string, unknown[]]> = []
let queryResult: { data: unknown; error: unknown; status?: number } = { data: null, error: null }
const from = vi.fn((table: string) => {
  queryCalls.push(['from', [table]])
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'abortSignal']) {
    builder[m] = (...args: unknown[]) => {
      queryCalls.push([m, args])
      return builder
    }
  }
  builder.maybeSingle = () => {
    queryCalls.push(['maybeSingle', []])
    return Promise.resolve(queryResult)
  }
  return builder
})

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => from(table),
    auth: {
      signInWithOtp: (...args: unknown[]) => signInWithOtp(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
    },
  },
}))

const {
  normalizeEmail,
  isValidEmail,
  parseAuthRedirectError,
  mapOtpError,
  checkCoupleEmail,
  requestMagicLink,
  getCoupleEvent,
  signOut,
  isEventId,
  AccessCheckError,
} = await import('./coupleAuth.ts')

const EVENT = '00000000-0000-0000-0000-000000000001'

beforeEach(() => {
  rpc.mockReset()
  signInWithOtp.mockReset()
  signOutMock.mockReset()
  queryCalls.length = 0
  queryResult = { data: null, error: null }
})

describe('normalizeEmail / isValidEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Partner.One@Example.TEST ')).toBe('partner.one@example.test')
  })

  it('accepts ordinary addresses in any case', () => {
    expect(isValidEmail('partner.one@example.test')).toBe(true)
    expect(isValidEmail(' ROSA+wedding@Mail.co.uk ')).toBe(true)
  })

  it('rejects malformed input', () => {
    for (const bad of ['', '   ', 'rosa', 'rosa@', '@example.test', 'rosa@example', 'ro sa@example.test', 'a@b@c.d']) {
      expect(isValidEmail(bad), bad).toBe(false)
    }
  })

  it('rejects absurdly long input', () => {
    expect(isValidEmail(`${'a'.repeat(250)}@example.test`)).toBe(false)
  })
})

describe('parseAuthRedirectError', () => {
  it('returns null for a normal or empty hash', () => {
    expect(parseAuthRedirectError('')).toBeNull()
    expect(parseAuthRedirectError('#')).toBeNull()
    expect(parseAuthRedirectError('#access_token=abc&refresh_token=def&type=magiclink')).toBeNull()
  })

  it('maps an expired or already-used link to expired', () => {
    expect(
      parseAuthRedirectError(
        '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ),
    ).toBe('expired')
  })

  it('maps any other auth error to invalid', () => {
    expect(parseAuthRedirectError('#error=server_error&error_description=boom')).toBe('invalid')
    expect(parseAuthRedirectError('error_code=bad_jwt')).toBe('invalid')
  })
})

describe('mapOtpError', () => {
  it('maps rate limits', () => {
    expect(mapOtpError({ status: 429, code: 'over_email_send_rate_limit' })).toBe('rate_limited')
    expect(mapOtpError({ status: 429 })).toBe('rate_limited')
    expect(mapOtpError({ code: 'over_request_rate_limit' })).toBe('rate_limited')
  })

  it('maps the before_user_created hook refusal (403) to not_listed', () => {
    expect(mapOtpError({ status: 403, code: 'unknown' })).toBe('not_listed')
  })

  it('maps an invalid address', () => {
    expect(mapOtpError({ status: 400, code: 'email_address_invalid' })).toBe('invalid_email')
    expect(mapOtpError({ status: 422, code: 'validation_failed' })).toBe('invalid_email')
  })

  it('falls back to failed', () => {
    expect(mapOtpError({ status: 500 })).toBe('failed')
    expect(mapOtpError({ status: 0 })).toBe('failed') // network
    expect(mapOtpError(null)).toBe('failed')
  })
})

describe('checkCoupleEmail', () => {
  it('asks the database with the normalized email', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    await expect(checkCoupleEmail(EVENT, ' Partner.One@Example.test ')).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('couple_can_sign_in', {
      p_event_id: EVENT,
      p_email: 'partner.one@example.test',
    })
  })

  it('returns false for an unlisted email', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    await expect(checkCoupleEmail(EVENT, 'stranger@example.test')).resolves.toBe(false)
  })

  it('returns false for a malformed event id without a request', async () => {
    await expect(checkCoupleEmail('nope', 'partner.one@example.test')).resolves.toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('throws on a transport failure (not "not on the list")', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'offline' } })
    await expect(checkCoupleEmail(EVENT, 'partner.one@example.test')).rejects.toThrow()
  })
})

describe('requestMagicLink', () => {
  it('sends a link back to this event’s reveal, creating the account if needed', async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null })
    await expect(requestMagicLink(EVENT, ' Partner.One@Example.test', 'http://localhost:5173')).resolves.toEqual({
      ok: true,
    })
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'partner.one@example.test',
      options: {
        emailRedirectTo: `http://localhost:5173/reveal/${EVENT}`,
        shouldCreateUser: true,
      },
    })
  })

  it('reports a rate limit', async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: { status: 429, code: 'over_email_send_rate_limit' } })
    await expect(requestMagicLink(EVENT, 'a@b.co', 'http://x')).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
    })
  })

  it('reports a hook refusal as not on the list', async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: { status: 403, code: 'unknown' } })
    await expect(requestMagicLink(EVENT, 'a@b.co', 'http://x')).resolves.toEqual({
      ok: false,
      reason: 'not_listed',
    })
  })
})

describe('getCoupleEvent', () => {
  it('is granted when RLS returns the event row', async () => {
    queryResult = { data: { id: EVENT }, error: null }
    await expect(getCoupleEvent(EVENT)).resolves.toBe('granted')
    expect(queryCalls).toContainEqual(['from', ['events']])
    expect(queryCalls).toContainEqual(['eq', ['id', EVENT]])
  })

  it('is denied when RLS returns nothing (another couple’s or unknown event)', async () => {
    queryResult = { data: null, error: null }
    await expect(getCoupleEvent(EVENT)).resolves.toBe('denied')
  })

  it('denies a malformed id without a request', async () => {
    await expect(getCoupleEvent('not-a-uuid')).resolves.toBe('denied')
    expect(queryCalls).toEqual([])
  })

  it('reads with a timeout so a hung request becomes a (transient) failure', async () => {
    queryResult = { data: { id: EVENT }, error: null, status: 200 }
    await getCoupleEvent(EVENT)
    expect(queryCalls.find(([m]) => m === 'abortSignal')?.[1][0]).toBeInstanceOf(AbortSignal)
  })

  it('throws AccessCheckError with the HTTP status and code, never "denied"', async () => {
    queryResult = { data: null, error: { message: 'JWT expired', code: 'PGRST303' }, status: 401 }
    const err = await getCoupleEvent(EVENT).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AccessCheckError)
    expect(err).toMatchObject({ name: 'AccessCheckError', status: 401, code: 'PGRST303' })
  })

  it('a network failure surfaces as status 0', async () => {
    queryResult = { data: null, error: { message: 'FetchError: Failed to fetch', code: '' }, status: 0 }
    await expect(getCoupleEvent(EVENT)).rejects.toMatchObject({ status: 0, code: '' })
  })
})

describe('isEventId', () => {
  it('accepts a UUID and rejects anything else', () => {
    expect(isEventId(EVENT)).toBe(true)
    expect(isEventId('not-a-uuid')).toBe(false)
    expect(isEventId('')).toBe(false)
  })
})

describe('signOut', () => {
  it('signs out this device only', async () => {
    signOutMock.mockResolvedValue({ error: null })
    await signOut()
    expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('throws when sign-out fails', async () => {
    signOutMock.mockResolvedValue({ error: { message: 'offline' } })
    await expect(signOut()).rejects.toThrow()
  })
})
