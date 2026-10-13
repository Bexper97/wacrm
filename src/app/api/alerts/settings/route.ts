/**
 * PUT /api/alerts/settings — admin: save the alert settings.
 * Goes through the server so failures come back with a readable reason.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function PUT(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = (await request.json()) as Record<string, unknown>

    const minutes = Math.min(1440, Math.max(5, Number(body.unanswered_minutes) || 60))
    const hour = Math.min(23, Math.max(0, Number(body.summary_hour) || 0))
    const phone = String(body.summary_phone ?? '').replace(/[^\d]/g, '')
    const instanceId = body.summary_instance_id ? String(body.summary_instance_id) : null
    const summaryEnabled = body.summary_enabled === true
    const aiModel = String(body.ai_model ?? '').trim()
    if (aiModel && !/^[A-Za-z0-9._:\/-]{2,100}$/.test(aiModel)) {
      return NextResponse.json({ error: 'Nome de modelo inválido.', code: 'invalid' }, { status: 400 })
    }

    if (summaryEnabled && (phone.length < 10 || !instanceId)) {
      return NextResponse.json(
        { error: 'Para ativar o resumo, informe o telefone (com DDI) e o número que vai enviar.', code: 'invalid' },
        { status: 400 }
      )
    }

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    if (instanceId) {
      const { data: inst } = await db
        .from('unofficial_wa_instances')
        .select('id')
        .eq('id', instanceId)
        .eq('account_id', accountId)
        .maybeSingle()
      if (!inst) {
        return NextResponse.json({ error: 'O número escolhido não pertence a esta conta.', code: 'invalid' }, { status: 400 })
      }
    }

    const { error } = await db.from('alert_settings').upsert({
      account_id: accountId,
      unanswered_minutes: minutes,
      ai_scan_enabled: body.ai_scan_enabled !== false,
      summary_enabled: summaryEnabled,
      summary_phone: phone || null,
      summary_instance_id: instanceId,
      summary_hour: hour,
      ai_model: aiModel || null,
      updated_at: new Date().toISOString(),
    })

    if (error) {
      console.error('[alerts/settings] upsert failed:', error.code, error.message)
      const missingTable =
        error.code === 'PGRST205' ||
        error.code === 'PGRST204' ||
        error.code === '42P01' ||
        error.code === '42703' ||
        /alert_settings|ai_model/.test(error.message)
      return NextResponse.json(
        {
          error: missingTable
            ? 'Faltam tabelas ou colunas dos alertas no Supabase. Rode os SQLs das migrações 048 e 049.'
            : error.message,
          code: missingTable ? 'missing_migration' : 'db_error',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
