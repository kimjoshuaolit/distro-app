import { describe, it, expect } from 'vitest'
import { buildCollection, chunk, countLabel, idsToSign } from './buildCollection.ts'
import type { CollectionGuest, CollectionShot } from '../lib/api.ts'

const guest = (id: string, firstName: string, createdAt: string | null = '2026-09-19T10:00:00Z'): CollectionGuest => ({
  id,
  firstName,
  createdAt,
})
const shot = (
  id: string,
  guestId: string,
  type: 'photo' | 'clip' = 'photo',
  capturedAt: string | null = '2026-09-19T12:00:00Z',
): CollectionShot => ({ id, guestId, type, capturedAt })

describe('buildCollection — the shelf', () => {
  it('makes one roll per guest, A–Z, labeled by first name with counts', () => {
    const shots = [
      ...Array.from({ length: 12 }, (_, i) => shot(`r-p${String(i).padStart(2, '0')}`, 'rosa')),
      shot('r-c1', 'rosa', 'clip'),
      shot('r-c2', 'rosa', 'clip'),
      shot('b-1', 'ben'),
    ]
    const rolls = buildCollection({ guests: [guest('rosa', 'Rosa'), guest('ben', 'ben')], shots })

    expect(rolls.map((r) => r.label)).toEqual(['ben’s roll', 'Rosa’s roll'])
    const rosa = rolls[1]
    expect([rosa.photos, rosa.clips]).toEqual([12, 2])
    expect(countLabel(rosa.photos, rosa.clips)).toBe('12 photos · 2 clips')
    expect(rosa.frames).toHaveLength(14)
  })

  it('covers a roll with its first photo, or its first clip when it has no photos', () => {
    const rolls = buildCollection({
      guests: [guest('a', 'Ana'), guest('b', 'Ben')],
      shots: [
        shot('a-clip', 'a', 'clip', '2026-09-19T11:00:00Z'),
        shot('a-late', 'a', 'photo', '2026-09-19T13:00:00Z'),
        shot('a-early', 'a', 'photo', '2026-09-19T12:00:00Z'),
        shot('b-clip2', 'b', 'clip', '2026-09-19T12:00:00Z'),
        shot('b-clip1', 'b', 'clip', '2026-09-19T11:00:00Z'),
      ],
    })
    expect(rolls[0].cover.id).toBe('a-early')
    expect(rolls[1].cover.id).toBe('b-clip1')
  })

  it('numbers frames in capture order (time, not string order), unknown or garbled times last', () => {
    const [roll] = buildCollection({
      guests: [guest('a', 'Ana')],
      shots: [
        shot('z-garbled', 'a', 'photo', 'not a date'),
        shot('y-null', 'a', 'photo', null),
        shot('late', 'a', 'photo', '2026-09-19T12:00:00+00:00'),
        shot('early', 'a', 'photo', '2026-09-19T11:30:00Z'),
        shot('tie-b', 'a', 'clip', '2026-09-19T11:00:00Z'),
        shot('tie-a', 'a', 'photo', '2026-09-19T11:00:00Z'),
      ],
    })
    expect(roll.frames.map((f) => [f.frame, f.id])).toEqual([
      [1, 'tie-a'],
      [2, 'tie-b'],
      [3, 'early'],
      [4, 'late'],
      [5, 'y-null'],
      [6, 'z-garbled'],
    ])
  })

  it('ignores shots whose guest is not in this event', () => {
    const rolls = buildCollection({ guests: [guest('a', 'Ana')], shots: [shot('x', 'stranger'), shot('a1', 'a')] })
    expect(rolls).toHaveLength(1)
    expect(rolls[0].frames.map((f) => f.id)).toEqual(['a1'])
  })
})

describe('buildCollection — not yet shot or uploaded', () => {
  it('leaves guests with no uploaded shots off the shelf', () => {
    const rolls = buildCollection({
      guests: [guest('a', 'Ana'), guest('b', 'Ben'), guest('c', 'Cy')],
      shots: [shot('b1', 'b')],
    })
    expect(rolls.map((r) => r.firstName)).toEqual(['Ben'])
  })
})

describe('buildCollection — same first name', () => {
  it('suffixes the later joiner: "Ana’s roll" and "Ana’s roll · 2", case-insensitively', () => {
    const rolls = buildCollection({
      guests: [
        guest('z-second', 'ana', '2026-09-19T11:00:00Z'),
        guest('b', 'Ben', '2026-09-19T09:00:00Z'),
        guest('a-first', 'Ana', '2026-09-19T10:00:00Z'),
        guest('third', ' Ana ', '2026-09-19T12:00:00+00:00'),
      ],
      shots: [shot('1', 'z-second'), shot('2', 'b'), shot('3', 'a-first'), shot('4', 'third')],
    })
    expect(rolls.map((r) => [r.guestId, r.label])).toEqual([
      ['a-first', 'Ana’s roll'],
      ['z-second', 'ana’s roll · 2'],
      ['third', 'Ana’s roll · 3'],
      ['b', 'Ben’s roll'],
    ])
  })

  it('keeps accented names apart, and a missing join time sorts last among namesakes', () => {
    const rolls = buildCollection({
      guests: [guest('x', 'Ana', null), guest('y', 'Ána'), guest('z', 'Ana')],
      shots: [shot('1', 'x'), shot('2', 'y'), shot('3', 'z')],
    })
    expect(rolls.map((r) => [r.guestId, r.label])).toEqual([
      ['z', 'Ana’s roll'],
      ['x', 'Ana’s roll · 2'],
      ['y', 'Ána’s roll'],
    ])
  })

  it('numbers namesakes by join order among all guests, so a hidden earlier Ana keeps her number', () => {
    const guests = [guest('early', 'Ana', '2026-09-19T09:00:00Z'), guest('late', 'Ana', '2026-09-19T10:00:00Z')]
    // Only the later Ana has uploaded: she is still "· 2", and the bare name waits for the first.
    expect(buildCollection({ guests, shots: [shot('1', 'late')] }).map((r) => r.label)).toEqual(['Ana’s roll · 2'])
    // When the first Ana's shots arrive later, nobody's label changes.
    expect(
      buildCollection({ guests, shots: [shot('1', 'late'), shot('2', 'early')] }).map((r) => [r.guestId, r.label]),
    ).toEqual([
      ['early', 'Ana’s roll'],
      ['late', 'Ana’s roll · 2'],
    ])
  })
})

describe('buildCollection — nothing uploaded', () => {
  it('is an empty shelf (the screen shows "still developing")', () => {
    expect(buildCollection({ guests: [guest('a', 'Ana')], shots: [] })).toEqual([])
    expect(buildCollection({ guests: [], shots: [] })).toEqual([])
  })
})

describe('idsToSign / chunk', () => {
  const rolls = buildCollection({
    guests: [guest('a', 'Ana'), guest('b', 'Ben')],
    shots: [shot('a-clip', 'a', 'clip', '2026-09-19T11:00:00Z'), shot('a-photo', 'a'), shot('b-1', 'b')],
  })

  it('signs only covers on the shelf, and only the open roll inside it', () => {
    expect(idsToSign(rolls, null)).toEqual(['a-photo', 'b-1'])
    expect(idsToSign(rolls, 'a')).toEqual(['a-clip', 'a-photo'])
    expect(idsToSign(rolls, 'someone-else')).toEqual([])
  })

  it('batches ids at the function limit', () => {
    const ids = Array.from({ length: 61 }, (_, i) => `id${i}`)
    expect(chunk(ids, 30).map((c) => c.length)).toEqual([30, 30, 1])
    expect(chunk([], 30)).toEqual([])
  })
})

describe('countLabel', () => {
  it('pluralizes and leaves out empty kinds', () => {
    expect(countLabel(1, 0)).toBe('1 photo')
    expect(countLabel(0, 1)).toBe('1 clip')
    expect(countLabel(2, 3)).toBe('2 photos · 3 clips')
  })
})
