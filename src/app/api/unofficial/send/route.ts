/**
 * POST /api/unofficial/send
 *
 * Send a message via the unofficial WhatsApp API (Evolution API / Baileys).
 * Resolves which instance to use from the conversation's unofficial_instance_id.
 * Auth: requires 'agent' role.
 *
 * Body:
 *   { conversation_id,
 *     message_type: "text"|"image"|"video"|"audio"|"document"|"sticker"|"poll"|"contact"|"interactive",
 *     content_text?, media_url?, filename?, reply_to_message_id?,
 *     poll?: { name, options[], selectable_count? },
 *     contact?: { name, phone },
 *     interactive_payload? }
 */

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  sendText,
  sendMedia,
  sendVoice,
  sendSticker,
  sendPoll,
  sendContact,
  sendButtons,
  sendList,
  type MediaType,
  type QuotedRef,
  type SendResult,
} from '@/lib/whatsapp/unofficial/evolution-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'

function friendlyEvolutionError(raw: string): string {
  const clean = raw.replace(/^\[evolution-api\]\s*/, '')
  if (/"exists":\s*false|not.*exist.*whatsapp/i.test(raw)) {
    return 'Este número não tem WhatsApp (ou o número do contato está incorreto).'
  }
  if (/instance.*does not exist|not found/i.test(raw)) {
    return 'Este número do CRM não existe mais na Evolution. Gere o QR novamente em Configurações → Números WhatsApp.'
  }
  if (/connection closed|not connected|disconnected|close/i.test(raw)) {
    return 'O número está desconectado. Reconecte em Configurações → Números WhatsApp.'
  }
  return `Falha ao enviar pelo WhatsApp: ${clean}`
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`unofficial_send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json()
    const {
      conversation_id,
      message_type,
      content_text,
      media_url,
      filename,
      reply_to_message_id,
      poll,
      contact: contactCard,
      interactive_payload,
    } = body as {
      conversation_id?: string
      message_type?: string
      content_text?: string
      media_url?: string
      filename?: string
      reply_to_message_id?: string
      poll?: { name?: string; options?: string[]; selectable_count?: number }
      contact?: { name?: string; phone?: string }
      interactive_payload?: InteractiveMessagePayload
    }

    if (!conversation_id || !message_type) {
      return NextResponse.json(
        { error: 'conversation_id and message_type are required' },
        { status: 400 }
      )
    }

    // Resolve recipient + instance from the conversation
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select(`
        unofficial_instance_id,
        group_jid,
        contacts(phone),
        unofficial_wa_instances(instance_name)
      `)
      .eq('id', conversation_id)
      .eq('account_id', accountId)
      .single()

    if (convErr || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = conv as any
    const groupJid = (c.group_jid as string | null) ?? null
    const phone = c.contacts?.phone as string | null | undefined
    const instanceName = c.unofficial_wa_instances?.instance_name as string | null | undefined

    if (!groupJid && !phone) {
      return NextResponse.json({ error: 'Contact has no phone number' }, { status: 400 })
    }
    if (!instanceName) {
      return NextResponse.json(
        { error: 'This conversation has no unofficial WhatsApp instance linked. Open the conversation from a message received via an unofficial number.' },
        { status: 400 }
      )
    }
    const target = groupJid ?? phone!
    const chatJid = groupJid ?? `${phone!.replace(/\D/g, '')}@s.whatsapp.net`

    // Message being replied to (quoted bubble)
    let quoted: QuotedRef | undefined
    if (reply_to_message_id) {
      const { data: parent } = await supabase
        .from('messages')
        .select('message_id, sender_type, content_text, sender_jid')
        .eq('id', reply_to_message_id)
        .eq('conversation_id', conversation_id)
        .maybeSingle()
      if (parent?.message_id) {
        quoted = {
          id: parent.message_id,
          remoteJid: chatJid,
          fromMe: parent.sender_type !== 'customer',
          participant: groupJid && parent.sender_type === 'customer' ? parent.sender_jid : null,
          text: parent.content_text,
        }
      }
    }

    // What gets persisted for this message
    let persistType: string = message_type
    let persistText: string | null = content_text ?? null
    let persistMediaUrl: string | null = media_url ?? null
    let persistMediaType: string | null = null
    let persistInteractive: InteractiveMessagePayload | null = null
    let previewLabel = content_text || `[${message_type}]`

    let result: SendResult
    try {
      switch (message_type) {
        case 'text': {
          if (!content_text) {
            return NextResponse.json({ error: 'content_text is required for text messages' }, { status: 400 })
          }
          result = await sendText(instanceName, target, content_text, quoted)
          break
        }

        case 'image':
        case 'video':
        case 'document': {
          if (!media_url) {
            return NextResponse.json({ error: 'media_url is required for media messages' }, { status: 400 })
          }
          result = await sendMedia(
            instanceName, target, media_url, message_type as MediaType,
            content_text ?? undefined, filename, quoted
          )
          break
        }

        case 'audio': {
          if (!media_url) {
            return NextResponse.json({ error: 'media_url is required for media messages' }, { status: 400 })
          }
          try {
            result = await sendVoice(instanceName, target, media_url, quoted)
          } catch {
            result = await sendMedia(instanceName, target, media_url, 'audio', undefined, filename, quoted)
          }
          persistText = null
          break
        }

        case 'sticker': {
          if (!media_url) {
            return NextResponse.json({ error: 'media_url is required for stickers' }, { status: 400 })
          }
          result = await sendSticker(instanceName, target, media_url, quoted)
          persistType = 'image'
          persistText = null
          persistMediaType = 'image/webp'
          previewLabel = '[image]'
          break
        }

        case 'poll': {
          const name = poll?.name?.trim()
          const options = (poll?.options ?? []).map((o) => o.trim()).filter(Boolean)
          if (!name || options.length < 2) {
            return NextResponse.json({ error: 'A enquete precisa de uma pergunta e pelo menos 2 opções.' }, { status: 400 })
          }
          if (options.length > 12) {
            return NextResponse.json({ error: 'A enquete aceita no máximo 12 opções.' }, { status: 400 })
          }
          result = await sendPoll(instanceName, target, name, options, poll?.selectable_count ?? 1)
          persistType = 'text'
          persistText = [`📊 ${name}`, ...options.map((o) => `○ ${o}`)].join('\n')
          previewLabel = `📊 ${name}`
          break
        }

        case 'contact': {
          const name = contactCard?.name?.trim()
          const number = contactCard?.phone?.replace(/\D/g, '')
          if (!name || !number || number.length < 8) {
            return NextResponse.json({ error: 'Informe o nome e o telefone (com DDI) do contato.' }, { status: 400 })
          }
          result = await sendContact(instanceName, target, { fullName: name, phoneNumber: number })
          persistType = 'text'
          persistText = `👤 ${name}\n+${number}`
          previewLabel = `👤 ${name}`
          break
        }

        case 'interactive': {
          if (!interactive_payload) {
            return NextResponse.json({ error: 'interactive_payload is required' }, { status: 400 })
          }
          const p = interactive_payload
          if (p.kind === 'buttons') {
            result = await sendButtons(instanceName, target, {
              title: p.header ?? p.body.slice(0, 60),
              description: p.body,
              footer: p.footer,
              buttons: p.buttons,
            })
          } else {
            result = await sendList(instanceName, target, {
              title: p.header ?? p.body.slice(0, 60),
              description: p.body,
              footer: p.footer,
              buttonText: p.button_label,
              sections: p.sections,
            })
          }
          persistType = 'interactive'
          persistText = p.body
          persistInteractive = p
          previewLabel = p.body
          break
        }

        default:
          return NextResponse.json({ error: `Unsupported message_type: ${message_type}` }, { status: 400 })
      }
    } catch (sendErr) {
      const raw = sendErr instanceof Error ? sendErr.message : String(sendErr)
      console.error('[unofficial/send] evolution error:', raw)
      return NextResponse.json({ error: friendlyEvolutionError(raw) }, { status: 502 })
    }

    const waMessageId = result.key?.id
    if (!waMessageId) {
      return NextResponse.json({ error: 'O WhatsApp não confirmou o envio.' }, { status: 502 })
    }

    // Persist the outbound message
    const { data: inserted, error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id,
        sender_type: 'agent',
        sender_id: userId,
        content_type: persistType,
        content_text: persistText,
        media_url: persistMediaUrl,
        ...(persistMediaType ? { media_type: persistMediaType } : {}),
        ...(persistInteractive ? { interactive_payload: persistInteractive } : {}),
        ...(reply_to_message_id ? { reply_to_message_id } : {}),
        message_id: waMessageId,
        status: 'sent',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    // The Evolution webhook may have already stored this outbound message (unique conversation+message_id)
    if (msgErr?.code === '23505') {
      if (reply_to_message_id) {
        await supabase
          .from('messages')
          .update({ reply_to_message_id })
          .eq('conversation_id', conversation_id)
          .eq('message_id', waMessageId)
          .is('reply_to_message_id', null)
      }
      return NextResponse.json({ success: true, whatsapp_message_id: waMessageId })
    }

    if (msgErr || !inserted) {
      console.error('[unofficial/send] message persist error:', msgErr)
      return NextResponse.json({ error: 'Message sent but failed to save' }, { status: 500 })
    }

    await supabase
      .from('conversations')
      .update({
        last_message_text: previewLabel,
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
