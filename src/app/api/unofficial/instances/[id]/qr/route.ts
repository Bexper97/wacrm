/**
 * GET /api/unofficial/instances/[id]/qr
 * Returns the QR code (base64 PNG) or connected status for this instance.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getQrCode, getConnectionState } from '@/lib/whatsapp/unofficial/evolution-api'

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

    // Check live connection state
    let state: string
    try {
      const cs = await getConnectionState(row.instance_name)
      state = cs.instance?.state ?? 'close'
    } catch {
      state = 'close'
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
