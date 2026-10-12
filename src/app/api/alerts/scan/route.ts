/**
 * POST /api/alerts/scan — admin: run the alert scan for this account right now.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { runAlertScan } from '@/lib/alerts/scan'

export const maxDuration = 300

export async function POST() {
  try {
    const { accountId } = await requireRole('admin')
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const stats = await runAlertScan(db, accountId)
    return NextResponse.json({ stats })
  } catch (err) {
    return toErrorResponse(err)
  }
}
