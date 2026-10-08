'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  Trash2,
  QrCode,
  CheckCircle2,
  XCircle,
  Wifi,
  WifiOff,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { SettingsPanelHead } from './settings-panel-head';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Instance {
  id: string;
  instance_name: string;
  label: string;
  phone: string | null;
  status: 'connected' | 'disconnected' | 'connecting';
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: Instance['status'] }) {
  if (status === 'connected') {
    return (
      <Badge className="gap-1 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
        <CheckCircle2 className="h-3 w-3" />
        Conectado
      </Badge>
    );
  }
  if (status === 'connecting') {
    return (
      <Badge className="gap-1 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        Aguardando QR
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <XCircle className="h-3 w-3 text-muted-foreground" />
      Desconectado
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// QR Code modal
// ---------------------------------------------------------------------------

function QrModal({
  instance,
  open,
  onClose,
  onConnected,
}: {
  instance: Instance;
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQr = useCallback(async () => {
    if (loading || !instance) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/unofficial/instances/${instance.id}/qr`);
      const data = await res.json();
      if (data.connected) {
        clearInterval(pollRef.current!);
        onConnected();
        onClose();
        toast.success(`${instance.label} conectado!`);
        return;
      }
      if (data.qr?.base64) {
        setQrBase64(data.qr.base64);
      } else if (data.error) {
        setError(data.error);
      }
    } catch {
      setError('Erro ao buscar QR code. Verifique se a Evolution API está rodando.');
    } finally {
      setLoading(false);
    }
  }, [instance?.id, instance?.label, loading, onClose, onConnected]);

  useEffect(() => {
    if (!open) {
      clearInterval(pollRef.current!);
      setQrBase64(null);
      setError(null);
      return;
    }
    fetchQr();
    pollRef.current = setInterval(fetchQr, 4000);
    return () => clearInterval(pollRef.current!);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Conectar: {instance.label}</DialogTitle>
          <DialogDescription>
            Abra o WhatsApp no celular → Dispositivos conectados → Conectar um dispositivo → escaneie o QR.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {error ? (
            <div className="w-full rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error}
            </div>
          ) : qrBase64 ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrBase64}
                alt="QR Code WhatsApp"
                className="h-56 w-56 rounded-lg border"
              />
              <p className="mt-2 text-center text-xs text-muted-foreground">
                QR atualiza automaticamente a cada 4 s
              </p>
            </div>
          ) : (
            <div className="flex h-56 w-56 items-center justify-center rounded-lg border bg-muted">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="secondary" onClick={fetchQr} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar QR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Add instance modal
// ---------------------------------------------------------------------------

function AddInstanceModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (instance: Instance) => void;
}) {
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    const trimmed = label.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch('/api/unofficial/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao criar número');
        return;
      }
      onCreated(data.instance);
      onClose();
      setLabel('');
      toast.success(`"${trimmed}" adicionado. Agora escaneie o QR.`);
    } catch {
      toast.error('Erro de rede ao criar número');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Adicionar número WhatsApp</DialogTitle>
          <DialogDescription>
            Dê um nome para identificar este número dentro do CRM (ex: Vendas, Suporte, João).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="instance-label">Nome / identificação</Label>
          <Input
            id="instance-label"
            placeholder="Ex: Vendas, Suporte, Meu número..."
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            disabled={saving}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={saving || !label.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Criar e ver QR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Rename modal
// ---------------------------------------------------------------------------

function RenameModal({
  instance,
  open,
  onClose,
  onRenamed,
}: {
  instance: Instance | null;
  open: boolean;
  onClose: () => void;
  onRenamed: (id: string, label: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (instance) setLabel(instance.label); }, [instance]);

  async function handleSave() {
    if (!instance) return;
    const trimmed = label.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/unofficial/instances/${instance.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: trimmed }),
      });
      if (res.ok) {
        onRenamed(instance.id, trimmed);
        onClose();
        toast.success('Nome atualizado');
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Erro ao renomear');
      }
    } catch {
      toast.error('Erro de rede');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Renomear número</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="rename-label">Novo nome</Label>
          <Input
            id="rename-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            disabled={saving}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !label.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function UnofficialWaConnections() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [qrTarget, setQrTarget] = useState<Instance | null>(null);
  const [renameTarget, setRenameTarget] = useState<Instance | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/unofficial/instances');
      const data = await res.json();
      setInstances(data.instances ?? []);
    } catch {
      toast.error('Erro ao carregar conexões WhatsApp');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleCreated(instance: Instance) {
    setInstances((prev) => [...prev, instance]);
    setQrTarget(instance);
  }

  function handleConnected() {
    setInstances((prev) =>
      prev.map((i) => (i.id === qrTarget?.id ? { ...i, status: 'connected' } : i))
    );
    setQrTarget(null);
  }

  function handleRenamed(id: string, label: string) {
    setInstances((prev) => prev.map((i) => (i.id === id ? { ...i, label } : i)));
  }

  async function handleDelete(instance: Instance) {
    if (!confirm(`Remover "${instance.label}"? Isso desconectará o número.`)) return;
    setDeletingId(instance.id);
    try {
      const res = await fetch(`/api/unofficial/instances/${instance.id}`, { method: 'DELETE' });
      if (res.ok) {
        setInstances((prev) => prev.filter((i) => i.id !== instance.id));
        toast.success(`"${instance.label}" removido`);
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Erro ao remover');
      }
    } catch {
      toast.error('Erro de rede');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <SettingsPanelHead
        title="Números WhatsApp"
        description="Conecte vários números de WhatsApp à mesma conta. Cada número aparece com o nome que você definir nas conversas do inbox."
        action={
          <Button onClick={() => setShowAdd(true)} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Adicionar número
          </Button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : instances.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <QrCode className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">Nenhum número conectado</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Clique em "Adicionar número" para conectar seu primeiro WhatsApp.
          </p>
          <Button className="mt-4" size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Adicionar número
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {instances.map((inst) => (
            <div
              key={inst.id}
              className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
            >
              {/* Icon */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
                {inst.status === 'connected' ? (
                  <Wifi className="h-4 w-4 text-green-600 dark:text-green-400" />
                ) : (
                  <WifiOff className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{inst.label}</p>
                {inst.phone ? (
                  <p className="text-xs text-muted-foreground">{inst.phone}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Número não identificado</p>
                )}
              </div>

              {/* Status */}
              <StatusBadge status={inst.status} />

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Ver / atualizar QR code"
                  onClick={() => setQrTarget(inst)}
                >
                  <QrCode className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Renomear"
                  onClick={() => setRenameTarget(inst)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  title="Remover"
                  disabled={deletingId === inst.id}
                  onClick={() => handleDelete(inst)}
                >
                  {deletingId === inst.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      <AddInstanceModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={handleCreated}
      />

      {qrTarget && (
        <QrModal
          instance={qrTarget}
          open={true}
          onClose={() => setQrTarget(null)}
          onConnected={handleConnected}
        />
      )}

      <RenameModal
        instance={renameTarget}
        open={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        onRenamed={handleRenamed}
      />
    </div>
  );
}
