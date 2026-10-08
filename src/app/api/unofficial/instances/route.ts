/**
 * GET  /api/unofficial/instances  — list all instances for the account
 * POST /api/unofficial/instances  — create a new instance
 *
 * DB writes use the service-role client to bypass RLS (auth + role are
 * already enforced at the application layer via requireRole).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createInstance } from '@/lib/whatsapp/unofficial/evolution-api'

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
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  return `${base}/api/unofficial/webhook`
}

function toInstanceName(accountId: string, label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20)
  const rand = Math.random().toString(36).slice(2, 7)
  const acct = accountId.replace(/-/g, '').slice(0, 6)
  return `wa-${acct}-${slug}-${rand}`
}

export async function GET() {
  try {
    const { accountId } = await requireRole('agent')

    const { data, error } = await supabaseAdmin()
      .from('unofficial_wa_instances')
      .select('id, instance_name, label, phone, status, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[unofficial/instances GET]', error)
      return NextResponse.json({ error: 'Failed to fetch instances' }, { status: 500 })
    }

    return NextResponse.json({ instances: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('agent')

    const body = await request.json()
    const label: string = (body.label ?? '').trim()

    if (!label) {
      return NextResponse.json({ error: 'label is required' }, { status: 400 })
    }

    const instanceName = toInstanceName(accountId, label)

    // Create the instance on Evolution API
    try {
      await createInstance({ instanceName, webhookUrl: webhookUrl() })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Evolution API error'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    // Persist in DB (service role bypasses RLS — auth already verified above)
    const { data, error } = await supabaseAdmin()
      .from('unofficial_wa_instances')
      .insert({
        account_id: accountId,
        instance_name: instanceName,
        label,
        status: 'disconnected',
      })
      .select('id, instance_name, label, phone, status')
      .single()

    if (error || !data) {
      console.error('[unofficial/instances POST] db insert error:', JSON.stringify(error))
      return NextResponse.json(
        { error: `Failed to save instance: ${error?.message ?? 'unknown'}` },
        { status: 500 }
      )
    }

    return NextResponse.json({ instance: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
