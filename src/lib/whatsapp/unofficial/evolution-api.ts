/**
 * Evolution API client — unofficial WhatsApp via Baileys.
 *
 * The API URL and key come from env vars; the instance name is passed
 * per-call so the same client supports multiple numbers.
 *
 *   UNOFFICIAL_WA_API_URL  e.g. http://143.244.200.10:8080
 *   UNOFFICIAL_WA_API_KEY  your Evolution API key
 */

function baseConfig() {
  const url = process.env.UNOFFICIAL_WA_API_URL
  const key = process.env.UNOFFICIAL_WA_API_KEY
  if (!url || !key) {
    throw new Error(
      'Missing env vars: UNOFFICIAL_WA_API_URL and UNOFFICIAL_WA_API_KEY must be set'
    )
  }
  return { url, key }
}

function headers(key: string) {
  return { 'Content-Type': 'application/json', apikey: key }
}

async function callApi<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const { url, key } = baseConfig()
  const res = await fetch(`${url}${path}`, {
    method,
    headers: headers(key),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const nested = (errBody.response as Record<string, unknown> | undefined)?.message
    const raw = nested ?? errBody.message ?? errBody.error ?? `HTTP ${res.status}`
    const msg = typeof raw === 'string' ? raw : JSON.stringify(raw)
    throw new Error(`[evolution-api] ${method} ${path} → ${msg}`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Instance management
// ---------------------------------------------------------------------------

export interface ConnectionState {
  instance: { instanceName: string; state: 'open' | 'close' | 'connecting' }
}

export async function getConnectionState(instanceName: string): Promise<ConnectionState> {
  return callApi<ConnectionState>('GET', `/instance/connectionState/${instanceName}`)
}

export interface QrCodeResult {
  /** base64-encoded PNG: "data:image/png;base64,..." */
  base64?: string
  code?: string
  count?: number
}

export async function getQrCode(instanceName: string): Promise<QrCodeResult> {
  return callApi<QrCodeResult>('GET', `/instance/connect/${instanceName}`)
}

export interface CreateInstanceOptions {
  instanceName: string
  /** Full HTTPS URL of your webhook endpoint */
  webhookUrl: string
}

export async function createInstance(opts: CreateInstanceOptions): Promise<unknown> {
  return callApi('POST', '/instance/create', {
    instanceName: opts.instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    webhook: {
      enabled: true,
      url: opts.webhookUrl,
      byEvents: false,
      base64: false,
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'CONNECTION_UPDATE'],
    },
  })
}

export async function setWebhook(instanceName: string, webhookUrl: string): Promise<unknown> {
  return callApi('POST', `/webhook/set/${instanceName}`, {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: false,
      base64: false,
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'CONNECTION_UPDATE'],
    },
  })
}

export interface MediaBase64Result {
  base64?: string
  mimetype?: string
  fileName?: string
}

/** Asks Evolution to decrypt a received media message and return it as base64. */
export async function getMediaBase64(
  instanceName: string,
  messageId: string
): Promise<MediaBase64Result> {
  return callApi<MediaBase64Result>('POST', `/chat/getBase64FromMediaMessage/${instanceName}`, {
    message: { key: { id: messageId } },
    convertToMp4: false,
  })
}

export async function logoutInstance(instanceName: string): Promise<unknown> {
  return callApi('DELETE', `/instance/logout/${instanceName}`)
}

export async function deleteInstance(instanceName: string): Promise<unknown> {
  return callApi('DELETE', `/instance/delete/${instanceName}`)
}

// ---------------------------------------------------------------------------
// Sending messages
// ---------------------------------------------------------------------------

export interface SendResult {
  key: { id: string; remoteJid: string; fromMe: boolean }
  status: string
}

/**
 * Send a plain text message.
 * @param instanceName  Evolution API instance (= one WhatsApp number)
 * @param phone         E.164 phone number, e.g. "+5511999990000"
 */
export async function sendText(
  instanceName: string,
  phone: string,
  text: string,
  quoted?: QuotedRef
): Promise<SendResult> {
  return callApi<SendResult>('POST', `/message/sendText/${instanceName}`, {
    number: toNumber(phone),
    text,
    ...(quoted ? { quoted: buildQuoted(quoted) } : {}),
  })
}

/** Recipient as Evolution expects it: plain digits for people, the full JID for groups. */
export function toNumber(phoneOrJid: string): string {
  return phoneOrJid.includes('@') ? phoneOrJid : phoneOrJid.replace(/^\+/, '')
}

/** The message being replied to. */
export interface QuotedRef {
  id: string
  remoteJid: string
  fromMe: boolean
  participant?: string | null
  text?: string | null
}

function buildQuoted(q: QuotedRef) {
  return {
    key: {
      id: q.id,
      remoteJid: q.remoteJid,
      fromMe: q.fromMe,
      ...(q.participant ? { participant: q.participant } : {}),
    },
    message: { conversation: q.text ?? '' },
  }
}

/** React to a message. Empty `reaction` removes the reaction. */
export async function sendReaction(
  instanceName: string,
  key: { remoteJid: string; fromMe: boolean; id: string; participant?: string },
  reaction: string
): Promise<unknown> {
  return callApi('POST', `/message/sendReaction/${instanceName}`, { key, reaction })
}

export type MediaType = 'image' | 'video' | 'audio' | 'document'

/**
 * Send a media message (image / video / audio / document).
 */
export async function sendMedia(
  instanceName: string,
  phone: string,
  mediaUrl: string,
  mediatype: MediaType,
  caption?: string,
  filename?: string,
  quoted?: QuotedRef
): Promise<SendResult> {
  return callApi<SendResult>('POST', `/message/sendMedia/${instanceName}`, {
    number: toNumber(phone),
    mediatype,
    media: mediaUrl,
    caption,
    fileName: filename,
    ...(quoted ? { quoted: buildQuoted(quoted) } : {}),
  })
}

/** Voice note (push-to-talk) — shows up as a playable voice message, not a file. */
export async function sendVoice(
  instanceName: string,
  phone: string,
  audioUrl: string,
  quoted?: QuotedRef
): Promise<SendResult> {
  return callApi<SendResult>('POST', `/message/sendWhatsAppAudio/${instanceName}`, {
    number: toNumber(phone),
    audio: audioUrl,
    ...(quoted ? { quoted: buildQuoted(quoted) } : {}),
  })
}

export async function sendSticker(
  instanceName: string,
  phone: string,
  stickerUrl: string,
  quoted?: QuotedRef
): Promise<SendResult> {
  return callApi<SendResult>('POST', `/message/sendSticker/${instanceName}`, {
    number: toNumber(phone),
    sticker: stickerUrl,
    ...(quoted ? { quoted: buildQuoted(quoted) } : {}),
  })
}

export async function sendPoll(
  instanceName: string,
  phone: string,
  name: string,
  values: string[],
  selectableCount = 1
): Promise<SendResult> {
  return callApi<SendResult>('POST', `/message/sendPoll/${instanceName}`, {
    number: toNumber(phone),
    name,
    selectableCount,
    values,
  })
}

export async function sendContact(
  instanceName: string,
  phone: string,
  contact: { fullName: string; phoneNumber: string }
): Promise<SendResult> {
  const digits = contact.phoneNumber.replace(/\D/g, '')
  return callApi<SendResult>('POST', `/message/sendContact/${instanceName}`, {
    number: toNumber(phone),
    contact: [{ fullName: contact.fullName, wuid: digits, phoneNumber: `+${digits}` }],
  })
}

export async function sendButtons(
  instanceName: string,
  phone: string,
  payload: {
    title: string
    description: string
    footer?: string
    buttons: { id: string; title: string }[]
  }
): Promise<SendResult> {
  return callApi<SendResult>('POST', `/message/sendButtons/${instanceName}`, {
    number: toNumber(phone),
    title: payload.title,
    description: payload.description,
    footer: payload.footer ?? '',
    buttons: payload.buttons.map((b) => ({ type: 'reply', displayText: b.title, id: b.id })),
  })
}

export async function sendList(
  instanceName: string,
  phone: string,
  payload: {
    title: string
    description: string
    footer?: string
    buttonText: string
    sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[]
  }
): Promise<SendResult> {
  return callApi<SendResult>('POST', `/message/sendList/${instanceName}`, {
    number: toNumber(phone),
    title: payload.title,
    description: payload.description,
    footerText: payload.footer ?? '',
    buttonText: payload.buttonText,
    values: payload.sections.map((s) => ({
      title: s.title ?? '',
      rows: s.rows.map((r) => ({
        title: r.title,
        description: r.description ?? '',
        rowId: r.id,
      })),
    })),
  })
}

export interface GroupInfo {
  subject?: string
  pictureUrl?: string | null
}

/** Group subject (name). Returns null when Evolution can't resolve it. */
export async function getGroupInfo(
  instanceName: string,
  groupJid: string
): Promise<GroupInfo | null> {
  try {
    return await callApi<GroupInfo>(
      'GET',
      `/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`
    )
  } catch {
    return null
  }
}
