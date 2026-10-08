/**
 * POST /api/unofficial/react
 * Body: { message_id: <internal UUID>, emoji: <emoji or "" to remove> }
 * Reacts through the Evolution API and mirrors the reaction into `message_reactions`.
 */

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { sendReaction } from '@/lib/whatsapp/unofficial/evolution-api'

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`react:${userId}`, RATE_LIMITS.react)
    if (!limit.success) return rateLimitResponse(limit)

    const { message_id, emoji } = (await request.json()) as {
      message_id?: string
      emoji?: string
    }
    if (!message_id || typeof emoji !== 'string') {
      return NextResponse.json({ error: 'message_id and emoji are required' }, { status: 400 })
    }

    const { data: target } = await supabase
      .from('messages')
      .select('id, message_id, conversation_id, sender_type')
      .eq('id', message_id)
      .maybeSingle()
    if (!target) return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    if (!target.message_id) {
      return NextResponse.json(
        { error: 'Esta mensagem ainda não foi enviada ao WhatsApp.' },
        { status: 400 },
      )
    }

    const { data: conv } = await supabase
      .from('conversations')
      .select('id, contacts(phone), unofficial_wa_instances(instance_name)')
      .eq('id', target.conversation_id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const phone = (conv as any).contacts?.phone as string | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instanceName = (conv as any).unofficial_wa_instances?.instance_name as string | undefined
    if (!phone || !instanceName) {
      return NextResponse.json(
        { error: 'Esta conversa não está ligada a um número não oficial.' },
        { status: 400 },
      )
    }

    try {
      await sendReaction(
        instanceName,
        {
          remoteJid: `${phone.replace(/\D/g, '')}@s.whatsapp.net`,
          fromMe: target.sender_type !== 'customer',
          id: target.message_id,
        },
        emoji,
      )
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      console.error('[unofficial/react] evolution error:', raw)
      return NextResponse.json(
        { error: `Falha ao reagir pelo WhatsApp: ${raw.replace(/^\[evolution-api\]\s*/, '')}` },
        { status: 502 },
      )
    }

    if (emoji === '') {
      await supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', target.id)
        .eq('actor_type', 'agent')
        .eq('actor_id', userId)
    } else {
      const { error } = await supabase.from('message_reactions').upsert(
        {
          message_id: target.id,
          conversation_id: target.conversation_id,
          actor_type: 'agent',
          actor_id: userId,
          emoji,
        },
        { onConflict: 'message_id,actor_type,actor_id' },
      )
      if (error) {
        console.error('[unofficial/react] DB upsert failed:', error.message)
        return NextResponse.json({ error: 'Reação enviada, mas não foi salva no CRM.' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
