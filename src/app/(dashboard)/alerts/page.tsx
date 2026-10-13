"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquareWarning,
  RefreshCw,
  Send,
  ShieldAlert,
  ThumbsDown,
  Undo2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AI_MODEL_SUGGESTIONS, AI_PROVIDER_ECONOMY_MODEL } from "@/lib/ai/defaults";
import type { AiProvider } from "@/lib/ai/types";

type Status = "open" | "resolved" | "false_positive";
type Kind = "unanswered" | "suspicious";
type Severity = "low" | "medium" | "high";

interface AlertRow {
  id: string;
  conversation_id: string;
  kind: Kind;
  category: string | null;
  severity: Severity;
  reason: string;
  excerpt: string | null;
  status: Status;
  created_at: string;
  conversations: {
    id: string;
    assigned_agent_id: string | null;
    contact: { name: string | null; phone: string | null; avatar_url: string | null } | null;
    unofficial_instance: { label: string } | null;
  } | null;
}

interface Settings {
  unanswered_minutes: number;
  ai_scan_enabled: boolean;
  summary_enabled: boolean;
  summary_phone: string;
  summary_instance_id: string;
  summary_hour: number;
  ai_model: string;
}

const DEFAULT_SETTINGS: Settings = {
  unanswered_minutes: 60,
  ai_scan_enabled: true,
  summary_enabled: false,
  summary_phone: "",
  summary_instance_id: "",
  summary_hour: 18,
  ai_model: "",
};

const SEVERITY_STYLE: Record<Severity, string> = {
  high: "bg-red-500/15 text-red-600 dark:text-red-300",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  low: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

const SELECT =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground";

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default function AlertsPage() {
  const t = useTranslations("Alerts");
  const { accountId, user, canManageMembers, loading: authLoading } = useAuth();

  const [status, setStatus] = useState<Status>("open");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const [counts, setCounts] = useState({ unanswered: 0, suspicious: 0, high: 0 });
  const [agentNames, setAgentNames] = useState<Map<string, string>>(new Map());

  const [scanning, setScanning] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [instances, setInstances] = useState<{ id: string; label: string }[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [sendingSummary, setSendingSummary] = useState(false);
  const [missingTables, setMissingTables] = useState(false);
  const [modelList, setModelList] = useState<string[]>([]);
  const [aiInfo, setAiInfo] = useState<{ provider: string; model: string } | null | undefined>(undefined);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();

    let query = supabase
      .from("conversation_alerts")
      .select(
        "*, conversations(id, assigned_agent_id, contact:contacts(name, phone, avatar_url), unofficial_instance:unofficial_wa_instances(label))",
      )
      .eq("account_id", accountId)
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(200);
    if (kind !== "all") query = query.eq("kind", kind);
    if (severity !== "all") query = query.eq("severity", severity);

    const [list, openAll] = await Promise.all([
      query,
      supabase
        .from("conversation_alerts")
        .select("kind, severity")
        .eq("account_id", accountId)
        .eq("status", "open"),
    ]);

    if (list.error && (list.error.code === "PGRST205" || list.error.code === "42P01" || /conversation_alerts/.test(list.error.message))) {
      setMissingTables(true);
    }
    setAlerts(
      ((list.data ?? []) as unknown as AlertRow[]).map((a) => ({
        ...a,
        conversations: one(a.conversations),
      })),
    );
    const rows = (openAll.data ?? []) as { kind: Kind; severity: Severity }[];
    setCounts({
      unanswered: rows.filter((r) => r.kind === "unanswered").length,
      suspicious: rows.filter((r) => r.kind === "suspicious").length,
      high: rows.filter((r) => r.severity === "high").length,
    });
  }, [accountId, status, kind, severity]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (canManageMembers) load();
  }, [load, canManageMembers]);

  // Names for the "consultor" line, settings and the numbers list — loaded once.
  useEffect(() => {
    if (!accountId || !canManageMembers) return;
    const supabase = createClient();
    (async () => {
      supabase
        .from("ai_configs")
        .select("provider, model")
        .eq("account_id", accountId)
        .maybeSingle()
        .then(({ data }) => setAiInfo(data ? { provider: data.provider as string, model: data.model as string } : null));
      const [profiles, cfg, inst] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name").eq("account_id", accountId),
        supabase.from("alert_settings").select("*").eq("account_id", accountId).maybeSingle(),
        fetch("/api/unofficial/instances").then((r) => (r.ok ? r.json() : { instances: [] })).catch(() => ({ instances: [] })),
      ]);
      setAgentNames(new Map((profiles.data ?? []).map((p) => [p.user_id as string, (p.full_name as string) || ""])));
      setInstances((inst.instances ?? []).map((i: { id: string; label: string }) => ({ id: i.id, label: i.label })));
      if (cfg.data) {
        setSettings({
          unanswered_minutes: cfg.data.unanswered_minutes,
          ai_scan_enabled: cfg.data.ai_scan_enabled,
          summary_enabled: cfg.data.summary_enabled,
          summary_phone: cfg.data.summary_phone ?? "",
          summary_instance_id: cfg.data.summary_instance_id ?? "",
          summary_hour: cfg.data.summary_hour,
          ai_model: cfg.data.ai_model ?? "",
        });
      }
    })();
  }, [accountId, canManageMembers]);

  async function setAlertStatus(alert: AlertRow, next: Status) {
    const { error } = await createClient()
      .from("conversation_alerts")
      .update({
        status: next,
        resolved_at: next === "open" ? null : new Date().toISOString(),
        resolved_by: next === "open" ? null : (user?.id ?? null),
      })
      .eq("id", alert.id);
    if (error) return void toast.error(t("actionFailed"));
    await load();
  }

  async function scanNow() {
    setScanning(true);
    try {
      const res = await fetch("/api/alerts/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) return void toast.error(t("scanFailed"));
      const s = data.stats as {
        unansweredCreated: number;
        suspiciousCreated: number;
        skipped?: string;
        error?: string;
      };
      if (s.error) toast.error(t("scanAiError", { reason: s.error }));
      else if (s.skipped === "ai_not_configured") toast.message(t("scanAiInactive"));
      toast.success(t("scanDone", { unanswered: s.unansweredCreated, suspicious: s.suspiciousCreated }));
      await load();
    } catch {
      toast.error(t("scanFailed"));
    } finally {
      setScanning(false);
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const res = await fetch("/api/alerts/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "missing_migration") setMissingTables(true);
        toast.error(t("saveFailedReason", { reason: data.error ?? `HTTP ${res.status}` }));
        return;
      }
      toast.success(t("saved"));
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSavingSettings(false);
    }
  }

  async function sendSummaryNow() {
    setSendingSummary(true);
    try {
      const res = await fetch("/api/alerts/summary", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.sent) toast.success(t("summarySent"));
      else toast.error(t("summaryFailed", { reason: data.reason ?? `HTTP ${res.status}` }));
    } finally {
      setSendingSummary(false);
    }
  }

  const tiles = useMemo(
    () => [
      { label: t("statUnanswered"), value: counts.unanswered, icon: Clock },
      { label: t("statSuspicious"), value: counts.suspicious, icon: MessageSquareWarning },
      { label: t("statSerious"), value: counts.high, icon: AlertTriangle },
    ],
    [counts, t],
  );

  if (authLoading) return null;
  if (!canManageMembers) {
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">{t("adminOnly")}</p>
      </Card>
    );
  }

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs transition-colors",
      active
        ? "border-transparent bg-primary/20 text-foreground"
        : "border-border text-muted-foreground hover:bg-muted",
    );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t("title")}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={scanNow} disabled={scanning}>
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {scanning ? t("scanning") : t("scanNow")}
        </Button>
      </div>

      {missingTables && (
        <Card className="flex-row items-start gap-3 border-amber-500/40 px-4 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <p>{t("missingMigration")}</p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Card key={tile.label} className="flex-row items-center gap-3 px-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <tile.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-2xl font-semibold leading-none text-foreground">{tile.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{tile.label}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["open", "resolved", "false_positive"] as Status[]).map((s) => (
          <button key={s} className={chip(status === s)} onClick={() => setStatus(s)}>
            {s === "open" ? t("tabOpen") : s === "resolved" ? t("tabResolved") : t("tabFalse")}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {(["all", "unanswered", "suspicious"] as const).map((k) => (
          <button key={k} className={chip(kind === k)} onClick={() => setKind(k)}>
            {k === "all" ? t("kindAll") : k === "unanswered" ? t("kindUnanswered") : t("kindSuspicious")}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {(["all", "high", "medium", "low"] as const).map((s) => (
          <button key={s} className={chip(severity === s)} onClick={() => setSeverity(s)}>
            {s === "all" ? t("sevAll") : s === "high" ? t("sevHigh") : s === "medium" ? t("sevMedium") : t("sevLow")}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {alerts === null ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : alerts.length === 0 ? (
          <Card className="items-center gap-2 py-10 text-center">
            <CheckCircle2 className="h-7 w-7 text-lime" />
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          </Card>
        ) : (
          alerts.map((a) => {
            const contact = a.conversations?.contact;
            const who = contact?.name || contact?.phone || t("unknownContact");
            const agent = a.conversations?.assigned_agent_id
              ? agentNames.get(a.conversations.assigned_agent_id) || t("noAgent")
              : t("noAgent");
            const number = a.conversations?.unofficial_instance?.label;
            return (
              <Card key={a.id} className="gap-3 px-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", SEVERITY_STYLE[a.severity])}>
                    {a.severity === "high" ? t("sevHigh") : a.severity === "medium" ? t("sevMedium") : t("sevLow")}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {a.kind === "unanswered" ? t("kindUnanswered") : t(`cat_${a.category ?? "off_topic"}`)}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {format(new Date(a.created_at), "dd/MM HH:mm")}
                  </span>
                </div>

                <div>
                  <p className="text-sm font-medium text-foreground">{who}</p>
                  <p className="text-xs text-muted-foreground">
                    {[number, agent].filter(Boolean).join(" · ")}
                  </p>
                </div>

                <p className="text-sm text-foreground">{a.reason}</p>
                {a.excerpt && (
                  <blockquote className="border-l-2 border-primary/50 pl-3 text-xs italic text-muted-foreground">
                    {a.excerpt}
                  </blockquote>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Link href={`/inbox?c=${a.conversation_id}`}>
                    <Button size="sm">
                      <Send className="h-3.5 w-3.5" />
                      {t("openConversation")}
                    </Button>
                  </Link>
                  {a.status === "open" ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setAlertStatus(a, "resolved")}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t("markResolved")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAlertStatus(a, "false_positive")}>
                        <ThumbsDown className="h-3.5 w-3.5" />
                        {t("markFalse")}
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setAlertStatus(a, "open")}>
                      <Undo2 className="h-3.5 w-3.5" />
                      {t("reopen")}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>

      <Card className="gap-4 px-5">
        <div>
          <h3 className="text-base font-semibold text-foreground">{t("settingsTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("settingsHint")}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="unanswered-min">{t("unansweredAfter")}</Label>
            <Input
              id="unanswered-min"
              type="number"
              min={5}
              max={1440}
              value={settings.unanswered_minutes}
              onChange={(e) => setSettings({ ...settings, unanswered_minutes: Number(e.target.value) })}
            />
          </div>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.ai_scan_enabled}
              onChange={(e) => setSettings({ ...settings, ai_scan_enabled: e.target.checked })}
            />
            <span>
              <span className="block text-foreground">{t("aiScan")}</span>
              <span className="block text-xs text-muted-foreground">{t("aiScanHint")}</span>
              {aiInfo !== undefined && (
                <span className="mt-1.5 block text-xs">
                  {aiInfo ? (
                    <span className="text-muted-foreground">
                      {t("aiUsing", {
                        provider:
                          aiInfo.provider === "anthropic"
                            ? "Anthropic"
                            : aiInfo.provider === "google"
                              ? "Google Gemini"
                              : "OpenAI",
                        model: aiInfo.model,
                      })}
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">{t("aiNone")}</span>
                  )}{" "}
                  <Link href="/agents" className="font-medium text-primary underline-offset-2 hover:underline">
                    {t("aiConfigure")}
                  </Link>
                </span>
              )}
            </span>
          </label>

          {aiInfo && (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="alert-model">{t("aiModel")}</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="alert-model"
                  list="alert-model-suggestions"
                  className="min-w-56 flex-1"
                  placeholder={t("aiModelPlaceholder")}
                  value={settings.ai_model}
                  onChange={(e) => setSettings({ ...settings, ai_model: e.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const provider = aiInfo.provider as AiProvider;
                    let pick: string | null = null;
                    try {
                      const res = await fetch("/api/ai/models", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ provider }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        setModelList(data.models ?? []);
                        pick = data.economy ?? null;
                      }
                    } catch {
                      /* falls back to the built-in suggestion */
                    }
                    setSettings((prev) => ({ ...prev, ai_model: pick ?? AI_PROVIDER_ECONOMY_MODEL[provider] ?? "" }));
                  }}
                >
                  {t("aiModelEconomy", {
                    model: AI_PROVIDER_ECONOMY_MODEL[aiInfo.provider as AiProvider] ?? "",
                  })}
                </Button>
              </div>
              <datalist id="alert-model-suggestions">
                {(modelList.length > 0 ? modelList : (AI_MODEL_SUGGESTIONS[aiInfo.provider as AiProvider] ?? [])).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">{t("aiModelHint")}</p>
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-border p-4">
          <label className="flex items-center gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={settings.summary_enabled}
              onChange={(e) => setSettings({ ...settings, summary_enabled: e.target.checked })}
            />
            {t("summaryEnabled")}
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="summary-phone">{t("summaryPhone")}</Label>
              <Input
                id="summary-phone"
                inputMode="tel"
                placeholder="5562999990000"
                value={settings.summary_phone}
                onChange={(e) => setSettings({ ...settings, summary_phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="summary-instance">{t("summaryNumber")}</Label>
              <select
                id="summary-instance"
                className={SELECT}
                value={settings.summary_instance_id}
                onChange={(e) => setSettings({ ...settings, summary_instance_id: e.target.value })}
              >
                <option value="">—</option>
                {instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="summary-hour">{t("summaryHour")}</Label>
              <select
                id="summary-hour"
                className={SELECT}
                value={settings.summary_hour}
                onChange={(e) => setSettings({ ...settings, summary_hour: Number(e.target.value) })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={sendSummaryNow} disabled={sendingSummary}>
            {sendingSummary ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t("summaryNow")}
          </Button>
          <Button onClick={saveSettings} disabled={savingSettings}>
            {t("save")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
