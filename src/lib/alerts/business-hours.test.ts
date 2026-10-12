import { describe, expect, it } from 'vitest'
import { businessMinutesBetween, isBusinessTime } from './business-hours'

const TZ = 'America/Sao_Paulo' // UTC-3, no DST
// helper: local São Paulo time -> UTC Date. 2026-10-12 is a Monday.
const sp = (day: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 9, day, hh + 3, mm))

describe('business hours', () => {
  it('counts plain minutes inside the window', () => {
    expect(businessMinutesBetween(sp(12, 9, 0), sp(12, 10, 30), TZ)).toBe(90)
  })

  it('ignores the evening and resumes next morning', () => {
    // Mon 17:30 -> Tue 08:30 = 30 min + 30 min
    expect(businessMinutesBetween(sp(12, 17, 30), sp(13, 8, 30), TZ)).toBe(60)
  })

  it('ignores weekends', () => {
    // Fri 17:00 -> Mon 09:00 = 60 + 60
    expect(businessMinutesBetween(sp(16, 17, 0), sp(19, 9, 0), TZ)).toBe(120)
  })

  it('is zero entirely outside business hours', () => {
    expect(businessMinutesBetween(sp(12, 19, 0), sp(12, 23, 0), TZ)).toBe(0)
    expect(businessMinutesBetween(sp(17, 9, 0), sp(17, 15, 0), TZ)).toBe(0) // Saturday
  })

  it('classifies instants', () => {
    expect(isBusinessTime(sp(12, 8, 0), TZ)).toBe(true)
    expect(isBusinessTime(sp(12, 18, 0), TZ)).toBe(false)
    expect(isBusinessTime(sp(18, 10, 0), TZ)).toBe(false) // Sunday
  })
})
