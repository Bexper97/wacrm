/**
 * Turns a raw Baileys/Evolution `message` object into something the CRM inbox can render.
 */

import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>

export interface ParsedMessage {
  contentType: string
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
  fileName?: string | null
  interactivePayload?: InteractiveMessagePayload
  /** A reaction is state on another message, never a message of its own. */
  reaction?: { targetId: string; emoji: string }
  /** Protocol/system messages that must not appear in the thread. */
  skip?: boolean
  /** WhatsApp id of the quoted message when this one is a reply. */
  quotedId?: string
}

export function unwrap(msg: Raw): Raw {
  const inner =
    msg.ephemeralMessage?.message ??
    msg.viewOnceMessage?.message ??
    msg.viewOnceMessageV2?.message ??
    msg.viewOnceMessageV2Extension?.message ??
    msg.documentWithCaptionMessage?.message ??
    msg.editedMessage?.message
  return inner ? unwrap(inner) : msg
}

const none = { mediaUrl: null, mediaType: null }

function text(contentText: string | null): ParsedMessage {
  return { contentType: 'text', contentText, ...none }
}

function interactive(payload: InteractiveMessagePayload): ParsedMessage {
  return {
    contentType: 'interactive',
    contentText: payload.body,
    ...none,
    interactivePayload: payload,
  }
}

const NATIVE_FLOW_LABELS: Record<string, string> = {
  review_and_pay: 'Revisar e pagar',
  review_order: 'Ver pedido',
  payment_info: 'Informações de pagamento',
  order_details: 'Ver detalhes',
  cta_copy: 'Copiar código',
  cta_call: 'Ligar',
  open_webview: 'Abrir',
}

function nativeFlowTitle(button: Raw): string {
  let params: Raw = {}
  try {
    params = button.buttonParamsJson ? JSON.parse(button.buttonParamsJson) : {}
  } catch {
    /* keep empty */
  }
  return (
    params.display_text ??
    params.title ??
    NATIVE_FLOW_LABELS[button.name] ??
    (button.name ? String(button.name).replace(/_/g, ' ') : 'Opção')
  )
}

function pollText(poll: Raw): string {
  const options = (poll.options ?? []).map((o: Raw) => `○ ${o.optionName}`)
  return [`📊 ${poll.name ?? 'Enquete'}`, ...options].join('\n')
}

/** WhatsApp id of the message this one replies to, if any. */
function findQuotedId(msg: Raw): string | undefined {
  for (const value of Object.values(msg)) {
    const stanza = (value as Raw | null)?.contextInfo?.stanzaId
    if (typeof stanza === 'string' && stanza) return stanza
  }
  return undefined
}

export function parseEvolutionMessage(raw: Raw): ParsedMessage {
  const parsed = parseInner(raw)
  const quotedId = findQuotedId(unwrap(raw))
  return quotedId ? { ...parsed, quotedId } : parsed
}

function parseInner(raw: Raw): ParsedMessage {
  const msg = unwrap(raw)

  if (msg.reactionMessage) {
    return {
      contentType: 'text',
      contentText: null,
      ...none,
      reaction: {
        targetId: msg.reactionMessage.key?.id ?? '',
        emoji: msg.reactionMessage.text ?? '',
      },
    }
  }

  if (
    msg.protocolMessage ||
    msg.senderKeyDistributionMessage ||
    msg.pollUpdateMessage ||
    msg.messageContextInfo && Object.keys(msg).length === 1
  ) {
    return { contentType: 'text', contentText: null, ...none, skip: true }
  }

  // ---- location / contacts -------------------------------------------
  const loc = msg.locationMessage ?? msg.liveLocationMessage
  if (loc) {
    const lines = [loc.name, loc.address].filter(Boolean) as string[]
    lines.push(`https://www.google.com/maps?q=${loc.degreesLatitude},${loc.degreesLongitude}`)
    return { contentType: 'location', contentText: lines.join('\n'), ...none }
  }
  if (msg.contactMessage)
    return text(`👤 ${msg.contactMessage.displayName ?? 'Contato'}`)
  if (msg.contactsArrayMessage)
    return text(`👤 ${msg.contactsArrayMessage.displayName ?? 'Contatos'}`)

  // ---- plain text ----------------------------------------------------
  if (msg.conversation) return text(msg.conversation)
  if (msg.extendedTextMessage) return text(msg.extendedTextMessage.text ?? '')

  // ---- media ---------------------------------------------------------
  if (msg.imageMessage)
    return { contentType: 'image', contentText: msg.imageMessage.caption ?? null, mediaUrl: null, mediaType: msg.imageMessage.mimetype ?? null }
  if (msg.videoMessage)
    return { contentType: 'video', contentText: msg.videoMessage.caption ?? null, mediaUrl: null, mediaType: msg.videoMessage.mimetype ?? null }
  if (msg.ptvMessage)
    return { contentType: 'video', contentText: null, mediaUrl: null, mediaType: msg.ptvMessage.mimetype ?? 'video/mp4' }
  if (msg.audioMessage)
    return { contentType: 'audio', contentText: null, mediaUrl: null, mediaType: msg.audioMessage.mimetype ?? null }
  if (msg.documentMessage)
    return {
      contentType: 'document',
      contentText: msg.documentMessage.caption ?? msg.documentMessage.fileName ?? null,
      mediaUrl: null,
      mediaType: msg.documentMessage.mimetype ?? null,
      fileName: msg.documentMessage.fileName ?? null,
    }
  if (msg.stickerMessage)
    return { contentType: 'image', contentText: null, mediaUrl: null, mediaType: msg.stickerMessage.mimetype ?? null }

  // ---- buttons / lists / templates / native flow ---------------------
  if (msg.buttonsMessage) {
    const m = msg.buttonsMessage
    return interactive({
      kind: 'buttons',
      body: m.contentText ?? m.text ?? '',
      header: m.headerType === 1 ? m.text : undefined,
      footer: m.footerText,
      buttons: (m.buttons ?? []).map((b: Raw, i: number) => ({
        id: b.buttonId ?? String(i),
        title: b.buttonText?.displayText ?? 'Opção',
      })),
    })
  }

  const hydrated =
    msg.templateMessage?.hydratedTemplate ??
    msg.templateMessage?.hydratedFourRowTemplate ??
    msg.templateMessage?.interactiveMessageTemplate
  if (hydrated && (hydrated.hydratedContentText || hydrated.hydratedButtons)) {
    return interactive({
      kind: 'buttons',
      body: hydrated.hydratedContentText ?? '',
      header: hydrated.hydratedTitleText,
      footer: hydrated.hydratedFooterText,
      buttons: (hydrated.hydratedButtons ?? []).map((b: Raw, i: number) => ({
        id: String(b.index ?? i),
        title:
          b.quickReplyButton?.displayText ??
          b.urlButton?.displayText ??
          b.callButton?.displayText ??
          'Opção',
      })),
    })
  }

  if (msg.interactiveMessage) {
    const m = msg.interactiveMessage
    const buttons = (m.nativeFlowMessage?.buttons ?? []).map((b: Raw, i: number) => ({
      id: b.name ?? String(i),
      title: nativeFlowTitle(b),
    }))
    return interactive({
      kind: 'buttons',
      body: m.body?.text ?? '',
      header: m.header?.title || m.header?.subtitle || undefined,
      footer: m.footer?.text,
      buttons,
    })
  }

  if (msg.listMessage) {
    const m = msg.listMessage
    return interactive({
      kind: 'list',
      body: m.description ?? m.title ?? '',
      header: m.description ? m.title : undefined,
      footer: m.footerText,
      button_label: m.buttonText ?? 'Ver opções',
      sections: (m.sections ?? []).map((s: Raw) => ({
        title: s.title,
        rows: (s.rows ?? []).map((r: Raw, i: number) => ({
          id: r.rowId ?? String(i),
          title: r.title ?? '',
          description: r.description,
        })),
      })),
    })
  }

  // ---- taps on buttons / list rows -----------------------------------
  if (msg.buttonsResponseMessage)
    return { contentType: 'interactive', contentText: msg.buttonsResponseMessage.selectedDisplayText ?? '', ...none }
  if (msg.listResponseMessage)
    return { contentType: 'interactive', contentText: msg.listResponseMessage.title ?? '', ...none }
  if (msg.templateButtonReplyMessage)
    return { contentType: 'interactive', contentText: msg.templateButtonReplyMessage.selectedDisplayText ?? '', ...none }
  if (msg.interactiveResponseMessage) {
    const r = msg.interactiveResponseMessage
    let label: string = r.body?.text ?? ''
    try {
      const params = r.nativeFlowResponseMessage?.paramsJson
        ? JSON.parse(r.nativeFlowResponseMessage.paramsJson)
        : null
      label = label || params?.title || params?.id || r.nativeFlowResponseMessage?.name || ''
    } catch {
      label = label || r.nativeFlowResponseMessage?.name || ''
    }
    return { contentType: 'interactive', contentText: label, ...none }
  }

  // ---- commerce / payments / polls / misc ----------------------------
  if (msg.orderMessage) {
    const o = msg.orderMessage
    const title = o.orderTitle || o.message || 'Pedido'
    return text(`🛒 ${title}${o.itemCount ? ` (${o.itemCount} item(ns))` : ''}`)
  }
  if (msg.productMessage) {
    return text(`🛍️ ${msg.productMessage.product?.title ?? 'Produto'}`)
  }
  const pay = msg.requestPaymentMessage ?? msg.sendPaymentMessage ?? msg.paymentInviteMessage
  if (pay) {
    const amount = pay.amount?.value
    const money =
      amount != null && pay.amount?.offset
        ? ` ${(Number(amount) / Number(pay.amount.offset)).toFixed(2)} ${pay.currencyCodeIso4217 ?? ''}`
        : ''
    const note = pay.noteMessage?.extendedTextMessage?.text ?? pay.noteMessage?.conversation ?? ''
    return text(`💰 Cobrança${money}${note ? `\n${note}` : ''}`)
  }
  const poll = msg.pollCreationMessage ?? msg.pollCreationMessageV2 ?? msg.pollCreationMessageV3
  if (poll) return text(pollText(poll))
  if (msg.groupInviteMessage)
    return text(`👥 Convite para grupo: ${msg.groupInviteMessage.groupName ?? ''}`.trim())
  if (msg.eventMessage) return text(`📅 Evento: ${msg.eventMessage.name ?? ''}`.trim())

  const firstKey = Object.keys(msg).find((k) => k !== 'messageContextInfo')
  return text(firstKey ? `[mensagem não suportada: ${firstKey}]` : null)
}
