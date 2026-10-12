"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, FileText, Image as ImageIcon, Link2, Play } from "lucide-react";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MediaRow {
  id: string;
  content_type: string;
  content_text: string | null;
  media_url: string | null;
  created_at: string;
}

interface LinkItem {
  key: string;
  url: string;
  createdAt: string;
}

type Tab = "media" | "docs" | "links";

const URL_RE = /https?:\/\/[^\s<>"']+/g;

function extractLinks(rows: MediaRow[]): LinkItem[] {
  const seen = new Set<string>();
  const out: LinkItem[] = [];
  for (const r of rows) {
    if (r.content_type === "location") continue;
    for (const match of r.content_text?.match(URL_RE) ?? []) {
      const url = match.replace(/[.,;:!?)\]]+$/, "");
      const key = `${r.id}:${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, url, createdAt: r.created_at });
    }
  }
  return out;
}

function docName(row: MediaRow): string {
  if (row.content_text?.trim()) return row.content_text.trim();
  try {
    const path = new URL(row.media_url ?? "").pathname.split("/").pop() ?? "";
    return decodeURIComponent(path) || "documento";
  } catch {
    return "documento";
  }
}

/**
 * Collapsible "Mídias" block for the contact sidebar: counts of photos/videos,
 * documents and links received in this conversation, each opening a gallery.
 */
export function ConversationMedia({
  conversationId,
  refreshKey,
}: {
  conversationId: string | null | undefined;
  /** Changes whenever the thread gets a new message, so the counts stay current. */
  refreshKey?: number;
}) {
  const t = useTranslations("Inbox.sidebar");
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from("messages")
        .select("id, content_type, content_text, media_url, created_at")
        .eq("conversation_id", conversationId)
        .or("content_type.in.(image,video,document),content_text.ilike.*http*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (!cancelled) setRows((data as MediaRow[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, refreshKey]);

  const media = useMemo(
    () => rows.filter((r) => (r.content_type === "image" || r.content_type === "video") && r.media_url),
    [rows],
  );
  const docs = useMemo(
    () => rows.filter((r) => r.content_type === "document" && r.media_url),
    [rows],
  );
  const links = useMemo(() => extractLinks(rows), [rows]);
  const total = media.length + docs.length + links.length;

  if (!conversationId) return null;

  const tiles: { id: Tab; label: string; count: number; icon: typeof Play }[] = [
    { id: "media", label: t("tileMedia"), count: media.length, icon: Play },
    { id: "docs", label: t("tileDocs"), count: docs.length, icon: FileText },
    { id: "links", label: t("tileLinks"), count: links.length, icon: Link2 },
  ];

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-1 text-left"
        aria-expanded={open}
      >
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <ImageIcon className="h-3 w-3" />
            {t("mediaSection")}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("mediaCount", { count: total })}</p>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {tiles.map((tile) => (
            <button
              key={tile.id}
              type="button"
              onClick={() => setTab(tile.id)}
              className="relative flex flex-col items-center gap-1.5 rounded-xl border border-border bg-muted/50 px-1 py-3 text-xs text-foreground transition-colors hover:bg-muted"
            >
              {tile.count > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                  {tile.count}
                </span>
              )}
              <tile.icon className="h-5 w-5 text-muted-foreground" />
              {tile.label}
            </button>
          ))}
        </div>
      )}

      <Dialog open={tab !== null} onOpenChange={(v) => !v && setTab(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {tab === "media" ? t("tileMedia") : tab === "docs" ? t("tileDocs") : t("tileLinks")}
            </DialogTitle>
          </DialogHeader>

          {tab === "media" &&
            (media.length === 0 ? (
              <Empty text={t("mediaEmpty")} />
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {media.map((m) =>
                  m.content_type === "video" ? (
                    <video
                      key={m.id}
                      src={m.media_url!}
                      controls
                      preload="metadata"
                      className="aspect-square w-full rounded-lg bg-black object-cover"
                    />
                  ) : (
                    <a
                      key={m.id}
                      href={m.media_url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-lg bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.media_url!}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                    </a>
                  ),
                )}
              </div>
            ))}

          {tab === "docs" &&
            (docs.length === 0 ? (
              <Empty text={t("mediaEmpty")} />
            ) : (
              <ul className="space-y-1.5">
                {docs.map((d) => (
                  <li key={d.id}>
                    <a
                      href={d.media_url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-2 hover:bg-muted"
                    >
                      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{docName(d)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {format(new Date(d.created_at), "dd/MM/yyyy HH:mm")}
                        </span>
                      </span>
                      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </a>
                  </li>
                ))}
              </ul>
            ))}

          {tab === "links" &&
            (links.length === 0 ? (
              <Empty text={t("mediaEmpty")} />
            ) : (
              <ul className="space-y-1.5">
                {links.map((l) => (
                  <li key={l.key}>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t("openLink")}
                      className="flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-2 hover:bg-muted"
                    >
                      <Link2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-primary">{l.url}</span>
                        <span className="block text-xs text-muted-foreground">
                          {format(new Date(l.createdAt), "dd/MM/yyyy HH:mm")}
                        </span>
                      </span>
                      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </a>
                  </li>
                ))}
              </ul>
            ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>;
}
