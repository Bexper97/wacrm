/**
 * POST /api/unofficial/webhook
 *
 * Receives events from Evolution API and persists them into the CRM.
 * Supports multiple WhatsApp numbers: each instance maps to a row in
 * `unofficial_wa_instances`, which carries the account_id + label.
 *
 * Conversations are tagged with `unofficial_instance_id` so the inbox
 * can show which number a conversation came through.
 */

import { NextResponse, after } from 'next/server'
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

// ---------------------------------------------------------------------------
// Evolution API payload types
// ---------------------------------------------------------------------------

interface EvolutionKey {
  remoteJid: string
  fromMe: boolean
  id: string
}

interface EvolutionMessageContent {
  conversation?: string
  extendedTextMessage?: { text: string }
  imageMessage?: { url?: string; mimetype?: string; caption?: string }
  videoMessage?: { url?: string; mimetype?: string; caption?: string }
  audioMessage?: { url?: string; mimetype?: string }
  documentMessage?: { url?: string; mimetype?: string; fileName?: string; caption?: string }
  stickerMessage?: { url?: string; mimetype?: string }
}

interface EvolutionMessageData {
  key: EvolutionKey
  message?: EvolutionMessageContent
  messageTimestamp?: number | string
  pushName?: string
}

interface EvolutionEvent {
  event: string
  instance: string   // Evolution API instance name — used to look up our DB row
  data: EvolutionMessageData | Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function phoneFromJid(jid: string): string | null {
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast')) return null
  const digits = jid.split('@')[0]
  if (!/^\d+$/.test(digits)) return null
  return `+${digits}`
}

function parseEvolutionMessage(msg: EvolutionMessageContent): {
  contentType: string
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
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

// ---------------------------------------------------------------------------
// Resolve account from instance name
// ---------------------------------------------------------------------------

interface InstanceRow {
  id: string
  account_id: string
  label: string
}

async function resolveInstance(instanceName: string): Promise<InstanceRow | null> {
  const { data } = await supabaseAdmin()
    .from('unofficial_wa_instances')
    .select('id, account_id, label')
    .eq('instance_name', instanceName)
    .maybeSingle()
  return data ?? null
}

async function resolveOwnerUserId(accountId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.user_id ?? null
}

// ---------------------------------------------------------------------------
// Find-or-create contact + conversation
// ---------------------------------------------------------------------------

async function resolveContactAndConversation(
  accountId: string,
  ownerUserId: string,
  instanceId: string,
  phone: string,
  displayName?: string
) {
  const db = supabaseAdmin()

  // Contact
  let contactId: string
  const existing = await findExistingContact(db, accountId, phone)
  if (existing) {
    contactId = existing.id
    if (displayName && displayName !== existing.name) {
      await db
        .from('contacts')
        .update({ name: displayName, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
  } else {
    const { data: created, error: createErr } = await db
      .from('contacts')
      .insert({ account_id: accountId, user_id: ownerUserId, phone, name: displayName || phone })
      .select('id')
      .single()
    if (createErr || !created) {
      if (isUniqueViolation(createErr)) {
        const raced = await findExistingContact(db, accountId, phone)
        if (!raced) return null
        contactId = raced.id
      } else {
        console.error('[unofficial/webhook] contact create error:', createErr)
        return null
      }
    } else {
      contactId = created.id
    }
  }

  // Conversation — one per (account, contact), tagged with the instance
  const { data: convRows } = await db
    .from('conversations')
    .select('id, status')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  let conversationId: string
  let conversationCreated = false

  if (convRows && convRows.length > 0) {
    conversationId = convRows[0].id
    // Update instance tag if not set yet
    await db
      .from('conversations')
      .update({ unofficial_instance_id: instanceId })
      .eq('id', conversationId)
      .is('unofficial_instance_id', null)
  } else {
    const { data: newConv, error: convCreateErr } = await db
      .from('conversations')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        contact_id: contactId,
        unofficial_instance_id: instanceId,
      })
      .select('id, status')
      .single()

    if (convCreateErr || !newConv) {
      if (isUniqueViolation(convCreateErr)) {
        const { data: raced } = await db
          .from('conversations')
          .select('id, status')
          .eq('account_id', accountId)
          .eq('contact_id', contactId)
          .order('created_at', { ascending: true })
          .limit(1)
        if (raced && raced.length > 0) {
          conversationId = raced[0].id
        } else return null
      } else {
        console.error('[unofficial/webhook] conversation create error:', convCreateErr)
        return null
      }
    } else {
      conversationId = newConv.id
      conversationCreated = true
    }
  }

  return { contactId, conversationId, conversationCreated }
}

// ---------------------------------------------------------------------------
// Process inbound message
// ---------------------------------------------------------------------------

async function processInboundMessage(
  data: EvolutionMessageData,
  instance: InstanceRow,
  ownerUserId: string
) {
  const { key, message, messageTimestamp, pushName } = data
  if (key.fromMe) return
  const phone = phoneFromJid(key.remoteJid)
  if (!phone || !message) return

  const resolved = await resolveContactAndConversation(
    instance.account_id,
    ownerUserId,
    instance.id,
    phone,
    pushName
  )
  if (!resolved) return

  const { contactId, conversationId, conversationCreated } = resolved
  const db = supabaseAdmin()

  if (conversationCreated) {
    await dispatchWebhookEvent(db, instance.account_id, 'conversation.created', {
      conversation_id: conversationId,
      contact_id: contactId,
    })
  }

  const { contentType, contentText, mediaUrl, mediaType } = parseEvolutionMessage(message)
  const tsMs =
    typeof messageTimestamp === 'number'
      ? messageTimestamp * 1000
      : parseInt(String(messageTimestamp)) * 1000
  const createdAt = new Date(tsMs).toISOString()

  const { data: insertedRows, error: msgError } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: conversationId,
        sender_type: 'customer',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        media_type: mediaType,
        message_id: key.id,
        status: 'delivered',
        created_at: createdAt,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true }
    )
    .select('id')

  if (msgError) {
    console.error('[unofficial/webhook] message insert error:', msgError)
    return
  }
  if (!insertedRows || insertedRows.length === 0) return // replay

  await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversationId,
    p_last_message_text: contentText || `[${contentType}]`,
  })

  const { data: convRow } = await db
    .from('conversations')
    .select('id, status')
    .eq('id', conversationId)
    .single()
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

  const flowResult = await dispatchInboundToFlows({
    accountId: instance.account_id,
    userId: ownerUserId,
    contactId,
    conversationId,
    message: {
      kind: 'text' as const,
      text: contentText ?? '',
      meta_message_id: key.id,
    },
    isFirstInboundMessage: conversationCreated,
  })

  await runAutomationsForTrigger({
    accountId: instance.account_id,
    triggerType: 'new_message_received',
    contactId,
    context: {
      message_text: contentText ?? '',
      conversation_id: conversationId,
    },
  }).catch((err: unknown) => console.error('[unofficial/webhook] automations error:', err))

  if (!flowResult.consumed && contentText?.trim()) {
    await dispatchInboundToAiReply({
      accountId: instance.account_id,
      conversationId,
      contactId,
      configOwnerUserId: ownerUserId,
      inboundMessageId: key.id,
    })
  }

  await dispatchWebhookEvent(db, instance.account_id, 'message.received', {
    conversation_id: conversationId,
    contact_id: contactId,
    message: messagePayload,
  })
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

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

  let body: EvolutionEvent
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  after(async () => {
    try {
      if (body.event === 'connection.update') {
        // Sync connected/disconnected status to DB
        const state = (body.data as Record<string, unknown>).state as string | undefined
        if (state) {
          const status =
            state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
          await supabaseAdmin()
            .from('unofficial_wa_instances')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('instance_name', body.instance)
        }
        return
      }

      if (body.event === 'messages.upsert') {
        const instance = await resolveInstance(body.instance)
        if (!instance) {
          console.warn('[unofficial/webhook] unknown instance:', body.instance)
          return
        }
        const ownerUserId = await resolveOwnerUserId(instance.account_id)
        if (!ownerUserId) return

        await processInboundMessage(
          body.data as EvolutionMessageData,
          instance,
          ownerUserId
        )
      }
    } catch (err) {
      console.error('[unofficial/webhook] processing error:', err)
    }
  })

  return NextResponse.json({ status: 'received' })
}
