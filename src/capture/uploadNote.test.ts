import { describe, expect, it } from 'vitest'
import { uploadNote } from './uploadNote.ts'

describe('uploadNote', () => {
  it('says nothing before the queue has been checked', () => {
    expect(uploadNote('checking', 3)).toBeNull()
  })

  it('tells the guest to keep the page open while shots are still on the phone', () => {
    const note = uploadNote('uploading', 3)
    expect(note?.waiting).toBe(true)
    expect(note?.text).toMatch(/^3 shots still uploading\. Keep this page open/)
    expect(uploadNote('idle', 1)?.text).toMatch(/^1 shot still uploading/)
    expect(uploadNote('error', 2)?.waiting).toBe(true) // retrying is still waiting
  })

  it('tells an offline guest to come back once they have signal', () => {
    const note = uploadNote('offline', 2)
    expect(note?.waiting).toBe(true)
    expect(note?.text).toMatch(/offline: 2 shots waiting on your phone/)
  })

  it('lets the guest go once everything is saved', () => {
    expect(uploadNote('idle', 0)).toEqual({ text: 'Everything’s saved. You can close this page.', waiting: false })
  })
})
