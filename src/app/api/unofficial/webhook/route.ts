import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

export const maxDuration = 60

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

function phoneFromJid(jid: string): string | null {
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast')) return null
  const digits = jid.split('@')[0]
  if (!/^\d+$/.test(digits)) return null
  return `+${digits}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMessage(msg: Record<string, any>): {
  contentType: string; contentText: string | null; mediaUrl: string | null; mediaType: string | null
} {
  if (msg.conversation)
    return { contentType: 'text', contentText: msg.conversation, mediaUrl: null, mediaType: null }
  if (msg.extendedTextMessage)
    return { contentType: 'text', contentText: msg.extendedTextMessage.text, mediaUrl: null, mediaType: null }
  if (msg.imageMessage)
    return { contentType: 'image', contentText: msg.imageMessage.caption ?? null, mediaUrl: msg.imageMessage.url ?? null, mediaType: msg.imageMessage.mimetype ?? null }
  if (msg.videoMessage)
    return { contentType: 'video', contentText: msg.videoMessage.caption ?? null, mediaUrl: msg.videoMessage.url ?? null, mediaType: msg.videoMessage.mimetype ?? null }
  if (msg.audioMessage)
    return { contentType: 'audio', contentText: null, mediaUrl: msg.audioMessage.url ?? null, mediaType: msg.audioMessage.mimetype ?? null }
  if (msg.documentMessage)
    return { contentType: 'document', contentText: msg.documentMessage.caption ?? msg.documentMessage.fileName ?? null, mediaUrl: msg.documentMessage.url ?? null, mediaType: msg.documentMessage.mimetype ?? null }
  if (msg.stickerMessage)
    return { contentType: 'image', contentText: null, mediaUrl: msg.stickerMessage.url ?? null, mediaType: msg.stickerMessage.mimetype ?? null }
  return { contentType: 'text', contentText: '[unsupported]', mediaUrl: null, mediaType: null }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMessage(instanceName: string, msgData: Record<string, any>) {
  const db = supabaseAdmin()

  // Resolve instance in DB
  const { data: instanceRow } = await db
    .from('unofficial_wa_instances')
    .select('id, account_id, label')
    .eq('instance_name', instanceName)
    .maybeSingle()

  if (!instanceRow) {
    console.error('[unofficial/webhook] instance not found in DB:', instanceName)
    return
  }

  const key = msgData.key
  if (!key) { console.warn('[unofficial/webhook] no key in message data'); return }
  const fromMe = key.fromMe === true

  // Newer WhatsApp versions may address chats by @lid; prefer the real phone JID when provided
  const rawJid: string = key.remoteJid ?? ''
  const jid = rawJid.endsWith('@lid') ? (key.remoteJidAlt ?? key.senderPn ?? rawJid) : rawJid
  const phone = phoneFromJid(jid)
  if (!phone) { console.warn('[unofficial/webhook] invalid jid:', key.remoteJid); return }

  const message = msgData.message
  if (!message) { console.warn('[unofficial/webhook] no message content'); return }

  console.log('[unofficial/webhook] processing message from', phone, 'via', instanceName)

  // Resolve owner user
  const { data: profileRow } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', instanceRow.account_id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!profileRow?.user_id) {
    console.error('[unofficial/webhook] no owner user for account:', instanceRow.account_id)
    return
  }
  const ownerUserId = profileRow.user_id

  // Find or create contact
  let contactId: string
  const existing = await findExistingContact(db, instanceRow.account_id, phone)
  if (existing) {
    contactId = existing.id
    if (!fromMe && msgData.pushName && msgData.pushName !== existing.name) {
      await db.from('contacts').update({ name: msgData.pushName, updated_at: new Date().toISOString() }).eq('id', existing.id)
    }
  } else {
    const { data: created, error: createErr } = await db
      .from('contacts')
      .insert({ account_id: instanceRow.account_id, user_id: ownerUserId, phone, name: (!fromMe && msgData.pushName) || phone })
      .select('id').single()
    if (createErr || !created) {
      if (isUniqueViolation(createErr)) {
        const raced = await findExistingContact(db, instanceRow.account_id, phone)
        if (!raced) { console.error('[unofficial/webhook] contact race failed'); return }
        contactId = raced.id
      } else {
        console.error('[unofficial/webhook] contact create error:', createErr)
        return
      }
    } else {
      contactId = created.id
    }
  }

  // Find or create conversation
  const { data: convRows } = await db
    .from('conversations')
    .select('id, status')
    .eq('account_id', instanceRow.account_id)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  let conversationId: string
  let conversationCreated = false

  if (convRows && convRows.length > 0) {
    conversationId = convRows[0].id
    await db.from('conversations').update({ unofficial_instance_id: instanceRow.id })
      .eq('id', conversationId).is('unofficial_instance_id', null)
  } else {
    const { data: newConv, error: convErr } = await db
      .from('conversations')
      .insert({ account_id: instanceRow.account_id, user_id: ownerUserId, contact_id: contactId, unofficial_instance_id: instanceRow.id })
      .select('id, status').single()
    if (convErr || !newConv) {
      if (isUniqueViolation(convErr)) {
        const { data: raced } = await db.from('conversations').select('id, status')
          .eq('account_id', instanceRow.account_id).eq('contact_id', contactId)
          .order('created_at', { ascending: true }).limit(1)
        if (raced && raced.length > 0) { conversationId = raced[0].id }
        else { console.error('[unofficial/webhook] conversation race failed'); return }
      } else {
        console.error('[unofficial/webhook] conversation create error:', convErr)
        return
      }
    } else {
      conversationId = newConv.id
      conversationCreated = true
    }
  }

  if (conversationCreated) {
    await dispatchWebhookEvent(db, instanceRow.account_id, 'conversation.created', {
      conversation_id: conversationId, contact_id: contactId,
    })
  }

  // Insert message
  const { contentType, contentText, mediaUrl, mediaType } = parseMessage(message)
  const ts = msgData.messageTimestamp
  const tsMs = typeof ts === 'number' ? ts * 1000 : parseInt(String(ts || Date.now())) * 1000
  const createdAt = isNaN(tsMs) ? new Date().toISOString() : new Date(tsMs).toISOString()

  const { data: insertedRows, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: fromMe ? 'agent' : 'customer',
      content_type: contentType,
      content_text: contentText,
      media_url: mediaUrl,
      media_type: mediaType,
      message_id: key.id,
      status: fromMe ? 'sent' : 'delivered',
      created_at: createdAt,
    })
    .select('id')

  if (msgError) {
    // Duplicate message — ignore silently
    if (isUniqueViolation(msgError)) { console.log('[unofficial/webhook] duplicate message, skipping'); return }
    console.error('[unofficial/webhook] message insert error:', msgError)
    return
  }
  if (!insertedRows || insertedRows.length === 0) { console.warn('[unofficial/webhook] no rows inserted'); return }

  console.log('[unofficial/webhook] message saved, id:', insertedRows[0].id)

  // Sent from the phone itself: just refresh the preview — no unread bump, flows, automations or AI.
  if (fromMe) {
    await db.from('conversations').update({
      last_message_text: contentText || `[${contentType}]`,
      last_message_at: createdAt,
      updated_at: new Date().toISOString(),
    }).eq('id', conversationId)
    return
  }

  // Bump conversation (last_message_at + unread_count++)
  const { error: bumpError } = await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversationId,
    p_last_message_text: contentText || `[${contentType}]`,
  })
  if (bumpError) {
    console.error('[unofficial/webhook] bump rpc error:', bumpError)
    // Fallback: update manually so the inbox sorts correctly
    await db.from('conversations').update({
      last_message_text: contentText || `[${contentType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', conversationId)
  }

  // Reopen if closed
  const { data: convRow } = await db.from('conversations').select('id, status').eq('id', conversationId).single()
  if (convRow) await reopenClosedConversation(db, convRow)

  const messagePayload = {
    id: insertedRows[0].id,
    conversation_id: conversationId,
    contact_id: contactId,
    message_id: key.id,
    content_type: contentType,
    content_text: contentText,
    sender_type: 'customer' as const,
  }

  // Flows, automations, AI — fire and forget individually so one failure doesn't block others
  dispatchInboundToFlows({
    accountId: instanceRow.account_id,
    userId: ownerUserId,
    contactId,
    conversationId,
    message: { kind: 'text' as const, text: contentText ?? '', meta_message_id: key.id },
    isFirstInboundMessage: conversationCreated,
  }).then(flowResult => {
    if (!flowResult.consumed && contentText?.trim()) {
      dispatchInboundToAiReply({
        accountId: instanceRow.account_id,
        conversationId,
        contactId,
        configOwnerUserId: ownerUserId,
        inboundMessageId: key.id,
      }).catch(e => console.error('[unofficial/webhook] ai reply error:', e))
    }
  }).catch(e => console.error('[unofficial/webhook] flows error:', e))

  runAutomationsForTrigger({
    accountId: instanceRow.account_id,
    triggerType: 'new_message_received',
    contactId,
    context: { message_text: contentText ?? '', conversation_id: conversationId },
  }).catch(e => console.error('[unofficial/webhook] automations error:', e))

  dispatchWebhookEvent(db, instanceRow.account_id, 'message.received', {
    conversation_id: conversationId, contact_id: contactId, message: messagePayload,
  }).catch(e => console.error('[unofficial/webhook] webhook event error:', e))
}

export async function POST(request: Request) {
  const secret = process.env.UNOFFICIAL_WA_WEBHOOK_SECRET
  if (secret) {
    const incoming =
      request.headers.get('x-evolution-webhook-secret') ??
      request.headers.get('authorization')?.replace('Bearer ', '')
    if (incoming !== secret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = (body.event as string ?? '').toLowerCase().replace(/_/g, '.')
  const instanceName = body.instance as string

  console.log('[unofficial/webhook] event:', event, 'instance:', instanceName)

  // Process asynchronously — PM2 keeps process alive so fire-and-forget is safe
  setImmediate(async () => {
    try {
      if (event === 'connection.update') {
        const state = (body.data as Record<string, unknown>)?.state as string | undefined
        if (state) {
          const status = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
          await supabaseAdmin()
            .from('unofficial_wa_instances')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('instance_name', instanceName)
          console.log('[unofficial/webhook] connection status updated:', instanceName, status)
        }
        return
      }

      if (event === 'messages.upsert') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = body.data as any
        // Handle both array and object formats
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const messages: any[] = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [data]
        for (const msgData of messages) {
          await handleMessage(instanceName, msgData)
        }
      }
    } catch (err) {
      console.error('[unofficial/webhook] processing error:', err)
    }
  })

  return NextResponse.json({ status: 'received' })
}
