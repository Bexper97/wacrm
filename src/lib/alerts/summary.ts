/**
 * WhatsApp summary of the open alerts, sent to the admin's phone through one of
 * the account's connected (unofficial) numbers. Sent at most once per business
 * day, after the configured hour.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendText } from '@/lib/whatsapp/unofficial/evolution-api'
import { localParts } from './business-hours'
import type { AlertSettings } from './scan'

const CATEGORY_LABEL: Record<string, string> = {
  personal_contact: 'contato pessoal',
  off_platform_payment: 'pagamento por fora',
  unauthorized_promise: 'promessa/desconto não autorizado',
  aggressive_tone: 'tom agressivo',
  complaint: 'reclamação/ameaça',
  off_topic: 'assunto fora do trabalho',
}

interface OpenAlert {
  id: string
  kind: 'unanswered' | 'suspicious'
  category: string | null
  severity: 'low' | 'medium' | 'high'
  reason: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conversations: any
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

export async function buildSummaryText(db: SupabaseClient, accountId: string, now: Date = new Date()): Promise<string> {
  const { data } = await db
    .from('conversation_alerts')
    .select('id, kind, category, severity, reason, conversations(assigned_agent_id, contact:contacts(name, phone))')
    .eq('account_id', accountId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(300)
  const alerts = (data ?? []) as OpenAlert[]

  const { data: profiles } = await db.from('profiles').select('user_id, full_name').eq('account_id', accountId)
  const names = new Map<string, string>()
  for (const p of profiles ?? []) names.set(p.user_id, p.full_name || 'Sem nome')

  const unanswered = alerts.filter((a) => a.kind === 'unanswered')
  const suspicious = alerts.filter((a) => a.kind === 'suspicious')
  const serious = suspicious.filter((a) => a.severity === 'high')

  const perAgent = new Map<string, { unanswered: number; suspicious: number }>()
  for (const a of alerts) {
    const conv = one(a.conversations)
    const agent = conv?.assigned_agent_id ? (names.get(conv.assigned_agent_id) ?? 'Sem nome') : 'Sem responsável'
    const row = perAgent.get(agent) ?? { unanswered: 0, suspicious: 0 }
    if (a.kind === 'unanswered') row.unanswered++
    else row.suspicious++
    perAgent.set(agent, row)
  }

  const p = localParts(now)
  const date = `${String(p.day).padStart(2, '0')}/${String(p.month + 1).padStart(2, '0')}`
  const lines: string[] = [`*BEX — Resumo de alertas* (${date})`, '']

  if (alerts.length === 0) {
    lines.push('Nenhum alerta em aberto. Tudo em dia.')
  } else {
    lines.push(`Sem resposta: *${unanswered.length}*`)
    lines.push(`Suspeitas: *${suspicious.length}*${serious.length ? ` (${serious.length} grave${serious.length > 1 ? 's' : ''})` : ''}`)

    if (perAgent.size > 0) {
      lines.push('', '*Por consultor*')
      for (const [agent, c] of [...perAgent].sort((a, b) => b[1].unanswered + b[1].suspicious - (a[1].unanswered + a[1].suspicious)).slice(0, 8)) {
        lines.push(`• ${agent}: ${c.unanswered} sem resposta, ${c.suspicious} suspeita${c.suspicious === 1 ? '' : 's'}`)
      }
    }

    const top = [...suspicious].sort((a, b) => (a.severity === 'high' ? -1 : 0) - (b.severity === 'high' ? -1 : 0)).slice(0, 5)
    if (top.length > 0) {
      lines.push('', '*Mais importantes*')
      top.forEach((a, i) => {
        const conv = one(a.conversations)
        const contact = one(conv?.contact) as { name?: string | null; phone?: string } | null
        const who = contact?.name || contact?.phone || 'Contato'
        lines.push(`${i + 1}. ${who} — ${CATEGORY_LABEL[a.category ?? ''] ?? 'suspeita'}: ${a.reason}`)
      })
    }
  }

  const base = process.env.NEXT_PUBLIC_APP_URL
  if (base) lines.push('', `Abrir no BEX: ${base}/alerts`)
  return lines.join('\n')
}

/** Sends the summary when it is due (or when `force` is set). Returns what happened. */
export async function sendSummaryIfDue(
  db: SupabaseClient,
  accountId: string,
  settings: AlertSettings,
  opts: { force?: boolean; now?: Date } = {},
): Promise<{ sent: boolean; reason?: string }> {
  const now = opts.now ?? new Date()
  if (!opts.force && !settings.summary_enabled) return { sent: false, reason: 'disabled' }
  if (!settings.summary_phone) return { sent: false, reason: 'no_phone' }
  if (!settings.summary_instance_id) return { sent: false, reason: 'no_instance' }

  const p = localParts(now)
  if (!opts.force) {
    if (p.weekday < 1 || p.weekday > 5) return { sent: false, reason: 'weekend' }
    if (p.hour < settings.summary_hour) return { sent: false, reason: 'too_early' }
    if (settings.last_summary_on === p.dateKey) return { sent: false, reason: 'already_sent' }
  }

  const { data: instance } = await db
    .from('unofficial_wa_instances')
    .select('instance_name, status')
    .eq('id', settings.summary_instance_id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!instance) return { sent: false, reason: 'instance_missing' }

  try {
    await sendText(instance.instance_name, settings.summary_phone, await buildSummaryText(db, accountId, now))
  } catch (err) {
    console.error('[alerts] summary send failed:', err instanceof Error ? err.message : err)
    return { sent: false, reason: err instanceof Error ? err.message : 'send_failed' }
  }

  if (!opts.force) {
    await db.from('alert_settings').update({ last_summary_on: p.dateKey }).eq('account_id', accountId)
  }
  return { sent: true }
}
