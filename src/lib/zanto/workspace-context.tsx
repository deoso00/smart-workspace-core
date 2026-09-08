import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ensureWorkspace, listWorkspaces, type Workspace } from "./db";

const ACTIVE_KEY = "zanto.workspace.active";
const BOOT_TIMEOUT_MS = 12_000;

type Ctx = {
  workspaces: Workspace[];
  activeId: string | null;
  active: Workspace | null;
  setActiveId: (id: string) => void;
  refresh: () => void;
  /** True only during the first bootstrap — not during later refetches. */
  loading: boolean;
  error: string | null;
  retry: () => void;
};

const WorkspaceContext = createContext<Ctx>({
  workspaces: [],
  activeId: null,
  active: null,
  setActiveId: () => {},
  refresh: () => {},
  loading: true,
  error: null,
  retry: () => {},
});

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} in timeout (${ms / 1000}s). Verifica Supabase su Lovable.`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [activeId, setActive] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootNonce, setBootNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const stored = window.localStorage.getItem(ACTIVE_KEY);
        const list = await withTimeout(listWorkspaces(), BOOT_TIMEOUT_MS, "Caricamento workspace");
        if (cancelled) return;
        if (list.length === 0) {
          const ws = await withTimeout(ensureWorkspace(), BOOT_TIMEOUT_MS, "Creazione workspace");
          if (cancelled) return;
          setActive(ws.id);
          window.localStorage.setItem(ACTIVE_KEY, ws.id);
        } else if (stored && list.some((w) => w.id === stored)) {
          setActive(stored);
        } else {
          setActive(list[0]!.id);
          window.localStorage.setItem(ACTIVE_KEY, list[0]!.id);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error(`Workspace: ${message}`);
      } finally {
        if (!cancelled) {
          setReady(true);
          void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryClient, bootNonce]);

  const { data: workspaces = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: listWorkspaces,
    enabled: ready && !error,
    retry: 1,
  });

  const setActiveId = useCallback((id: string) => {
    window.localStorage.setItem(ACTIVE_KEY, id);
    setActive(id);
  }, []);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const retry = useCallback(() => {
    setReady(false);
    setError(null);
    setActive(null);
    setBootNonce((n) => n + 1);
  }, []);

  const active = workspaces.find((w) => w.id === activeId) ?? null;

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeId,
        active,
        setActiveId,
        refresh,
        // Do NOT gate on react-query isLoading — that caused endless "Preparo il workspace…"
        loading: !ready,
        error,
        retry,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
