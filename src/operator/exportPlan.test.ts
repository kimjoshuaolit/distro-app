import { describe, it, expect } from 'vitest'
import { buildPlan, guestFolders, localStamp, manifestCsv, safeName, type ExportGuest, type ExportShot } from './exportPlan'

const g = (n: number, firstName: string, joinedAt = `2026-11-14T20:${String(n).padStart(2, '0')}:00Z`): ExportGuest => ({
  guestId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  firstName,
  joinedAt,
})
const stamp = (iso: string) => iso.slice(0, 19).replace('T', ' ').replace(/:/g, '.')

describe('safeName', () => {
  it('makes names safe on Windows and macOS', () => {
    expect(safeName('Rosa')).toBe('Rosa')
    expect(safeName('a/b?')).toBe('a_b_')
    expect(safeName('x<y>:"z"|*\\')).toBe('x_y___z____')
    expect(safeName('  Zoë   Ann  ')).toBe('Zoë Ann')
    expect(safeName('tab\there\u0000')).toBe('tab_here_') // control characters (tab too) become _
    expect(safeName('dots...')).toBe('dots')
    expect(safeName('CON')).toBe('CON_')
    expect(safeName('com1.txt')).toBe('com1.txt_')
    expect(safeName('lpt9')).toBe('lpt9_')
    expect(safeName('   ')).toBe('Guest')
    expect(safeName('...')).toBe('Guest')
    expect(safeName('x'.repeat(100))).toHaveLength(60)
    expect(safeName('Zoë')).toBe('Zoë') // NFD → NFC: one folder on macOS
  })

  it('never takes a name the root already uses', () => {
    expect(safeName('manifest.csv')).toBe('manifest.csv_')
    expect(safeName('Montage')).toBe('Montage_')
    expect(safeName('montage.mp4')).toBe('montage.mp4_')
  })
})

describe('guestFolders', () => {
  it('numbers repeats in join order, case-insensitively', () => {
    const guests = [g(3, 'sam'), g(1, 'Sam'), g(2, 'Rosa'), g(4, 'SAM')]
    const folders = guestFolders(guests)
    expect(folders.get(guests[1].guestId)).toBe('Sam')
    expect(folders.get(guests[2].guestId)).toBe('Rosa')
    expect(folders.get(guests[0].guestId)).toBe('sam (2)')
    expect(folders.get(guests[3].guestId)).toBe('SAM (3)')
  })

  it('is stable when a later guest joins (earlier folders never shift)', () => {
    const first = guestFolders([g(1, 'Sam'), g(2, 'Sam')])
    const later = guestFolders([g(1, 'Sam'), g(2, 'Sam'), g(3, 'Sam')])
    expect([...first]).toEqual([...later].slice(0, 2))
  })

  it('a guest literally called "Sam (2)" never collides with a numbered Sam', () => {
    const folders = guestFolders([g(1, 'Sam (2)'), g(2, 'Sam'), g(3, 'Sam')])
    expect([...folders.values()]).toEqual(['Sam (2)', 'Sam', 'Sam (3)'])
  })
})

describe('localStamp', () => {
  it('formats local time with dots (no ":" in Windows names)', () => {
    expect(localStamp(new Date(2026, 10, 14, 21, 40, 5).toISOString())).toBe('2026-11-14 21.40.05')
    expect(localStamp('nonsense')).toBe('0000-00-00 00.00.00')
  })
})

describe('buildPlan', () => {
  const rosa = g(1, 'Rosa')
  const sam = g(2, 'Sam')
  const shot = (n: number, guest: ExportGuest, type: 'photo' | 'clip', takenAt: string, ext = type === 'photo' ? 'jpg' : 'mp4'): ExportShot => ({
    shotId: `${n.toString(16).padStart(4, '0')}aaaa-0000-4000-8000-000000000000`, // tag = first 4 hex
    guestId: guest.guestId,
    type,
    takenAt,
    ext,
  })

  it('files each shot under its guest, in join order then by time taken', () => {
    const plan = buildPlan(
      [sam, rosa],
      [
        shot(1, sam, 'photo', '2026-11-14T21:00:00Z'),
        shot(2, rosa, 'clip', '2026-11-14T21:30:00Z'),
        shot(3, rosa, 'photo', '2026-11-14T21:10:00Z'),
      ],
      stamp,
    )
    expect(plan.map((e) => `${e.dir}/${e.name}`)).toEqual([
      'Rosa/2026-11-14 21.10.00 photo 0003.jpg',
      'Rosa/2026-11-14 21.30.00 clip 0002.mp4',
      'Sam/2026-11-14 21.00.00 photo 0001.jpg',
    ])
    expect(plan[0]).toMatchObject({ guestName: 'Rosa', type: 'photo', takenAt: '2026-11-14T21:10:00Z' })
  })

  it('a shot’s name never depends on other shots — a late upload can’t take a saved name', () => {
    const saved = shot(0xb0, rosa, 'photo', '2026-11-14T21:10:00Z')
    const late = shot(0xa0, rosa, 'photo', '2026-11-14T21:10:00Z') // same second, lower id
    const before = buildPlan([rosa], [saved], stamp)
    const after = buildPlan([rosa], [late, saved], stamp)
    expect(after.find((e) => e.shotId === saved.shotId)!.name).toBe(before[0].name)
    expect(after.map((e) => e.name)).toEqual(['2026-11-14 21.10.00 photo 00a0.jpg', '2026-11-14 21.10.00 photo 00b0.jpg'])
  })

  it('only a fully identical name (same second, same tag) gets " (2)"', () => {
    const a = { ...shot(1, rosa, 'photo', '2026-11-14T21:10:00Z'), shotId: 'abcd0000-0000-4000-8000-000000000002' }
    const b = { ...shot(1, rosa, 'photo', '2026-11-14T21:10:00Z'), shotId: 'abcd0000-0000-4000-8000-000000000001' }
    expect(buildPlan([rosa], [a, b], stamp).map((e) => [e.shotId, e.name])).toEqual([
      [b.shotId, '2026-11-14 21.10.00 photo abcd.jpg'],
      [a.shotId, '2026-11-14 21.10.00 photo abcd (2).jpg'],
    ])
  })

  it('an odd extension is saved as .bin; an unknown guest gets their own folder', () => {
    const stranger = g(9, 'X')
    const plan = buildPlan([rosa], [shot(1, rosa, 'photo', '2026-11-14T21:00:00Z', '../x'), shot(2, stranger, 'clip', '2026-11-14T21:00:00Z')], stamp)
    expect(plan[0].name).toBe('2026-11-14 21.00.00 photo 0001.bin')
    expect(plan[1]).toMatchObject({ dir: `Guest ${stranger.guestId.slice(0, 8)}`, guestName: 'Guest' })
  })
})

describe('manifestCsv', () => {
  it('lists every file plus the montage, Excel-friendly', () => {
    const plan = buildPlan([g(1, 'Rosa')], [{ shotId: '3f2a0000-0000-4000-8000-000000000001', guestId: g(1, 'Rosa').guestId, type: 'photo', takenAt: '2026-11-14T21:10:00Z', ext: 'jpg' }], stamp)
    const csv = manifestCsv(plan, 'montage.mp4')
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual([
      'guest,file,type,taken_at',
      'Rosa,Rosa/2026-11-14 21.10.00 photo 3f2a.jpg,photo,2026-11-14T21:10:00Z',
      ',montage.mp4,montage,',
      '',
    ])
  })

  it('quotes commas and quotes, and never lets a name run as a formula', () => {
    const entry = { shotId: 's', dir: 'd', name: 'n.jpg', type: 'photo' as const, takenAt: 't' }
    const csv = manifestCsv(
      [
        { ...entry, guestName: '=HYPERLINK("x")' },
        { ...entry, guestName: 'Ann, "Jr"' },
        { ...entry, guestName: '+1' },
        { ...entry, guestName: '@me' },
        { ...entry, guestName: '-5' },
      ],
      null,
    )
    const lines = csv.slice(1).split('\r\n')
    expect(lines[1]).toBe(`"'=HYPERLINK(""x"")",d/n.jpg,photo,t`)
    expect(lines[2]).toBe(`"Ann, ""Jr""",d/n.jpg,photo,t`)
    expect(lines[3]).toBe(`'+1,d/n.jpg,photo,t`)
    expect(lines[4]).toBe(`'@me,d/n.jpg,photo,t`)
    expect(lines[5]).toBe(`'-5,d/n.jpg,photo,t`)
  })

  it('a folder that starts like a formula stays a real path (./), never a formula', () => {
    const csv = manifestCsv([{ shotId: 's', guestName: 'x', dir: '=Bob', name: 'n.jpg', type: 'photo', takenAt: 't' }], null)
    expect(csv.slice(1).split('\r\n')[1]).toBe('x,./=Bob/n.jpg,photo,t')
  })
})
