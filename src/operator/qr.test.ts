import { describe, it, expect } from 'vitest'
import QRCode from 'qrcode'
import { isLocalOrigin, joinUrl, QR_OPTIONS, qrFilename } from './qr'

const EVENT = '650579b4-d2fd-499f-909f-02b292bfcf61'

describe('joinUrl', () => {
  it('points at the guest join route', () => {
    expect(joinUrl('https://dispo.example.com', EVENT)).toBe(`https://dispo.example.com/j/${EVENT}`)
    expect(joinUrl('https://dispo.example.com/', EVENT)).toBe(`https://dispo.example.com/j/${EVENT}`)
  })
})

describe('isLocalOrigin', () => {
  it('flags origins guests can’t reach', () => {
    for (const o of [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://127.1.2.3',
      'http://[::1]:5173',
      'http://0.0.0.0:5173',
      'http://app.localhost',
      'http://x.test',
      'http://kims-laptop.local:5173',
      'http://192.168.1.20:5173',
      'http://10.0.0.5',
      'http://172.16.0.9',
      'http://172.31.255.1',
      'http://169.254.10.10',
      'nonsense',
    ]) {
      expect(isLocalOrigin(o), o).toBe(true)
    }
  })
  it('passes real sites and public addresses', () => {
    for (const o of ['https://dispo-retro-cam.pages.dev', 'https://camera.example.com', 'http://172.32.0.1', 'http://8.8.8.8']) {
      expect(isLocalOrigin(o), o).toBe(false)
    }
  })
})

describe('qrFilename', () => {
  it('slugs the couple names', () => {
    expect(qrFilename('Ana & Ben', EVENT)).toBe('qr-ana-ben.png')
    expect(qrFilename('  Zoë   &  José! ', EVENT)).toBe('qr-zoe-jose.png')
  })
  it('falls back to the event id', () => {
    expect(qrFilename(null, EVENT)).toBe('qr-650579b4.png')
    expect(qrFilename('💍', EVENT)).toBe('qr-650579b4.png')
  })
})

describe('the QR itself', () => {
  it('pins the print options: error correction M and a quiet zone', () => {
    expect(QR_OPTIONS).toEqual({ errorCorrectionLevel: 'M', margin: 3 })
  })

  it('encodes exactly the join URL', () => {
    const url = joinUrl('https://camera.example.com', EVENT)
    const qr = QRCode.create(url, QR_OPTIONS)
    const encoded = qr.segments.map((s: { data: Uint8Array | string }) =>
      typeof s.data === 'string' ? s.data : new TextDecoder().decode(s.data),
    ).join('')
    expect(encoded).toBe(url)
    expect(qr.errorCorrectionLevel.bit).toBe(QRCode.create('x', { errorCorrectionLevel: 'M' }).errorCorrectionLevel.bit)
  })

  it('renders as an SVG whose quiet zone matches the margin', async () => {
    const url = joinUrl('https://camera.example.com', EVENT)
    const svg = await QRCode.toString(url, { ...QR_OPTIONS, type: 'svg' })
    const size = QRCode.create(url, QR_OPTIONS).modules.size
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain(`viewBox="0 0 ${size + 2 * QR_OPTIONS.margin} ${size + 2 * QR_OPTIONS.margin}"`)
  })
})

describe('qrFilename edge', () => {
  it('never ends in a hyphen after the 40-character cut', () => {
    const name = qrFilename('Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa & Bob', EVENT)
    expect(name).toMatch(/^qr-[a-z0-9-]*[a-z0-9]\.png$/)
  })
})
