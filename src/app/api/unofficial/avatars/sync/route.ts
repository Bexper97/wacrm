/**
 * POST /api/unofficial/avatars/sync
 *
 * Fills in WhatsApp profile photos for contacts of unofficial numbers that
 * don't have one yet. Handles a small batch per call; the inbox calls it a
 * few times when it opens.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { refreshContactAvatar, wasAttemptedRecently } from '@/lib/whatsapp/unofficial/avatars'

const BATCH = 30
const CONCURRENCY = 5

export async function POST() {
  try {
    const { accountId } = await requireRole('agent')
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data, error } = await db
      .from('conversations')
      .select(
        'group_jid, contacts!inner(id, phone, avatar_url), unofficial_wa_instances!inner(instance_name)'
      )
      .eq('account_id', accountId)
      .is('contacts.avatar_url', null)
      .order('last_message_at', { ascending: false })
      .limit(200)

    if (error) {
      console.error('[unofficial/avatars/sync]', error.message)
      return NextResponse.json({ updated: 0, remaining: 0 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pending = ((data ?? []) as any[]).filter((row) => {
      const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
      return contact && !wasAttemptedRecently(contact.id)
    })
    const batch = pending.slice(0, BATCH)

    let updated = 0
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const results = await Promise.all(
        batch.slice(i, i + CONCURRENCY).map((row) => {
          const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
          const instance = Array.isArray(row.unofficial_wa_instances)
            ? row.unofficial_wa_instances[0]
            : row.unofficial_wa_instances
          return refreshContactAvatar({
            db,
            accountId,
            contactId: contact.id,
            instanceName: instance.instance_name,
            target: row.group_jid ?? String(contact.phone).replace(/\D/g, ''),
          })
        })
      )
      updated += results.filter(Boolean).length
    }

    return NextResponse.json({ updated, remaining: Math.max(pending.length - batch.length, 0) })
  } catch (err) {
    return toErrorResponse(err)
  }
}
