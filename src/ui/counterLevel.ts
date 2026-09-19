// Pure decision for the photo counter's visual level + label. Extracted so the
// accessibility rule (color AND label change — never color alone) is unit-tested.

export type CounterLevel = 'done' | 'last' | 'low' | 'ok'

export function photoLevel(photos: number): { level: CounterLevel; label: string } {
  if (photos <= 0) return { level: 'done', label: 'done' }
  if (photos <= 1) return { level: 'last', label: 'last!' }
  if (photos <= 3) return { level: 'low', label: 'photos' }
  return { level: 'ok', label: 'photos' }
}
