/**
 * PATCH  /api/unofficial/instances/[id]  — rename, set responsible consultant, set funnel stage
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
    const body = await request.json()
    const touchesRouting =
      'owner_user_id' in body || 'pipeline_id' in body || 'pipeline_stage_id' in body
    const { accountId } = await requireRole(touchesRouting ? 'admin' : 'agent')
    const db = supabaseAdmin()

    const { data: current } = await db
      .from('unofficial_wa_instances')
      .select('id, owner_user_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if ('label' in body) {
      const label: string = (body.label ?? '').trim()
      if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 })
      patch.label = label
    }

    if ('owner_user_id' in body) {
      const owner: string | null = body.owner_user_id || null
      if (owner) {
        const { data: member } = await db
          .from('profiles')
          .select('user_id')
          .eq('user_id', owner)
          .eq('account_id', accountId)
          .maybeSingle()
        if (!member) return NextResponse.json({ error: 'User is not in this account' }, { status: 400 })
      }
      patch.owner_user_id = owner
    }

    if ('pipeline_stage_id' in body) {
      const stageId: string | null = body.pipeline_stage_id || null
      if (stageId) {
        const { data: stage } = await db
          .from('pipeline_stages')
          .select('id, pipeline_id, pipelines!inner(account_id)')
          .eq('id', stageId)
          .maybeSingle()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stageAccount = (stage as any)?.pipelines?.account_id
        if (!stage || stageAccount !== accountId) {
          return NextResponse.json({ error: 'Invalid pipeline stage' }, { status: 400 })
        }
        patch.pipeline_stage_id = stageId
        patch.pipeline_id = stage.pipeline_id
      } else {
        patch.pipeline_stage_id = null
        patch.pipeline_id = null
      }
    }

    const { error } = await db
      .from('unofficial_wa_instances')
      .update(patch)
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })

    // New responsible consultant takes over this number's threads that were
    // unassigned or still assigned to the previous consultant.
    if ('owner_user_id' in patch && patch.owner_user_id) {
      const newOwner = patch.owner_user_id as string
      await db
        .from('conversations')
        .update({ assigned_agent_id: newOwner })
        .eq('unofficial_instance_id', id)
        .is('assigned_agent_id', null)
      if (current.owner_user_id && current.owner_user_id !== newOwner) {
        await db
          .from('conversations')
          .update({ assigned_agent_id: newOwner })
          .eq('unofficial_instance_id', id)
          .eq('assigned_agent_id', current.owner_user_id)
      }
    }

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
