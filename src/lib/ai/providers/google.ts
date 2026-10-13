import { AiError, type ChatMessage, type ProviderResult } from '../types'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Gemini 2.5 models "think" before answering and those tokens count against the
// output limit, so leave more room than the other providers need.
const GEMINI_MAX_OUTPUT_TOKENS = 4096

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  promptFeedback?: { blockReason?: string }
}

/** Gemini wants roles "user" / "model" and a conversation that starts with the user. */
function toGeminiContents(messages: ChatMessage[]) {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') merged.shift()
  if (merged.length === 0) {
    merged.push({ role: 'user', content: '(The customer has not sent a message yet.)' })
  }
  return merged.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
}

/**
 * Call Google's Gemini `generateContent` endpoint with the caller's own key.
 * Returns the raw text + token usage (handoff parsing happens in `generateReply`).
 */
export async function generateGoogle(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  // Only Gemini 2.5 Flash (non-lite) accepts "thinking off" via thinkingBudget: 0. The 3.x
  // models use a different control and reject this field with HTTP 400, and Pro models
  // cannot disable thinking, so it is sent only where it is known to work.
  const canDisableThinking = /gemini-2\.5-flash(?!-lite)/i.test(model)

  const call = async (withThinkingOff: boolean, bare = false): Promise<Response> => {
    // `bare` sends no generationConfig at all — the safest request any Gemini model accepts.
    const generationConfig: Record<string, unknown> = bare
      ? {}
      : { maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS }
    if (withThinkingOff && !bare) generationConfig.thinkingConfig = { thinkingBudget: 0 }
    return fetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: toGeminiContents(messages),
        generationConfig,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  let res: Response
  try {
    res = await call(canDisableThinking)
    // A 400 usually means the model rejected an optional field: retry once with the bare request.
    if (res.status === 400) res = await call(false, true)
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Google Gemini', res)
  }

  const data = (await res.json().catch(() => null)) as GeminiResponse | null
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')
    .trim()
  if (!text) {
    const blocked = data?.promptFeedback?.blockReason
    throw new AiError(
      blocked
        ? `Google Gemini blocked the request (${blocked}).`
        : 'Google Gemini returned an empty response.',
      { code: 'empty_response' },
    )
  }

  const usage = normalizeUsage({
    prompt: data?.usageMetadata?.promptTokenCount,
    completion: data?.usageMetadata?.candidatesTokenCount,
    total: data?.usageMetadata?.totalTokenCount,
  })
  return { text, usage }
}
