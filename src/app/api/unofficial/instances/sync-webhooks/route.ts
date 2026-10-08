/**
 * POST /api/unofficial/instances/sync-webhooks
 *
 * Updates the webhook URL on Evolution API for all instances belonging
 * to this account. Call this once after setting NEXT_PUBLIC_APP_URL.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { setWebhook } from '@/lib/whatsapp/unofficial/evolution-api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function supabaseAdmin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _admin
}

function webhookUrl(): string {
  if (process.env.UNOFFICIAL_WA_WEBHOOK_URL) return process.env.UNOFFICIAL_WA_WEBHOOK_URL
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  return `${base}/api/unofficial/webhook`
}

export async function POST() {
  try {
    const { accountId } = await requireRole('admin')

    const { data: instances, error } = await supabaseAdmin()
      .from('unofficial_wa_instances')
      .select('id, instance_name, label')
      .eq('account_id', accountId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!instances || instances.length === 0) {
      return NextResponse.json({ updated: 0, url: webhookUrl() })
    }

    const url = webhookUrl()
    const results = await Promise.allSettled(
      instances.map((inst: { instance_name: string }) => setWebhook(inst.instance_name, url))
    )

    const failed = results
      .map((r, i) => ({ ...r, name: instances[i].label }))
      .filter(r => r.status === 'rejected')
      .map(r => (r as PromiseRejectedResult & { name: string }).name)

    return NextResponse.json({
      updated: results.length - failed.length,
      failed,
      url,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
