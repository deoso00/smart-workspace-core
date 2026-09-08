import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ensureWorkspace, listWorkspaces, type Workspace } from "./db";

const ACTIVE_KEY = "zanto.workspace.active";

type Ctx = {
  workspaces: Workspace[];
  activeId: string | null;
  active: Workspace | null;
  setActiveId: (id: string) => void;
  refresh: () => void;
  loading: boolean;
};

const WorkspaceContext = createContext<Ctx>({
  workspaces: [],
  activeId: null,
  active: null,
  setActiveId: () => {},
  refresh: () => {},
  loading: true,
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [activeId, setActive] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = window.localStorage.getItem(ACTIVE_KEY);
      const list = await listWorkspaces();
      if (cancelled) return;
      if (list.length === 0) {
        const ws = await ensureWorkspace();
        if (cancelled) return;
        setActive(ws.id);
      } else if (stored && list.some((w) => w.id === stored)) {
        setActive(stored);
      } else {
        setActive(list[0]!.id);
      }
      setReady(true);
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    })();
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const { data: workspaces = [], isLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: listWorkspaces,
    enabled: ready,
  });

  const setActiveId = useCallback((id: string) => {
    window.localStorage.setItem(ACTIVE_KEY, id);
    setActive(id);
  }, []);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const active = workspaces.find((w) => w.id === activeId) ?? null;

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeId,
        active,
        setActiveId,
        refresh,
        loading: !ready || isLoading,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
