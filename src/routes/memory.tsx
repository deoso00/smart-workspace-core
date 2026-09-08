import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageShell } from "@/components/zanto/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deleteMemory, listMemory, saveMemory } from "@/lib/zanto/db";
import { useWorkspace } from "@/lib/zanto/workspace-context";

export const Route = createFileRoute("/memory")({
  head: () => ({
    meta: [
      { title: "Memory — ZAnto.AI" },
      { name: "description", content: "Note di memoria persistenti che l'agente può leggere e scrivere." },
      { property: "og:title", content: "Memory — ZAnto.AI" },
      { property: "og:description", content: "Memoria persistente del workspace in ZAnto.AI." },
    ],
  }),
  component: MemoryPage,
});

function MemoryPage() {
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");

  const { data: notes = [] } = useQuery({
    queryKey: ["memory", activeId],
    queryFn: () => listMemory(activeId!),
    enabled: Boolean(activeId),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["memory", activeId] });

  return (
    <PageShell
      title="Memory"
      description="Le note attive vengono passate al modello come contesto in ogni conversazione del workspace."
    >
      <div className="mb-6 space-y-2 rounded-lg border border-border bg-card p-3">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Titolo della nota" />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Contenuto da ricordare"
          className="min-h-24"
        />
        <Button
          className="gap-1.5"
          disabled={!label.trim() || !body.trim() || !activeId}
          onClick={async () => {
            try {
              await saveMemory(activeId!, label.trim(), body.trim());
              setLabel("");
              setBody("");
              refresh();
            } catch (error) {
              toast.error((error as Error).message);
            }
          }}
        >
          <Plus className="size-4" /> Salva nota
        </Button>
      </div>

      {notes.length === 0 && <p className="text-sm text-muted-foreground">Nessuna nota salvata.</p>}
      <ul className="space-y-2">
        {notes.map((note) => (
          <li key={note.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{note.label}</h3>
              <span className="text-xs text-muted-foreground">
                {new Date(note.created_at).toLocaleString()}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto"
                title="Elimina"
                onClick={async () => {
                  await deleteMemory(note.id);
                  refresh();
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{note.body}</p>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
