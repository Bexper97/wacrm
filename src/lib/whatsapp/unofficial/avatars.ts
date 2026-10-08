/**
 * Copies a WhatsApp profile picture into the CRM's own storage and points
 * `contacts.avatar_url` at it. WhatsApp's own picture links are signed and
 * expire, so hot-linking them would break within days.
 */

import { fetchProfilePictureUrl } from './evolution-api'
import { buildMediaPath, MEDIA_MAX_BYTES } from '@/lib/storage/upload-media'

const BUCKET = 'chat-media'
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000

// In-memory so we don't call Evolution for every message; resets on restart, which also refreshes old photos.
const attempted = new Map<string, number>()

export function wasAttemptedRecently(contactId: string): boolean {
  const at = attempted.get(contactId)
  return at !== undefined && Date.now() - at < RETRY_AFTER_MS
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Returns true when the contact's avatar was updated. Never throws. */
export async function refreshContactAvatar(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
  accountId: string
  contactId: string
  instanceName: string
  /** Phone (people) or group JID. */
  target: string
}): Promise<boolean> {
  const { db, accountId, contactId, instanceName, target } = args
  if (wasAttemptedRecently(contactId)) return false
  attempted.set(contactId, Date.now())

  try {
    const pictureUrl = await fetchProfilePictureUrl(instanceName, target)
    if (!pictureUrl) return false

    const res = await fetch(pictureUrl, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return false
    const mime = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim().toLowerCase()
    const ext = EXT_BY_MIME[mime]
    if (!ext) return false

    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.byteLength === 0 || buffer.byteLength > MEDIA_MAX_BYTES) return false

    const path = buildMediaPath(accountId, `${contactId}.${ext}`, null, 'avatars')
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, buffer, {
      contentType: mime,
      cacheControl: '3600',
      upsert: true,
    })
    if (upErr) {
      console.warn('[unofficial/avatars] upload failed:', upErr.message)
      return false
    }

    const { data } = db.storage.from(BUCKET).getPublicUrl(path)
    if (!data?.publicUrl) return false

    // Version the URL so browsers drop the cached older picture.
    const { error } = await db
      .from('contacts')
      .update({ avatar_url: `${data.publicUrl}?v=${Date.now()}` })
      .eq('id', contactId)
    if (error) {
      console.warn('[unofficial/avatars] contact update failed:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.warn('[unofficial/avatars] refresh failed:', err instanceof Error ? err.message : err)
    return false
  }
}
