/**
 * PATCH  /api/unofficial/instances/[id]  — rename label
 * DELETE /api/unofficial/instances/[id]  — disconnect and remove
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { logoutInstance, deleteInstance } from '@/lib/whatsapp/unofficial/evolution-api'

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

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params
    const { accountId } = await requireRole('agent')

    const body = await request.json()
    const label: string = (body.label ?? '').trim()
    if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 })

    const { error } = await supabaseAdmin()
      .from('unofficial_wa_instances')
      .update({ label, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', accountId)

    if (error) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params
    const { accountId } = await requireRole('agent')

    const { data: row, error: fetchErr } = await supabaseAdmin()
      .from('unofficial_wa_instances')
      .select('instance_name')
      .eq('id', id)
      .eq('account_id', accountId)
      .single()

    if (fetchErr || !row) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
    }

    try { await logoutInstance(row.instance_name) } catch { /* already disconnected */ }
    try { await deleteInstance(row.instance_name) } catch { /* already deleted */ }

    await supabaseAdmin()
      .from('unofficial_wa_instances')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
