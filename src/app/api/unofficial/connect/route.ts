/**
 * GET  /api/unofficial/connect  — connection status + QR code (when disconnected)
 * POST /api/unofficial/connect  — create the Evolution API instance (one-time setup)
 * DELETE /api/unofficial/connect — logout / disconnect
 *
 * Protected by session auth; caller must be logged in.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getConnectionState,
  getQrCode,
  createInstance,
  logoutInstance,
} from '@/lib/whatsapp/unofficial/evolution-api'

async function requireAuth() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

export async function GET() {
  if (!await requireAuth()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const state = await getConnectionState()
    const connected = state.instance?.state === 'open'

    if (connected) {
      return NextResponse.json({ connected: true, state: state.instance?.state })
    }

    // Not connected — try to get QR code so the UI can render it
    let qr: { base64?: string; code?: string } | null = null
    try {
      qr = await getQrCode()
    } catch {
      // Instance might not exist yet; caller should POST to /connect first
    }

    return NextResponse.json({ connected: false, state: state.instance?.state, qr })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ connected: false, error: message }, { status: 200 })
  }
}

export async function POST(request: Request) {
  if (!await requireAuth()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_URL ??
    'http://localhost:3000'

  const webhookUrl = `${appUrl}/api/unofficial/webhook`

  // Allow the caller to supply a custom webhook URL (e.g. via ngrok locally)
  let body: { webhookUrl?: string } = {}
  try {
    body = await request.json()
  } catch {
    // no body is fine
  }

  try {
    const result = await createInstance({ webhookUrl: body.webhookUrl ?? webhookUrl })
    return NextResponse.json({ success: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE() {
  if (!await requireAuth()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await logoutInstance()
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
