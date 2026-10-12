import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { getMediaBase64, getGroupInfo } from '@/lib/whatsapp/unofficial/evolution-api'
import { refreshContactAvatar } from '@/lib/whatsapp/unofficial/avatars'
import {
  parseEvolutionMessage,
  unwrap,
  type CallEvent,
} from '@/lib/whatsapp/unofficial/parse-message'
import { buildMediaPath, MEDIA_MAX_BYTES } from '@/lib/storage/upload-media'
import {
  MIRROR_BUCKET,
  MIRROR_FOLDER,
  mirrorFileName,
  normalizeMimeType,
} from '@/lib/whatsapp/mirror-inbound-media'

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

async function storeReaction(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
  conversationId: string
  targetWaId: string
  emoji: string
  actorType: 'agent' | 'customer'
  actorId: string
}) {
  if (!args.targetWaId) return
  const { data: target } = await args.db
    .from('messages')
    .select('id')
    .eq('conversation_id', args.conversationId)
    .eq('message_id', args.targetWaId)
    .maybeSingle()
  if (!target) { console.warn('[unofficial/webhook] reaction target not found:', args.targetWaId); return }

  if (!args.emoji) {
    await args.db.from('message_reactions').delete()
      .eq('message_id', target.id).eq('actor_type', args.actorType).eq('actor_id', args.actorId)
    return
  }
  const { error } = await args.db.from('message_reactions').upsert(
    {
      message_id: target.id,
      conversation_id: args.conversationId,
      actor_type: args.actorType,
      actor_id: args.actorId,
      emoji: args.emoji,
    },
    { onConflict: 'message_id,actor_type,actor_id' },
  )
  if (error) console.error('[unofficial/webhook] reaction upsert error:', error.message)
}

interface CallState {
  kind: 'voice' | 'video'
  dir: 'in' | 'out'
  state: 'ringing' | 'answered' | 'missed' | 'rejected' | 'noanswer'
  acceptedAt?: number
  durationSec?: number
}

/** Folds one call event into the stored state of that call. */
function mergeCallState(prevJson: string | null, ev: CallEvent): CallState {
  let prev: CallState | null = null
  try { prev = prevJson ? (JSON.parse(prevJson) as CallState) : null } catch { prev = null }
  const call: CallState = prev ?? {
    kind: ev.isVideo ? 'video' : 'voice',
    dir: ev.outgoing ? 'out' : 'in',
    state: 'ringing',
  }
  if (ev.isVideo) call.kind = 'video'

  switch (ev.status) {
    case 'accept':
      if (call.state !== 'answered') { call.state = 'answered'; call.acceptedAt = ev.date }
      break
    case 'reject':
      if (call.state === 'ringing') call.state = 'rejected'
      break
    case 'timeout':
      if (call.state === 'ringing') call.state = call.dir === 'in' ? 'missed' : 'noanswer'
      break
    case 'terminate':
      if (call.state === 'answered') {
        if (call.acceptedAt && call.durationSec === undefined) {
          call.durationSec = Math.max(0, Math.round((ev.date - call.acceptedAt) / 1000))
        }
      } else if (call.state === 'ringing') {
        call.state = call.dir === 'in' ? 'missed' : 'noanswer'
      }
      break
    default:
      // offer / ringing: keep the current state
  }
  return call
}

function formatCallDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}min ${s}s` : `${s}s`
}

function callPreviewText(c: CallState): string {
  const icon = c.kind === 'video' ? '📹' : '📞'
  const kind = c.kind === 'video' ? 'vídeo' : 'voz'
  switch (c.state) {
    case 'answered':
      return `${icon} Chamada de ${kind} atendida${c.durationSec != null ? ` · ${formatCallDuration(c.durationSec)}` : ''}`
    case 'missed': return `${icon} Chamada de ${kind} perdida`
    case 'rejected': return `${icon} Chamada de ${kind} recusada`
    case 'noanswer': return `${icon} Chamada de ${kind} sem resposta`
    default: return `${icon} Chamando…`
  }
}

function previewText(contentType: string, contentText: string | null): string {
  const caption = contentText?.trim()
  switch (contentType) {
    case 'image': return caption ? `📷 ${caption}` : '📷 Foto'
    case 'video': return caption ? `🎥 ${caption}` : '🎥 Vídeo'
    case 'audio': return '🎤 Áudio'
    case 'document': return caption ? `📄 ${caption}` : '📄 Documento'
    case 'location': return '📍 Localização'
    default: return caption || `[${contentType}]`
  }
}

async function mirrorMedia(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
  accountId: string
  instanceName: string
  messageId: string
  inlineBase64: string | null
  mimeType: string | null
  fileName: string | null
  timestamp: unknown
}): Promise<{ url: string; mimeType: string | null } | null> {
  try {
    let base64 = args.inlineBase64
    let mime = normalizeMimeType(args.mimeType)
    if (!base64) {
      const res = await getMediaBase64(args.instanceName, args.messageId)
      base64 = res.base64 ?? null
      mime = normalizeMimeType(res.mimetype) ?? mime
    }
    if (!base64) { console.warn('[unofficial/webhook] no media base64 for', args.messageId); return null }

    const buffer = Buffer.from(base64.replace(/^data:[^,]*,/, ''), 'base64')
    if (buffer.byteLength > MEDIA_MAX_BYTES) {
      console.warn('[unofficial/webhook] media too large:', buffer.byteLength)
      return null
    }

    const uploadType = mime ?? 'application/octet-stream'
    const name = mirrorFileName({
      mediaId: args.messageId,
      mimeType: uploadType,
      fileName: args.fileName,
      messageTimestamp: args.timestamp as string | number | null,
    })
    const path = buildMediaPath(args.accountId, name, null, MIRROR_FOLDER)
    const { error } = await args.db.storage.from(MIRROR_BUCKET).upload(path, buffer, {
      contentType: uploadType,
      cacheControl: '3600',
      upsert: true,
    })
    if (error) { console.warn('[unofficial/webhook] media upload failed:', error.message, uploadType); return null }

    const { data } = args.db.storage.from(MIRROR_BUCKET).getPublicUrl(path)
    return data?.publicUrl ? { url: data.publicUrl, mimeType: uploadType } : null
  } catch (err) {
    console.warn('[unofficial/webhook] media mirror error:', err instanceof Error ? err.message : err)
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMessage(instanceName: string, msgData: Record<string, any>) {
  const db = supabaseAdmin()

  // Resolve instance in DB
  const { data: instanceRow } = await db
    .from('unofficial_wa_instances')
    .select('id, account_id, label, owner_user_id, pipeline_id, pipeline_stage_id')
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
  const isGroup = rawJid.endsWith('@g.us')
  const jid = rawJid.endsWith('@lid') ? (key.remoteJidAlt ?? key.senderPn ?? rawJid) : rawJid
  // A group has no phone number — its contact row is keyed by the group id digits.
  const phone = isGroup
    ? `+${rawJid.split('@')[0].replace(/\D/g, '')}`
    : phoneFromJid(jid)
  if (!phone) { console.warn('[unofficial/webhook] invalid jid:', key.remoteJid); return }

  const participantJid: string | null = isGroup
    ? (key.participant ?? msgData.participant ?? null)
    : null
  const senderLabel: string | null =
    isGroup && !fromMe
      ? (msgData.pushName || (participantJid ? `+${participantJid.split('@')[0]}` : null))
      : null

  const message = msgData.message
  if (!message) { console.warn('[unofficial/webhook] no message content'); return }

  const parsed = parseEvolutionMessage(message)
  if (parsed.revokedId) { await markDeleted(parsed.revokedId); return }
  if (parsed.skip) { console.log('[unofficial/webhook] skipping system message'); return }

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
  let groupConvContactId: string | null = null
  if (isGroup) {
    const { data: gc } = await db
      .from('conversations')
      .select('contact_id')
      .eq('account_id', instanceRow.account_id)
      .eq('group_jid', rawJid)
      .limit(1)
    groupConvContactId = gc?.[0]?.contact_id ?? null
  }
  const existing = groupConvContactId
    ? { id: groupConvContactId, name: null as string | null }
    : isGroup
      ? null
      : await findExistingContact(db, instanceRow.account_id, phone)
  if (existing) {
    contactId = existing.id
    if (!isGroup && !fromMe && msgData.pushName && msgData.pushName !== existing.name) {
      await db.from('contacts').update({ name: msgData.pushName, updated_at: new Date().toISOString() }).eq('id', existing.id)
    }
  } else {
    const groupName = isGroup
      ? ((await getGroupInfo(instanceName, rawJid))?.subject ?? 'Grupo')
      : null
    const { data: created, error: createErr } = await db
      .from('contacts')
      .insert({
        account_id: instanceRow.account_id,
        user_id: ownerUserId,
        phone,
        name: groupName ?? ((!fromMe && msgData.pushName) || phone),
      })
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
    .select('id, status, assigned_agent_id')
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
    if (instanceRow.owner_user_id && !convRows[0].assigned_agent_id) {
      await db.from('conversations').update({ assigned_agent_id: instanceRow.owner_user_id })
        .eq('id', conversationId).is('assigned_agent_id', null)
    }
  } else {
    const { data: newConv, error: convErr } = await db
      .from('conversations')
      .insert({
        account_id: instanceRow.account_id,
        user_id: ownerUserId,
        contact_id: contactId,
        unofficial_instance_id: instanceRow.id,
        assigned_agent_id: instanceRow.owner_user_id ?? null,
        ...(isGroup ? { group_jid: rawJid } : {}),
      })
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

  if (parsed.reaction) {
    await storeReaction({
      db,
      conversationId,
      targetWaId: parsed.reaction.targetId,
      emoji: parsed.reaction.emoji,
      actorType: fromMe ? 'agent' : 'customer',
      actorId: fromMe ? (instanceRow.owner_user_id ?? ownerUserId) : contactId,
    })
    return
  }

  if (conversationCreated && !isGroup && instanceRow.pipeline_stage_id && instanceRow.pipeline_id) {
    try {
      const { data: acct } = await db
        .from('accounts').select('default_currency').eq('id', instanceRow.account_id).maybeSingle()
      const { error: dealErr } = await db.from('deals').insert({
        account_id: instanceRow.account_id,
        user_id: instanceRow.owner_user_id ?? ownerUserId,
        pipeline_id: instanceRow.pipeline_id,
        stage_id: instanceRow.pipeline_stage_id,
        contact_id: contactId,
        conversation_id: conversationId,
        title: msgData.pushName && !fromMe ? msgData.pushName : phone,
        value: 0,
        currency: acct?.default_currency ?? 'BRL',
        status: 'open',
      })
      if (dealErr) console.error('[unofficial/webhook] auto-deal error:', dealErr)
    } catch (e) {
      console.error('[unofficial/webhook] auto-deal exception:', e)
    }
  }

  if (conversationCreated) {
    await dispatchWebhookEvent(db, instanceRow.account_id, 'conversation.created', {
      conversation_id: conversationId, contact_id: contactId,
    })
  }

  // Call events update ONE card per call id instead of adding messages.
  let callText: string | null = null
  let callPreview: string | null = null
  if (parsed.call) {
    const { data: existingCall } = await db
      .from('messages')
      .select('id, content_text')
      .eq('conversation_id', conversationId)
      .eq('message_id', key.id)
      .maybeSingle()
    const next = mergeCallState(existingCall?.content_text ?? null, parsed.call)
    callText = JSON.stringify(next)
    callPreview = callPreviewText(next)
    if (existingCall) {
      await db.from('messages').update({ content_text: callText }).eq('id', existingCall.id)
      await db.from('conversations').update({
        last_message_text: callPreview,
        updated_at: new Date().toISOString(),
      }).eq('id', conversationId)
      return
    }
  }

  // Insert message
  const contentType = parsed.contentType
  const contentText = callText ?? parsed.contentText
  const messagePreview = callPreview ?? previewText(contentType, contentText)
  let mediaType = parsed.mediaType
  let mediaUrl: string | null = null

  if (['image', 'video', 'audio', 'document'].includes(contentType)) {
    const mirrored = await mirrorMedia({
      db,
      accountId: instanceRow.account_id,
      instanceName,
      messageId: key.id,
      inlineBase64: message.base64 ?? msgData.base64 ?? null,
      mimeType: mediaType,
      fileName: unwrap(message).documentMessage?.fileName ?? null,
      timestamp: msgData.messageTimestamp,
    })
    if (mirrored) {
      mediaUrl = mirrored.url
      mediaType = mirrored.mimeType
    }
  }
  let replyToInternalId: string | null = null
  if (parsed.quotedId) {
    const { data: quotedRow } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('message_id', parsed.quotedId)
      .maybeSingle()
    replyToInternalId = quotedRow?.id ?? null
  }
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
      ...(parsed.interactivePayload ? { interactive_payload: parsed.interactivePayload } : {}),
      ...(replyToInternalId ? { reply_to_message_id: replyToInternalId } : {}),
      ...(isGroup ? { sender_label: senderLabel, sender_jid: participantJid } : {}),
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

  // Pull the contact's / group's profile photo in the background (once per day at most).
  void refreshContactAvatar({
    db,
    accountId: instanceRow.account_id,
    contactId,
    instanceName,
    target: isGroup ? rawJid : phone.replace(/\D/g, ''),
  })

  // Sent from the phone itself: just refresh the preview — no unread bump, flows, automations or AI.
  if (fromMe) {
    await db.from('conversations').update({
      last_message_text: messagePreview,
      last_message_at: createdAt,
      updated_at: new Date().toISOString(),
    }).eq('id', conversationId)
    return
  }

  // Bump conversation (last_message_at + unread_count++)
  const preview =
    (isGroup && senderLabel ? `${senderLabel}: ` : '') + messagePreview
  const { error: bumpError } = await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversationId,
    p_last_message_text: preview,
  })
  if (bumpError) {
    console.error('[unofficial/webhook] bump rpc error:', bumpError)
    // Fallback: update manually so the inbox sorts correctly
    await db.from('conversations').update({
      last_message_text: preview,
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

  // A call card is a log entry, not something to answer: no flows, automations or AI.
  if (parsed.call) return

  // Group chats never trigger bots: flows, automations and AI replies stay 1:1 only.
  if (isGroup) {
    dispatchWebhookEvent(db, instanceRow.account_id, 'message.received', {
      conversation_id: conversationId, contact_id: contactId, message: messagePayload,
    }).catch(e => console.error('[unofficial/webhook] webhook event error:', e))
    return
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

/** The message stays in the CRM; it is only flagged as deleted on WhatsApp. */
async function markDeleted(waMessageId: string) {
  const { error } = await supabaseAdmin()
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('message_id', waMessageId)
    .is('deleted_at', null)
  if (error) console.error('[unofficial/webhook] mark deleted error:', error.message)
  else console.log('[unofficial/webhook] message flagged as deleted:', waMessageId)
}

/** Turns a CALL event into a synthetic message so it flows through the normal pipeline. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCallEvent(instanceName: string, c: Record<string, any> | null | undefined) {
  if (!c) return
  const callId: string | undefined = c.id ?? c.callId
  if (!callId) return
  if (c.isGroup || c.groupJid) return // group calls are not logged

  const chatJid: string = c.chatId ?? c.from ?? ''
  const creatorJid: string = c.from ?? chatJid
  if (!chatJid) return

  const digits = (jid: string) => jid.split('@')[0].replace(/D/g, '')
  const outgoing = digits(creatorJid) !== digits(chatJid)

  let dateMs = typeof c.date === 'number' ? c.date : Date.parse(String(c.date ?? ''))
  if (!Number.isFinite(dateMs)) dateMs = Date.now()
  else if (dateMs < 1e12) dateMs *= 1000

  await handleMessage(instanceName, {
    key: {
      remoteJid: chatJid,
      remoteJidAlt: c.remoteJidAlt ?? c.senderPn,
      fromMe: outgoing,
      id: `call:${callId}`,
    },
    message: {
      __call: {
        status: String(c.status ?? 'offer').toLowerCase(),
        isVideo: c.isVideo === true,
        outgoing,
        date: dateMs,
      },
    },
    messageTimestamp: Math.floor(dateMs / 1000),
  })
}

// Baileys status codes: 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED
const STATUS_BY_NAME: Record<string, 'sent' | 'delivered' | 'read'> = {
  SERVER_ACK: 'sent',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  PLAYED: 'read',
}
const STATUS_BY_CODE: Record<number, 'sent' | 'delivered' | 'read'> = {
  2: 'sent', 3: 'delivered', 4: 'read', 5: 'read',
}
const LOWER_STATUSES: Record<'sent' | 'delivered' | 'read', string[]> = {
  sent: ['sending'],
  delivered: ['sending', 'sent'],
  read: ['sending', 'sent', 'delivered'],
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyDeliveryStatus(item: Record<string, any> | null | undefined) {
  if (!item) return
  const keyId: string | undefined = item.keyId ?? item.key?.id ?? item.messageId
  const raw = item.status ?? item.update?.status
  const next =
    typeof raw === 'number' ? STATUS_BY_CODE[raw] : STATUS_BY_NAME[String(raw ?? '').toUpperCase()]
  if (!keyId || !next) return

  const { error } = await supabaseAdmin()
    .from('messages')
    .update({ status: next })
    .eq('message_id', keyId)
    .neq('sender_type', 'customer')
    .in('status', LOWER_STATUSES[next])
  if (error) console.error('[unofficial/webhook] status update error:', error.message)
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

      if (event === 'call') {
        const items = Array.isArray(body.data) ? body.data : [body.data]
        console.log('[unofficial/webhook] call event:', JSON.stringify(items))
        for (const c of items) await handleCallEvent(instanceName, c)
        return
      }

      if (event === 'messages.delete') {
        const items = Array.isArray(body.data) ? body.data : [body.data]
        for (const item of items) {
          const id: string | undefined = item?.id ?? item?.key?.id ?? item?.keyId
          if (id) await markDeleted(id)
        }
        return
      }

      if (event === 'messages.update' || event === 'send.message.update') {
        const items = Array.isArray(body.data) ? body.data : [body.data]
        for (const item of items) await applyDeliveryStatus(item)
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
