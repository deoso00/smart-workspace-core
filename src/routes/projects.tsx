import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageShell } from "@/components/zanto/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createProject, deleteProject, listProjects, updateProject } from "@/lib/zanto/db";
import { useWorkspace } from "@/lib/zanto/workspace-context";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "Projects — ZAnto.AI" },
      { name: "description", content: "Organizza il lavoro in progetti persistenti dentro un workspace." },
      { property: "og:title", content: "Projects — ZAnto.AI" },
      { property: "og:description", content: "Progetti persistenti di ZAnto.AI." },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", activeId],
    queryFn: () => listProjects(activeId!),
    enabled: Boolean(activeId),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["projects", activeId] });

  return (
    <PageShell title="Projects" description="Progetti del workspace attivo, salvati nel database.">
      <div className="mb-6 flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nome del nuovo progetto"
        />
        <Button
          className="gap-1.5"
          disabled={!name.trim() || !activeId}
          onClick={async () => {
            try {
              await createProject(activeId!, name.trim());
              setName("");
              refresh();
            } catch (error) {
              toast.error((error as Error).message);
            }
          }}
        >
          <Plus className="size-4" /> Crea
        </Button>
      </div>

      {projects.length === 0 && (
        <p className="text-sm text-muted-foreground">Nessun progetto in questo workspace.</p>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {projects.map((project) => (
          <li key={project.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <Input
                defaultValue={project.name}
                className="h-9"
                onBlur={async (event) => {
                  const value = event.target.value.trim();
                  if (!value || value === project.name) return;
                  await updateProject(project.id, { name: value });
                  refresh();
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                title="Elimina"
                onClick={async () => {
                  if (!window.confirm(`Eliminare "${project.name}"?`)) return;
                  await deleteProject(project.id);
                  refresh();
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <Textarea
              defaultValue={project.description ?? ""}
              placeholder="Descrizione del progetto"
              className="mt-2 min-h-20 text-sm"
              onBlur={async (event) => {
                await updateProject(project.id, { description: event.target.value });
                refresh();
              }}
            />
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
