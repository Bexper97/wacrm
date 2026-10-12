// Runs once when the Next.js server starts. Starts the alert scanner timer.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.ALERTS_SCHEDULER === 'off') return
  const { startAlertsScheduler } = await import('@/lib/alerts/scheduler')
  startAlertsScheduler()
}
