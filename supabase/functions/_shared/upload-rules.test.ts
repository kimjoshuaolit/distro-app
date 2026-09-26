import { describe, it, expect } from 'vitest'
import { validateUploadRequest, extForContentType, MAX_BYTES, reserveRefusal } from './upload-rules.ts'

const uuid = '11111111-1111-4111-8111-111111111111'
const base = {
  deviceToken: 'dev-abc',
  clientShotId: uuid,
  type: 'photo' as const,
  contentType: 'image/jpeg',
  size: 62_482,
  capturedAt: '2026-09-19T12:00:00.000Z',
}

describe('extForContentType', () => {
  it('maps supported media types', () => {
    expect(extForContentType('image/jpeg')).toBe('jpg')
    expect(extForContentType('video/mp4')).toBe('mp4')
    expect(extForContentType('video/webm')).toBe('webm')
  })

  it('strips codec parameters', () => {
    expect(extForContentType('video/webm;codecs=vp9,opus')).toBe('webm')
    expect(extForContentType('video/mp4; codecs="avc1.4d002a"')).toBe('mp4')
  })

  it('returns null for unsupported or non-string input', () => {
    expect(extForContentType('image/png')).toBeNull()
    expect(extForContentType('application/json')).toBeNull()
    expect(extForContentType(undefined)).toBeNull()
    expect(extForContentType(42)).toBeNull()
  })
})

describe('validateUploadRequest', () => {
  it('accepts a valid photo request and derives the extension', () => {
    const res = validateUploadRequest(base)
    expect(res).toEqual({ ok: true, value: { ...base, ext: 'jpg' } })
  })

  it('accepts a clip with a codec-tagged webm content type', () => {
    const res = validateUploadRequest({
      ...base,
      type: 'clip',
      contentType: 'video/webm;codecs=vp9,opus',
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.ext).toBe('webm')
  })

  it('rejects a missing or empty device token', () => {
    expect(validateUploadRequest({ ...base, deviceToken: '' }).ok).toBe(false)
    const { deviceToken: _omit, ...noToken } = base
    expect(validateUploadRequest(noToken).ok).toBe(false)
  })

  it('rejects a non-uuid client shot id', () => {
    expect(validateUploadRequest({ ...base, clientShotId: 'nope' }).ok).toBe(false)
  })

  it('rejects an unknown type', () => {
    expect(validateUploadRequest({ ...base, type: 'gif' }).ok).toBe(false)
  })

  it('rejects an unsupported content type', () => {
    expect(validateUploadRequest({ ...base, contentType: 'image/png' }).ok).toBe(false)
  })

  it('rejects a bad capturedAt timestamp', () => {
    expect(validateUploadRequest({ ...base, capturedAt: 'not-a-date' }).ok).toBe(false)
  })

  it('rejects a type/content-type mismatch', () => {
    expect(validateUploadRequest({ ...base, type: 'clip', contentType: 'image/jpeg' }).ok).toBe(
      false,
    )
    expect(validateUploadRequest({ ...base, type: 'photo', contentType: 'video/mp4' }).ok).toBe(
      false,
    )
  })

  it('rejects a missing, zero, fractional or negative size', () => {
    const { size: _omit, ...noSize } = base
    expect(validateUploadRequest(noSize).ok).toBe(false)
    expect(validateUploadRequest({ ...base, size: 0 }).ok).toBe(false)
    expect(validateUploadRequest({ ...base, size: 10.5 }).ok).toBe(false)
    expect(validateUploadRequest({ ...base, size: -1 }).ok).toBe(false)
    expect(validateUploadRequest({ ...base, size: '100' }).ok).toBe(false)
  })

  it('enforces the per-type size cap at the boundary', () => {
    expect(validateUploadRequest({ ...base, size: MAX_BYTES.photo }).ok).toBe(true)
    expect(validateUploadRequest({ ...base, size: MAX_BYTES.photo + 1 }).ok).toBe(false)
    const clip = { ...base, type: 'clip', contentType: 'video/mp4' }
    expect(validateUploadRequest({ ...clip, size: MAX_BYTES.clip }).ok).toBe(true)
    expect(validateUploadRequest({ ...clip, size: MAX_BYTES.clip + 1 }).ok).toBe(false)
    // A clip-sized body is still too big for a photo.
    expect(validateUploadRequest({ ...base, size: MAX_BYTES.photo * 2 }).ok).toBe(false)
  })

  it('rejects non-object input', () => {
    expect(validateUploadRequest(null).ok).toBe(false)
    expect(validateUploadRequest('x').ok).toBe(false)
  })
})

describe('reserveRefusal', () => {
  it('reserved / exists carry on to signing', () => {
    expect(reserveRefusal('reserved')).toBeNull()
    expect(reserveRefusal('exists')).toBeNull()
  })

  it('the terminal refusals keep the exact codes the upload queue relies on', () => {
    expect(reserveRefusal('cap_reached')).toMatchObject({ status: 409, code: 'cap_reached' })
    expect(reserveRefusal('upload_closed')).toMatchObject({ status: 409, code: 'upload_closed' })
  })

  it('other refusals', () => {
    expect(reserveRefusal('guest_not_found')).toMatchObject({ status: 404, code: 'guest_not_found' })
    expect(reserveRefusal('bad_type')).toMatchObject({ status: 400, code: 'bad_request' })
    for (const s of ['uploads_closed', '', undefined, null, 42]) {
      expect(reserveRefusal(s)).toMatchObject({ status: 500, code: 'server_error' })
    }
  })
})
