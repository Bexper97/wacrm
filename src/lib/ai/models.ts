/**
 * Lists the chat models a provider key can actually use, so the UI never depends on
 * a hard-coded model name that the provider has since retired.
 */

import { type AiProvider } from './types'
import { providerHttpError, toNetworkError } from './providers/shared'

const TIMEOUT_MS = 15_000

const OPENAI_EXCLUDE = /embed|tts|whisper|dall|image|audio|realtime|transcribe|moderation|search|computer|davinci|babbage|instruct/i

export async function listModels(provider: AiProvider, apiKey: string): Promise<string[]> {
  let res: Response
  try {
    if (provider === 'google') {
      res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
        headers: { 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } else if (provider === 'anthropic') {
      res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } else {
      res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    }
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) throw await providerHttpError(provider, res)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json().catch(() => null)) as any

  let ids: string[] = []
  if (provider === 'google') {
    ids = ((data?.models ?? []) as { name?: string; supportedGenerationMethods?: string[] }[])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => (m.name ?? '').replace(/^models\//, ''))
      .filter((id) => /^gemini/i.test(id) && !/embed|tts|image|live|audio|vision|learnlm/i.test(id))
  } else if (provider === 'anthropic') {
    ids = ((data?.data ?? []) as { id?: string }[]).map((m) => m.id ?? '')
  } else {
    ids = ((data?.data ?? []) as { id?: string }[])
      .map((m) => m.id ?? '')
      .filter((id) => /^(gpt|o\d)/i.test(id) && !OPENAI_EXCLUDE.test(id))
  }

  // Newest-looking names first.
  return [...new Set(ids.filter(Boolean))].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
}

/** Cheapest-looking model of the list for background work (alert analysis). */
export function pickEconomyModel(provider: AiProvider, models: string[]): string | null {
  const order: Record<AiProvider, RegExp[]> = {
    google: [/flash-lite/i, /lite/i, /flash/i],
    openai: [/nano/i, /mini/i],
    anthropic: [/haiku/i],
  }
  // Prefer a stable, versioned name: "-latest" aliases silently change model (and cost),
  // and preview/experimental ones can change or disappear.
  const UNSTABLE = /latest|preview|exp|thinking|customtools/i
  for (const re of order[provider]) {
    const hit =
      models.find((m) => re.test(m) && /\d/.test(m) && !UNSTABLE.test(m)) ??
      models.find((m) => re.test(m) && !/preview|exp|thinking/i.test(m)) ??
      models.find((m) => re.test(m))
    if (hit) return hit
  }
  return null
}
