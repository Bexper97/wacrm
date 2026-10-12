/**
 * POST /api/alerts/summary — admin: send the WhatsApp summary now (test / on demand).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAlertSettings } from '@/lib/alerts/scan'
import { sendSummaryIfDue } from '@/lib/alerts/summary'

export async function POST() {
  try {
    const { accountId } = await requireRole('admin')
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const settings = await loadAlertSettings(db, accountId)
    const result = await sendSummaryIfDue(db, accountId, settings, { force: true })
    return NextResponse.json(result, { status: result.sent ? 200 : 400 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
