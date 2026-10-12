/**
 * In-process scheduler: the Next server stays up under PM2, so a timer is
 * enough — no crontab to configure. Disable with ALERTS_SCHEDULER=off.
 * Interval: ALERTS_SCAN_INTERVAL_MIN (default 10).
 */

import { createClient } from '@supabase/supabase-js'
import { loadAlertSettings, runAlertScan } from './scan'
import { sendSummaryIfDue } from './summary'

declare global {
  // eslint-disable-next-line no-var
  var __bexAlertsScheduler: NodeJS.Timeout | undefined
  // eslint-disable-next-line no-var
  var __bexAlertsRunning: boolean | undefined
}

async function tick() {
  if (globalThis.__bexAlertsRunning) return
  globalThis.__bexAlertsRunning = true
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return
    const db = createClient(url, key)

    const { data: accounts } = await db.from('accounts').select('id')
    for (const account of accounts ?? []) {
      try {
        const stats = await runAlertScan(db, account.id)
        if (stats.unansweredCreated || stats.suspiciousCreated || stats.error) {
          console.log('[alerts] scan', account.id, JSON.stringify(stats))
        }
        const settings = await loadAlertSettings(db, account.id)
        const summary = await sendSummaryIfDue(db, account.id, settings)
        if (summary.sent) console.log('[alerts] summary sent', account.id)
      } catch (err) {
        console.error('[alerts] account run failed:', account.id, err instanceof Error ? err.message : err)
      }
    }
  } finally {
    globalThis.__bexAlertsRunning = false
  }
}

export function startAlertsScheduler() {
  if (globalThis.__bexAlertsScheduler) return
  const minutes = Number(process.env.ALERTS_SCAN_INTERVAL_MIN)
  const everyMs = (Number.isFinite(minutes) && minutes >= 1 ? minutes : 10) * 60_000

  globalThis.__bexAlertsScheduler = setInterval(() => void tick(), everyMs)
  globalThis.__bexAlertsScheduler.unref?.()
  setTimeout(() => void tick(), 90_000).unref?.()
  console.log(`[alerts] scheduler started (every ${everyMs / 60_000} min)`)
}
