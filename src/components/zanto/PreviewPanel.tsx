import { ExternalLink, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listNodes } from "@/lib/zanto/db";
import { mergeLocalOverRemote } from "@/lib/zanto/local-vfs";
import {
  filesFromVfsNodes,
  pickPreviewEntry,
  startPreviewSession,
  type PreviewSession,
} from "@/lib/zanto/preview";

type Props = {
  workspaceId: string;
  /** Bump to force reload after agent writes files */
  refreshKey?: number;
  onClose?: () => void;
};

export function PreviewPanel({ workspaceId, refreshKey = 0, onClose }: Props) {
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iframeTick, setIframeTick] = useState(0);
  const sessionRef = useRef<PreviewSession | null>(null);

  const disposeCurrent = useCallback(() => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setSession(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nodes = await listNodes(workspaceId).catch(() => []);
      const merged = mergeLocalOverRemote(workspaceId, nodes);
      const files = filesFromVfsNodes(merged);
      const entry = pickPreviewEntry(files);
      if (!entry) {
        disposeCurrent();
        setError("Nessun HTML nel progetto. Con Agent ON chiedi: crea una pagina in /index.html");
        return;
      }
      disposeCurrent();
      const next = await startPreviewSession(files);
      sessionRef.current = next;
      setSession(next);
      setIframeTick((n) => n + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, disposeCurrent]);

  useEffect(() => {
    void load();
    return () => disposeCurrent();
  }, [load, refreshKey, disposeCurrent]);

  const openExternal = () => {
    if (!session) return;
    const desktop = (window as { zantoDesktop?: { openExternal?: (u: string) => void } }).zantoDesktop;
    if (desktop?.openExternal && session.displayUrl.startsWith("http")) {
      void desktop.openExternal(session.displayUrl);
      return;
    }
    window.open(session.url, "_blank", "noopener,noreferrer");
  };

  return (
    <aside className="flex h-full min-w-0 flex-col border-l border-border bg-card/40">
      <div className="flex h-10 items-center gap-2 border-b border-border px-3">
        <span className="text-sm font-medium">Anteprima</span>
        {session && (
          <code className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground" title={session.displayUrl}>
            {session.displayUrl}
          </code>
        )}
        <Button size="icon" variant="ghost" className="size-7 shrink-0" title="Ricarica" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button size="icon" variant="ghost" className="size-7 shrink-0" title="Apri in tab" onClick={openExternal} disabled={!session}>
          <ExternalLink className="size-3.5" />
        </Button>
        {onClose && (
          <Button size="icon" variant="ghost" className="size-7 shrink-0" title="Chiudi" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {error ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {error}
        </div>
      ) : session ? (
        <iframe
          key={`${session.url}-${iframeTick}`}
          title="Anteprima progetto"
          src={session.url}
          className="min-h-0 w-full flex-1 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {loading ? "Carico anteprima…" : "Nessuna anteprima"}
        </div>
      )}
    </aside>
  );
}
