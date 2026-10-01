import { describe, it, expect } from 'vitest'
import { allowedOrigin, parseAllowedOrigins, withCors } from './cors'

describe('parseAllowedOrigins', () => {
  it('splits, trims, drops trailing slashes and empties', () => {
    expect(parseAllowedOrigins(' https://a.com/ , https://B.com,, ')).toEqual(['https://a.com', 'https://b.com'])
    expect(parseAllowedOrigins(undefined)).toEqual([])
    expect(parseAllowedOrigins('')).toEqual([])
    expect(parseAllowedOrigins(' , ')).toEqual([])
  })
  it('a pasted URL with a path keeps only its origin; * stays *', () => {
    expect(parseAllowedOrigins('https://cam.example.com/operator, *')).toEqual(['https://cam.example.com', '*'])
    expect(parseAllowedOrigins('https://cam.example.com:443')).toEqual(['https://cam.example.com'])
  })
})

describe('allowedOrigin', () => {
  const list = ['https://cam.example.com', 'https://dispo.pages.dev']
  it('no list (local dev) keeps *', () => {
    expect(allowedOrigin('https://anything.example', [])).toBe('*')
    expect(allowedOrigin(null, [])).toBe('*')
  })
  it('echoes a listed origin (case and trailing slash forgiven), refuses others', () => {
    expect(allowedOrigin('https://cam.example.com', list)).toBe('https://cam.example.com')
    expect(allowedOrigin('https://CAM.example.com', list)).toBe('https://CAM.example.com')
    expect(allowedOrigin('https://evil.example', list)).toBeNull()
    expect(allowedOrigin('https://cam.example.com.evil.example', list)).toBeNull()
    expect(allowedOrigin('http://cam.example.com', list)).toBeNull() // scheme matters
    expect(allowedOrigin(null, list)).toBeNull()
    expect(allowedOrigin('null', list)).toBeNull() // sandboxed / file:// pages
  })
  it('a * entry means everyone', () => {
    expect(allowedOrigin('https://anything.example', ['https://cam.example.com', '*'])).toBe('*')
  })
})

describe('withCors', () => {
  const handler = async (req: Request) =>
    req.method === 'OPTIONS'
      ? new Response('ok', {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'authorization, x-device-token',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
          },
        })
      : new Response(JSON.stringify({ error: { code: 'not_operator' } }), {
          status: 403,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        })
  const req = (method: string, origin?: string) =>
    new Request('https://fn.example/x', { method, headers: origin ? { Origin: origin } : {} })

  it('unset: today’s answer, byte for byte', async () => {
    const res = await withCors(handler, () => undefined)(req('POST', 'https://evil.example'))
    expect(res.status).toBe(403)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Vary')).toBeNull()
    expect(await res.json()).toEqual({ error: { code: 'not_operator' } })
  })

  it('the site gets its origin echoed (preflight included), with Vary: Origin', async () => {
    const wrapped = withCors(handler, () => 'https://cam.example.com')
    const pre = await wrapped(req('OPTIONS', 'https://cam.example.com'))
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('https://cam.example.com')
    expect(pre.headers.get('Access-Control-Allow-Headers')).toBe('authorization, x-device-token')
    expect(pre.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect(pre.headers.get('Vary')).toBe('Origin')
    const post = await wrapped(req('POST', 'https://cam.example.com'))
    expect(post.status).toBe(403)
    expect(post.headers.get('Content-Type')).toBe('application/json')
  })

  it('a foreign site gets no allowed-origin header; status and body unchanged', async () => {
    const res = await withCors(handler, () => 'https://cam.example.com')(req('POST', 'https://evil.example'))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Vary')).toBe('Origin')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: { code: 'not_operator' } })
    const pre = await withCors(handler, () => 'https://cam.example.com')(req('OPTIONS', 'https://evil.example'))
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('keeps a handler’s own Vary and never repeats Origin', async () => {
    const own = async () => new Response(null, { status: 204, headers: { Vary: 'Accept-Encoding' } })
    const res = await withCors(own, () => 'https://cam.example.com')(req('POST', 'https://cam.example.com'))
    expect(res.status).toBe(204)
    expect(res.headers.get('Vary')).toBe('Accept-Encoding, Origin')
    const already = async () => new Response(null, { status: 204, headers: { Vary: 'Origin' } })
    expect((await withCors(already, () => 'https://cam.example.com')(req('POST', 'https://cam.example.com'))).headers.get('Vary')).toBe('Origin')
  })

  it('a handler that throws still answers a readable JSON 500 for the site', async () => {
    const boom = async () => {
      throw new Error('kaboom')
    }
    const res = await withCors(boom, () => 'https://cam.example.com')(req('POST', 'https://cam.example.com'))
    expect(res.status).toBe(500)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://cam.example.com')
    expect(await res.json()).toEqual({ error: { code: 'server_error', message: 'Something went wrong.' } })
  })
})
