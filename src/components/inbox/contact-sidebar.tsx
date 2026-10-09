"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { copyText } from "@/lib/clipboard";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { contactHandle } from "@/lib/whatsapp/wa-identity";

interface ContactSidebarProps {
  contact: Contact | null;
  /** Called with the saved contact so the inbox list / header stay in sync. */
  onContactUpdated?: (contact: Contact) => void;
}

type StageOption = { id: string; name: string; color: string; position: number };
type PipelineOption = { id: string; name: string; pipeline_stages: StageOption[] };
type DealRow = Deal & { stage?: { name: string; color: string } | null };

const TAG_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

/** "1.234,56" or "1234.56" → number; null when not a valid amount. */
function parseMoney(input: string): number | null {
  const s = input.trim().replace(/\s/g, "").replace(/^[^\d-]+/, "");
  if (!s) return 0;
  const normalised = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalised);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function formatMoney(value: number, currency?: string | null): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "BRL",
    }).format(value);
  } catch {
    return `${currency ?? ""}${value.toLocaleString()}`;
  }
}

const FIELD =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50";

export function ContactSidebar({ contact, onContactUpdated }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId, user } = useAuth();
  const userId = user?.id;

  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [currency, setCurrency] = useState("BRL");

  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");

  // Contact editing
  const [editingContact, setEditingContact] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", company: "" });
  const [savingContact, setSavingContact] = useState(false);

  // Tag picker
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  // Deal form: "new", a deal id, or null
  const [dealFormFor, setDealFormFor] = useState<string | "new" | null>(null);
  const [dealForm, setDealForm] = useState({ title: "", value: "", stageId: "" });
  const [savingDeal, setSavingDeal] = useState(false);

  const contactId = contact?.id;

  const fetchContactData = useCallback(async () => {
    if (!contactId) return;
    const supabase = createClient();

    const [dealsRes, notesRes, tagsRes, allTagsRes, pipelinesRes, acctRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false }),
      supabase.from("contact_tags").select("id, tag_id, tags(*)").eq("contact_id", contactId),
      supabase.from("tags").select("*").order("name"),
      supabase
        .from("pipelines")
        .select("id, name, pipeline_stages(id, name, color, position)")
        .order("created_at"),
      accountId
        ? supabase.from("accounts").select("default_currency").eq("id", accountId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data as DealRow[]);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      setTags(
        tagsRes.data
          .filter((ct: Record<string, unknown>) => ct.tags)
          .map((ct: Record<string, unknown>) => ({
            ...(ct.tags as Tag),
            contact_tag_id: ct.id as string,
          })),
      );
    }
    if (allTagsRes.data) setAllTags(allTagsRes.data as Tag[]);
    if (pipelinesRes.data) setPipelines(pipelinesRes.data as PipelineOption[]);
    const cur = (acctRes.data as { default_currency?: string } | null)?.default_currency;
    if (cur) setCurrency(cur);
  }, [contactId, accountId]);

  useEffect(() => {
    // Reset transient UI when switching contacts.
    setEditingContact(false);
    setTagPickerOpen(false);
    setDealFormFor(null);
    setEditingNoteId(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  // ---- phone / contact ---------------------------------------------------

  const handleCopyPhone = useCallback(async () => {
    const handle = contact ? contactHandle(contact) : "";
    if (!handle) return;
    const ok = await copyText(handle);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(tSidebar("copyFailed"));
    }
  }, [contact, tSidebar]);

  function startEditContact() {
    if (!contact) return;
    setForm({
      name: contact.name ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      company: contact.company ?? "",
    });
    setEditingContact(true);
  }

  async function saveContact() {
    if (!contact) return;
    const digits = form.phone.replace(/\D/g, "");
    if (contact.phone && digits.length < 8) {
      toast.error(tSidebar("phoneInvalid"));
      return;
    }
    setSavingContact(true);
    const patch = {
      name: form.name.trim() || null,
      email: form.email.trim() || null,
      company: form.company.trim() || null,
      ...(digits ? { phone: `+${digits}` } : {}),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await createClient()
      .from("contacts")
      .update(patch)
      .eq("id", contact.id)
      .select("*")
      .single();
    setSavingContact(false);

    if (error || !data) {
      toast.error(error?.code === "23505" ? tSidebar("phoneExists") : tSidebar("contactSaveFailed"));
      return;
    }
    setEditingContact(false);
    toast.success(tSidebar("contactSaved"));
    onContactUpdated?.({ ...contact, ...(data as Contact) });
  }

  // ---- tags ---------------------------------------------------------------

  async function toggleTag(tag: Tag) {
    if (!contact) return;
    const supabase = createClient();
    const existing = tags.find((t) => t.id === tag.id);
    if (existing) {
      const { error } = await supabase.from("contact_tags").delete().eq("id", existing.contact_tag_id);
      if (error) return void toast.error(tSidebar("tagFailed"));
      setTags((prev) => prev.filter((t) => t.id !== tag.id));
    } else {
      const { data, error } = await supabase
        .from("contact_tags")
        .insert({ contact_id: contact.id, tag_id: tag.id })
        .select("id")
        .single();
      if (error || !data) return void toast.error(tSidebar("tagFailed"));
      setTags((prev) => [...prev, { ...tag, contact_tag_id: data.id }]);
    }
  }

  async function createTag() {
    const name = newTagName.trim();
    if (!name || !accountId || !userId) return;
    const color = TAG_COLORS[allTags.length % TAG_COLORS.length];
    const { data, error } = await createClient()
      .from("tags")
      .insert({ name, color, account_id: accountId, user_id: userId })
      .select("*")
      .single();
    if (error || !data) return void toast.error(tSidebar("tagFailed"));
    setAllTags((prev) => [...prev, data as Tag]);
    setNewTagName("");
    await toggleTag(data as Tag);
  }

  // ---- deals --------------------------------------------------------------

  const allStages = pipelines.flatMap((p) =>
    [...p.pipeline_stages]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ ...s, pipelineId: p.id, pipelineName: p.name })),
  );

  function openNewDeal() {
    setDealForm({
      title: contact?.name || (contact ? contactHandle(contact) : ""),
      value: "",
      stageId: allStages[0]?.id ?? "",
    });
    setDealFormFor("new");
  }

  function openEditDeal(deal: DealRow) {
    setDealForm({
      title: deal.title,
      value: String(deal.value ?? 0).replace(".", ","),
      stageId: deal.stage_id,
    });
    setDealFormFor(deal.id);
  }

  async function saveDeal() {
    if (!contact || !accountId || !userId || !dealFormFor) return;
    const stage = allStages.find((s) => s.id === dealForm.stageId);
    const value = parseMoney(dealForm.value);
    if (!stage || !dealForm.title.trim() || value === null) {
      toast.error(tSidebar("dealFailed"));
      return;
    }
    setSavingDeal(true);
    const supabase = createClient();
    const fields = {
      title: dealForm.title.trim(),
      value,
      stage_id: stage.id,
      pipeline_id: stage.pipelineId,
    };
    const result =
      dealFormFor === "new"
        ? await supabase.from("deals").insert({
            ...fields,
            account_id: accountId,
            user_id: userId,
            contact_id: contact.id,
            currency,
            status: "open",
          })
        : await supabase
            .from("deals")
            .update({ ...fields, updated_at: new Date().toISOString() })
            .eq("id", dealFormFor);
    setSavingDeal(false);
    if (result.error) {
      console.error("deal save failed:", result.error);
      return void toast.error(tSidebar("dealFailed"));
    }
    setDealFormFor(null);
    await fetchContactData();
  }

  async function deleteDeal(deal: DealRow) {
    if (!window.confirm(tSidebar("confirmDeleteDeal"))) return;
    const { error } = await createClient().from("deals").delete().eq("id", deal.id);
    if (error) return void toast.error(tSidebar("dealFailed"));
    setDeals((prev) => prev.filter((d) => d.id !== deal.id));
  }

  // ---- notes --------------------------------------------------------------

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim() || !accountId) return;
    setAddingNote(true);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: session?.user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  async function saveNoteEdit(note: ContactNote) {
    const text = editingNoteText.trim();
    if (!text) return;
    const { error } = await createClient()
      .from("contact_notes")
      .update({ note_text: text })
      .eq("id", note.id);
    if (error) return void toast.error(tSidebar("noteFailed"));
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, note_text: text } : n)));
    setEditingNoteId(null);
  }

  async function deleteNote(note: ContactNote) {
    if (!window.confirm(tSidebar("confirmDeleteNote"))) return;
    const { error } = await createClient().from("contact_notes").delete().eq("id", note.id);
    if (error) return void toast.error(tSidebar("noteFailed"));
    setNotes((prev) => prev.filter((n) => n.id !== note.id));
  }

  // ---- render ---------------------------------------------------------------

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contactHandle(contact);
  const initials = displayName.charAt(0).toUpperCase();
  const iconBtn =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground";

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            {!editingContact && (
              <>
                <h3 className="mt-3 text-sm font-semibold text-foreground">{displayName}</h3>
                {contact.company && (
                  <p className="text-xs text-muted-foreground">{contact.company}</p>
                )}
              </>
            )}
          </div>

          {editingContact ? (
            <div className="mt-4 space-y-2">
              <input
                className={FIELD}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={tSidebar("namePh")}
              />
              <input
                className={FIELD}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder={tSidebar("phonePh")}
                inputMode="tel"
              />
              <input
                className={FIELD}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder={tSidebar("emailPh")}
                type="email"
              />
              <input
                className={FIELD}
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                placeholder={tSidebar("companyPh")}
              />
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setEditingContact(false)}>
                  {tSidebar("cancel")}
                </Button>
                <Button size="sm" onClick={saveContact} disabled={savingContact}>
                  {tSidebar("save")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-1">
              <div className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-muted-foreground">
                <Phone className="h-4 w-4 shrink-0" />
                <span className="flex-1 select-text break-all pl-1 text-left">
                  {contactHandle(contact)}
                </span>
                <button
                  type="button"
                  onClick={handleCopyPhone}
                  className={iconBtn}
                  title={tSidebar("copyPhone")}
                  aria-label={tSidebar("copyPhone")}
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={startEditContact}
                  className={iconBtn}
                  title={tSidebar("edit")}
                  aria-label={tSidebar("edit")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>

              {contact.email && (
                <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4 shrink-0" />
                  <span className="select-text truncate">{contact.email}</span>
                </div>
              )}
            </div>
          )}

          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <TagIcon className="h-3 w-3" />
                {tSidebar("tags")}
              </div>
              <button
                type="button"
                onClick={() => setTagPickerOpen((v) => !v)}
                className={iconBtn}
                title={tSidebar("addTag")}
                aria-label={tSidebar("addTag")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                  >
                    {tag.name}
                    <button
                      type="button"
                      onClick={() => toggleTag(tag)}
                      aria-label={tSidebar("remove")}
                      className="opacity-60 hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
            {tagPickerOpen && (
              <div className="mt-2 space-y-1 rounded-lg border border-border bg-muted p-2">
                <div className="max-h-36 space-y-0.5 overflow-y-auto">
                  {allTags.map((tag) => {
                    const on = tags.some((t) => t.id === tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-background"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="flex-1 truncate text-foreground">{tag.name}</span>
                        {on && <Check className="h-3 w-3 text-primary" />}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-1 pt-1">
                  <input
                    className={FIELD}
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createTag()}
                    placeholder={tSidebar("newTagPh")}
                  />
                  <Button size="sm" onClick={createTag} disabled={!newTagName.trim()}>
                    {tSidebar("createTag")}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="my-4 border-t border-border" />

          {/* Deals */}
          <div>
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <DollarSign className="h-3 w-3" />
                {tSidebar("deals")}
              </div>
              <button
                type="button"
                onClick={openNewDeal}
                className={iconBtn}
                title={tSidebar("addDeal")}
                aria-label={tSidebar("addDeal")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {dealFormFor && (
              <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted p-2">
                {allStages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{tSidebar("noStages")}</p>
                ) : (
                  <>
                    <input
                      className={FIELD}
                      value={dealForm.title}
                      onChange={(e) => setDealForm({ ...dealForm, title: e.target.value })}
                      placeholder={tSidebar("dealTitlePh")}
                    />
                    <input
                      className={FIELD}
                      value={dealForm.value}
                      onChange={(e) => setDealForm({ ...dealForm, value: e.target.value })}
                      placeholder={tSidebar("dealValuePh")}
                      inputMode="decimal"
                    />
                    <select
                      className={FIELD}
                      value={dealForm.stageId}
                      onChange={(e) => setDealForm({ ...dealForm, stageId: e.target.value })}
                    >
                      {pipelines.map((p) => (
                        <optgroup key={p.id} label={p.name}>
                          {[...p.pipeline_stages]
                            .sort((a, b) => a.position - b.position)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDealFormFor(null)}>
                        {tSidebar("cancel")}
                      </Button>
                      <Button size="sm" onClick={saveDeal} disabled={savingDeal}>
                        {tSidebar("save")}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="mt-2 space-y-2">
              {deals.length === 0 && !dealFormFor ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div key={deal.id} className="rounded-lg bg-muted px-3 py-2">
                    <div className="flex items-start gap-1">
                      <p className="flex-1 text-sm font-medium text-foreground">{deal.title}</p>
                      <button
                        type="button"
                        onClick={() => openEditDeal(deal)}
                        className={iconBtn}
                        title={tSidebar("edit")}
                        aria-label={tSidebar("edit")}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteDeal(deal)}
                        className={iconBtn}
                        title={tSidebar("remove")}
                        aria-label={tSidebar("remove")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{formatMoney(Number(deal.value ?? 0), deal.currency)}</span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div key={note.id} className="rounded-lg bg-muted px-3 py-2">
                    {editingNoteId === note.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editingNoteText}
                          onChange={(e) => setEditingNoteText(e.target.value)}
                          rows={3}
                          autoFocus
                          className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditingNoteId(null)}>
                            {tSidebar("cancel")}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => saveNoteEdit(note)}
                            disabled={!editingNoteText.trim()}
                          >
                            {tSidebar("save")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                          {note.note_text}
                        </p>
                        <div className="mt-1 flex items-center justify-between">
                          <p className="text-[10px] text-muted-foreground">
                            {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                          </p>
                          <div className="flex gap-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNoteId(note.id);
                                setEditingNoteText(note.note_text);
                              }}
                              className={iconBtn}
                              title={tSidebar("edit")}
                              aria-label={tSidebar("edit")}
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteNote(note)}
                              className={iconBtn}
                              title={tSidebar("remove")}
                              aria-label={tSidebar("remove")}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
