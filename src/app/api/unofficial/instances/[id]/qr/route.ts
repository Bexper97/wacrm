/**
 * GET /api/unofficial/instances/[id]/qr
 * Returns the QR code (base64 PNG) or connected status for this instance.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  getQrCode,
  getConnectionState,
  createInstance,
  setWebhook,
} from '@/lib/whatsapp/unofficial/evolution-api'

function webhookUrl(): string {
  if (process.env.UNOFFICIAL_WA_WEBHOOK_URL) return process.env.UNOFFICIAL_WA_WEBHOOK_URL
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  return `${base}/api/unofficial/webhook`
}

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

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params
    const { accountId } = await requireRole('agent')

    const { data: row } = await supabaseAdmin()
      .from('unofficial_wa_instances')
      .select('instance_name, status')
      .eq('id', id)
      .eq('account_id', accountId)
      .single()

    if (!row) return NextResponse.json({ error: 'Instance not found' }, { status: 404 })

    const hookUrl = webhookUrl()

    // Check live connection state; recreate the instance if Evolution lost it
    let state: string
    try {
      const cs = await getConnectionState(row.instance_name)
      state = cs.instance?.state ?? 'close'
    } catch (err) {
      state = 'close'
      const msg = err instanceof Error ? err.message : ''
      if (/does not exist|404/i.test(msg)) {
        try {
          await createInstance({ instanceName: row.instance_name, webhookUrl: hookUrl })
        } catch (createErr) {
          console.error('[unofficial/qr] recreate failed:', createErr)
        }
      }
    }

    // Self-heal: always keep the webhook pointed at this CRM
    try {
      await setWebhook(row.instance_name, hookUrl)
    } catch (err) {
      console.error('[unofficial/qr] setWebhook failed:', err)
    }

    if (state === 'open') {
      await supabaseAdmin()
        .from('unofficial_wa_instances')
        .update({ status: 'connected', updated_at: new Date().toISOString() })
        .eq('id', id)
      return NextResponse.json({ connected: true })
    }

    // Fetch QR code
    let qr: { base64?: string; code?: string } | null = null
    try {
      qr = await getQrCode(row.instance_name)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'QR fetch failed'
      return NextResponse.json({ connected: false, error: message })
    }

    await supabaseAdmin()
      .from('unofficial_wa_instances')
      .update({ status: 'connecting', updated_at: new Date().toISOString() })
      .eq('id', id)

    return NextResponse.json({ connected: false, qr })
  } catch (err) {
    return toErrorResponse(err)
  }
}
