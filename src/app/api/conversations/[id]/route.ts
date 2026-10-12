/**
 * DELETE /api/conversations/[id]
 *
 * Removes a whole conversation card (and, by cascade, its messages and
 * reactions). Deals linked to it are kept — they just lose the link, because
 * `deals.conversation_id` has no ON DELETE action and would block the delete.
 * Admin and above only: the inbox is the account's message record.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

interface Params { params: Promise<{ id: string }> }

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params
    const { accountId } = await requireRole('admin')

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: conv } = await db
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

    const { error: dealsErr } = await db
      .from('deals')
      .update({ conversation_id: null })
      .eq('conversation_id', id)
    if (dealsErr) {
      console.error('[conversations DELETE] unlink deals failed:', dealsErr.message)
      return NextResponse.json({ error: 'Could not detach linked deals' }, { status: 500 })
    }

    const { error } = await db
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) {
      console.error('[conversations DELETE] delete failed:', error.message)
      return NextResponse.json({ error: 'Could not delete the conversation' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
