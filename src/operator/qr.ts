// Table-card QR helpers (Story 3.2). Pure; the QR itself is drawn in the
// browser by the `qrcode` package — never a third-party web service.

/** The guest join link a table-card QR encodes. */
export function joinUrl(origin: string, eventId: string): string {
  return `${origin.replace(/\/+$/, '')}/j/${eventId}`
}

/**
 * A dev/local origin: a QR printed from here would send guests nowhere. Covers
 * localhost names, loopback, 0.0.0.0, private LAN ranges (`vite --host` from
 * a laptop), link-local, and mDNS `.local` names.
 */
export function isLocalOrigin(origin: string): boolean {
  let host: string
  try {
    host = new URL(origin).hostname.toLowerCase()
  } catch {
    return true
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.test') || host.endsWith('.local')) return true
  if (host === '[::1]' || host === '::1' || host === '0.0.0.0') return true
  const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])]
    return (
      a === 127 || // loopback
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) // link-local
    )
  }
  return false
}

/** "Ana & Ben" → "qr-ana-ben.png"; falls back to the event id. */
export function qrFilename(coupleNames: string | null, eventId: string): string {
  const slug = (coupleNames ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents left by NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') // a cut can land right after a separator
  return `qr-${slug || eventId.slice(0, 8)}.png`
}

/** QR options shared by the SVG (print) and the PNG (download). */
export const QR_OPTIONS = { errorCorrectionLevel: 'M', margin: 3 } as const
