import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageShell } from "@/components/zanto/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createWorkspace, deleteWorkspace, renameWorkspace } from "@/lib/zanto/db";
import { useWorkspace } from "@/lib/zanto/workspace-context";

export const Route = createFileRoute("/workspaces")({
  head: () => ({
    meta: [
      { title: "Workspaces — ZAnto.AI" },
      { name: "description", content: "Crea e gestisci workspace isolati con file e memoria propri." },
      { property: "og:title", content: "Workspaces — ZAnto.AI" },
      { property: "og:description", content: "Gestione dei workspace isolati di ZAnto.AI." },
    ],
  }),
  component: WorkspacesPage,
});

function WorkspacesPage() {
  const { workspaces, activeId, setActiveId } = useWorkspace();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["workspaces"] });

  return (
    <PageShell
      title="Workspaces"
      description="Ogni workspace ha filesystem virtuale, memoria, permessi tool e log separati."
    >
      <div className="mb-6 flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nome del nuovo workspace"
        />
        <Button
          className="gap-1.5"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              const ws = await createWorkspace(name.trim());
              setName("");
              refresh();
              setActiveId(ws.id);
            } catch (error) {
              toast.error((error as Error).message);
            }
          }}
        >
          <Plus className="size-4" /> Crea
        </Button>
      </div>

      <ul className="space-y-2">
        {workspaces.map((ws) => (
          <li
            key={ws.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
          >
            <Input
              defaultValue={ws.name}
              className="h-9 max-w-xs"
              onBlur={async (event) => {
                const value = event.target.value.trim();
                if (!value || value === ws.name) return;
                await renameWorkspace(ws.id, value);
                refresh();
              }}
            />
            <span className="text-xs text-muted-foreground">
              creato {new Date(ws.created_at).toLocaleDateString()}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {activeId === ws.id ? (
                <span className="flex items-center gap-1 text-xs text-primary">
                  <Check className="size-3.5" /> attivo
                </span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setActiveId(ws.id)}>
                  Attiva
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                title="Elimina"
                disabled={workspaces.length <= 1}
                onClick={async () => {
                  if (!window.confirm(`Eliminare "${ws.name}" e tutti i suoi dati?`)) return;
                  await deleteWorkspace(ws.id);
                  const next = workspaces.find((w) => w.id !== ws.id);
                  if (next) setActiveId(next.id);
                  refresh();
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
