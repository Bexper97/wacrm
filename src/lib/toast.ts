/**
 * Drop-in replacement for `toast` from "sonner" that shows server error messages in
 * Brazilian Portuguese. Many API routes answer in English; translating at display time
 * keeps the routes (and their tests / public API) untouched. Only active when the page
 * language is Portuguese (<html lang="pt…">); other languages pass through unchanged.
 */

import { toast as base } from "sonner";

// Longest first, so a specific sentence wins over a shorter fragment inside it.
const PT: [string, string][] = [
  ["Stored API key could not be decrypted — re-enter your key.", "Não foi possível descriptografar a chave salva — informe a chave novamente."],
  ["No agent configured yet. Add your provider key in Setup.", "Nenhum agente configurado. Cadastre a chave do provedor em Configuração."],
  ["Cannot react to a message that has not been sent to WhatsApp", "Não é possível reagir a uma mensagem que ainda não foi enviada ao WhatsApp"],
  ["Contact has no phone number or WhatsApp user ID", "O contato não tem telefone nem ID do WhatsApp"],
  ["WhatsApp not configured — cannot delete on Meta.", "WhatsApp não configurado — não é possível excluir na Meta."],
  ["Could not validate the API key with the provider.", "Não foi possível validar a chave de API com o provedor."],
  ["Reaction sent to Meta but DB upsert failed", "Reação enviada, mas não foi salva no CRM"],
  ["Reaction sent to Meta but DB delete failed", "Reação enviada, mas não foi removida no CRM"],
  ["Your profile is not linked to an account.", "Seu perfil não está vinculado a uma conta."],
  ["Send a message to test the agent.", "Envie uma mensagem para testar o agente."],
  ["No messages to draft from yet.", "Ainda não há mensagens para gerar um rascunho."],
  ["Failed to save AI configuration", "Não foi possível salvar a configuração de IA"],
  ["Message sent but failed to save", "Mensagem enviada, mas não foi possível salvá-la"],
  ["Contact has no phone number", "O contato não tem número de telefone"],
  ["PIN must be exactly 6 digits.", "O PIN deve ter exatamente 6 dígitos."],
  ["Failed to load conversation", "Não foi possível carregar a conversa"],
  ["WhatsApp not configured.", "WhatsApp não configurado."],
  ["WhatsApp not configured", "WhatsApp não configurado"],
  ["User is not in this account", "Este usuário não pertence a esta conta"],
  ["Internal server error", "Erro interno do servidor"],
  ["Failed to save instance", "Não foi possível salvar o número"],
  ["Conversation not found", "Conversa não encontrada"],
  ["Invalid template id.", "ID de modelo inválido."],
  ["Template not found.", "Modelo não encontrado."],
  ["Message not found", "Mensagem não encontrada"],
  ["Instance not found", "Número não encontrado"],
  ["Invalid request body", "Dados inválidos enviados."],
  ["Invalid JSON body.", "Dados inválidos enviados."],
  ["Invalid JSON", "Dados inválidos enviados."],
  ["Meta API error: ", "Erro da API da Meta: "],
  ["Evolution API error", "Erro da Evolution API"],
  ["Nothing to update", "Nada para atualizar"],
  ["Update failed", "Falha ao atualizar"],
  ["Unauthorized", "Sessão expirada ou sem permissão. Entre novamente."],
  ["Forbidden", "Você não tem permissão para fazer isso."],
  ["Not found", "Não encontrado"],
  ["network error", "erro de rede"],
];

function isPortuguese(): boolean {
  return typeof document !== "undefined" && document.documentElement.lang.toLowerCase().startsWith("pt");
}

export function translateApiError(message: string): string {
  if (!isPortuguese()) return message;
  let out = message;
  for (const [en, pt] of PT) {
    if (out.includes(en)) out = out.split(en).join(pt);
  }
  return out;
}

type Msg = Parameters<typeof base>[0];
const tr = (m: Msg): Msg => (typeof m === "string" ? translateApiError(m) : m);

export const toast = Object.assign(
  (m: Msg, ...rest: unknown[]) => (base as (...a: unknown[]) => unknown)(tr(m), ...rest),
  {
    success: (m: Msg, ...rest: unknown[]) => (base.success as (...a: unknown[]) => unknown)(tr(m), ...rest),
    error: (m: Msg, ...rest: unknown[]) => (base.error as (...a: unknown[]) => unknown)(tr(m), ...rest),
    info: (m: Msg, ...rest: unknown[]) => (base.info as (...a: unknown[]) => unknown)(tr(m), ...rest),
    warning: (m: Msg, ...rest: unknown[]) => (base.warning as (...a: unknown[]) => unknown)(tr(m), ...rest),
    message: (m: Msg, ...rest: unknown[]) => (base.message as (...a: unknown[]) => unknown)(tr(m), ...rest),
    loading: (m: Msg, ...rest: unknown[]) => (base.loading as (...a: unknown[]) => unknown)(tr(m), ...rest),
    dismiss: base.dismiss,
    promise: base.promise,
  },
);
