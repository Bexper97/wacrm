/**
 * POST /api/ai/models — admin: list the models a provider key can use.
 * Body: { provider, api_key? }  (when api_key is omitted the saved key is used)
 */

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAiConfig } from '@/lib/ai/config'
import { listModels, pickEconomyModel } from '@/lib/ai/models'
import { AiError, type AiProvider } from '@/lib/ai/types'

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as { provider?: string; api_key?: string } | null

    const provider = body?.provider as AiProvider | undefined
    if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'google') {
      return NextResponse.json({ error: 'provider inválido' }, { status: 400 })
    }

    let apiKey = body?.api_key?.trim() ?? ''
    if (!apiKey) {
      const cfg = await loadAiConfig(supabase, accountId, { requireActive: false })
      if (!cfg || cfg.provider !== provider) {
        return NextResponse.json({ error: 'Informe a chave de API deste provedor.' }, { status: 400 })
      }
      apiKey = cfg.apiKey
    }

    const models = await listModels(provider, apiKey)
    return NextResponse.json({ provider, models, economy: pickEconomyModel(provider, models) })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
