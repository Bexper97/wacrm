/**
 * POST /api/unofficial/send
 *
 * Send a message via the unofficial WhatsApp API (Evolution API / Baileys).
 * Resolves which instance to use from the conversation's unofficial_instance_id.
 * Auth: requires 'agent' role.
 *
 * Body:
 *   { conversation_id, message_type: "text"|"image"|"video"|"audio"|"document",
 *     content_text?, media_url?, filename? }
 */

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { sendText, sendMedia, type MediaType } from '@/lib/whatsapp/unofficial/evolution-api'

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`unofficial_send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json()
    const { conversation_id, message_type, content_text, media_url, filename } = body

    if (!conversation_id || !message_type) {
      return NextResponse.json(
        { error: 'conversation_id and message_type are required' },
        { status: 400 }
      )
    }

    // Resolve phone + instance from the conversation
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select(`
        unofficial_instance_id,
        contacts(phone),
        unofficial_wa_instances(instance_name)
      `)
      .eq('id', conversation_id)
      .eq('account_id', accountId)
      .single()

    if (convErr || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const phone = (conv.contacts as { phone: string } | null)?.phone
    if (!phone) {
      return NextResponse.json({ error: 'Contact has no phone number' }, { status: 400 })
    }

    const instanceName = (conv.unofficial_wa_instances as { instance_name: string } | null)?.instance_name
    if (!instanceName) {
      return NextResponse.json(
        { error: 'This conversation has no unofficial WhatsApp instance linked. Open the conversation from a message received via an unofficial number.' },
        { status: 400 }
      )
    }

    // Send via Evolution API
    let waMessageId: string
    if (message_type === 'text') {
      if (!content_text) {
        return NextResponse.json({ error: 'content_text is required for text messages' }, { status: 400 })
      }
      const result = await sendText(instanceName, phone, content_text)
      waMessageId = result.key.id
    } else {
      if (!media_url) {
        return NextResponse.json({ error: 'media_url is required for media messages' }, { status: 400 })
      }
      const mediaTypes: Record<string, MediaType> = {
        image: 'image', video: 'video', audio: 'audio', document: 'document',
      }
      const mediatype = mediaTypes[message_type]
      if (!mediatype) {
        return NextResponse.json({ error: `Unsupported message_type: ${message_type}` }, { status: 400 })
      }
      const result = await sendMedia(instanceName, phone, media_url, mediatype, content_text ?? undefined, filename)
      waMessageId = result.key.id
    }

    // Persist the outbound message
    const { data: inserted, error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id,
        sender_type: 'agent',
        content_type: message_type,
        content_text: content_text ?? null,
        media_url: media_url ?? null,
        message_id: waMessageId,
        status: 'sent',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (msgErr || !inserted) {
      console.error('[unofficial/send] message persist error:', msgErr)
      return NextResponse.json({ error: 'Message sent but failed to save' }, { status: 500 })
    }

    await supabase
      .from('conversations')
      .update({
        last_message_text: content_text || `[${message_type}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation_id)

    return NextResponse.json({
      success: true,
      message_id: inserted.id,
      whatsapp_message_id: waMessageId,
    })
  } catch (error) {
    console.error('[unofficial/send] error:', error)
    return toErrorResponse(error)
  }
}
