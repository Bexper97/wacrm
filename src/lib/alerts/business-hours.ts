/**
 * Business-hours maths for "unanswered" alerts: only Monday–Friday, 08:00–18:00
 * (account local time) counts. Pure functions, no I/O.
 */

export const ALERTS_TIMEZONE = process.env.ALERTS_TZ || 'America/Sao_Paulo'
export const BUSINESS_START_HOUR = 8
export const BUSINESS_END_HOUR = 18

const MS_MIN = 60_000

/** Offset (minutes, local − UTC) of `tz` at the instant `at`. */
function offsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - at.getTime()) / MS_MIN)
}

/** Local calendar parts of `at` in `tz`. weekday: 0 = Sunday … 6 = Saturday. */
export function localParts(at: Date, tz: string = ALERTS_TIMEZONE) {
  const off = offsetMinutes(at, tz)
  const local = new Date(at.getTime() + off * MS_MIN)
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
    weekday: local.getUTCDay(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    /** YYYY-MM-DD in local time. */
    dateKey: local.toISOString().slice(0, 10),
  }
}

/** UTC instant of local `hour:00` on the local calendar day `y-m-d`. */
function localInstant(y: number, m: number, d: number, hour: number, tz: string): Date {
  // First guess assuming offset at noon UTC of that day, then refine once (handles odd offsets / DST).
  const guess = new Date(Date.UTC(y, m, d, hour, 0, 0))
  const off1 = offsetMinutes(guess, tz)
  const first = new Date(guess.getTime() - off1 * MS_MIN)
  const off2 = offsetMinutes(first, tz)
  return new Date(guess.getTime() - off2 * MS_MIN)
}

export function isBusinessTime(at: Date, tz: string = ALERTS_TIMEZONE): boolean {
  const p = localParts(at, tz)
  return p.weekday >= 1 && p.weekday <= 5 && p.hour >= BUSINESS_START_HOUR && p.hour < BUSINESS_END_HOUR
}

/**
 * Minutes between `from` and `to` that fall inside Mon–Fri business hours.
 * Weekends, nights and the lunch of nobody (the whole 08–18 window counts) are handled.
 */
export function businessMinutesBetween(from: Date, to: Date, tz: string = ALERTS_TIMEZONE): number {
  if (to <= from) return 0

  const start = localParts(from, tz)
  // Walk local calendar days from the day of `from` to the day of `to`.
  let cursor = Date.UTC(start.year, start.month, start.day)
  const endDay = (() => {
    const e = localParts(to, tz)
    return Date.UTC(e.year, e.month, e.day)
  })()

  let total = 0
  const DAY = 24 * 60 * MS_MIN
  for (; cursor <= endDay; cursor += DAY) {
    const d = new Date(cursor)
    const weekday = d.getUTCDay()
    if (weekday === 0 || weekday === 6) continue

    const windowStart = localInstant(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), BUSINESS_START_HOUR, tz)
    const windowEnd = localInstant(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), BUSINESS_END_HOUR, tz)
    const lo = Math.max(windowStart.getTime(), from.getTime())
    const hi = Math.min(windowEnd.getTime(), to.getTime())
    if (hi > lo) total += (hi - lo) / MS_MIN
  }
  return Math.floor(total)
}
