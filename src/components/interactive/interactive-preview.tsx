"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, List, Phone, Reply } from "lucide-react";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import type {
  InteractiveButton,
  InteractiveMessagePayload,
} from "@/lib/whatsapp/interactive";

/**
 * WhatsApp-style read-only render of an interactive message. Used both
 * in the builder's live preview and by the inbox message bubble so a
 * sent buttons/list message shows the same way it does on the phone.
 *
 * Reply buttons are display-only (the customer taps them on their own
 * device). Buttons that carry an action — open a link, copy a code, call —
 * work here too, so an agent can follow what the customer received.
 * Kept namespace-free so it can be dropped into the composer, the
 * automation builder, and the quick-replies manager without namespace
 * coupling: the fallback labels for empty fields default to plain English,
 * and a host that has a translator can pass its own via `labels`.
 */
export interface InteractivePreviewLabels {
  /** Shown in place of an empty body. */
  body?: string;
  /** Shown in place of an untitled reply button. */
  button?: string;
  /** Shown in place of an empty list button label. */
  menu?: string;
}

const ROW =
  "flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-sm font-medium text-primary first:border-t-0";

function ActionButton({
  button,
  fallbackLabel,
}: {
  button: InteractiveButton;
  fallbackLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const label = button.title || fallbackLabel;
  const action = button.action;

  if (action?.type === "url") {
    return (
      <a
        href={action.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(ROW, "hover:bg-muted/60")}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </a>
    );
  }

  if (action?.type === "call") {
    return (
      <a href={`tel:${action.phone}`} className={cn(ROW, "hover:bg-muted/60")}>
        <Phone className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </a>
    );
  }

  if (action?.type === "copy") {
    return (
      <button
        type="button"
        onClick={async () => {
          if (await copyText(action.code)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        }}
        className={cn(ROW, "hover:bg-muted/60")}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        <span className="truncate">{label}</span>
      </button>
    );
  }

  return (
    <button type="button" disabled className={ROW}>
      <Reply className="h-3.5 w-3.5" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function InteractivePreview({
  payload,
  className,
  labels,
}: {
  payload: InteractiveMessagePayload;
  className?: string;
  labels?: InteractivePreviewLabels;
}) {
  const bodyLabel = labels?.body ?? "Message body…";
  const buttonLabel = labels?.button ?? "Button";
  const menuLabel = labels?.menu ?? "Menu";
  return (
    <div
      className={cn(
        "w-full max-w-[260px] overflow-hidden rounded-lg bg-card text-foreground shadow-sm ring-1 ring-border",
        className,
      )}
    >
      <div className="px-3 py-2">
        {payload.header ? (
          <p className="mb-1 break-words text-sm font-semibold">
            {payload.header}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap break-words text-sm">
          {payload.body || (
            <span className="text-muted-foreground">{bodyLabel}</span>
          )}
        </p>
        {payload.footer ? (
          <p className="mt-1 break-words text-[11px] text-muted-foreground">
            {payload.footer}
          </p>
        ) : null}
      </div>

      {payload.kind === "buttons" ? (
        <div className="flex flex-col border-t border-border">
          {payload.buttons.map((b, i) => (
            <ActionButton key={b.id || i} button={b} fallbackLabel={buttonLabel} />
          ))}
        </div>
      ) : (
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-sm font-medium text-primary"
        >
          <List className="h-3.5 w-3.5" />
          <span className="truncate">{payload.button_label || menuLabel}</span>
        </button>
      )}
    </div>
  );
}
