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
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
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
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
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
  text: string
): Promise<SendResult> {
  return callApi<SendResult>('POST', `/message/sendText/${instanceName}`, {
    number: phone.replace(/^\+/, ''),
    text,
  })
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
  filename?: string
): Promise<SendResult> {
  return callApi<SendResult>('POST', `/message/sendMedia/${instanceName}`, {
    number: phone.replace(/^\+/, ''),
    mediatype,
    media: mediaUrl,
    caption,
    fileName: filename,
  })
}
