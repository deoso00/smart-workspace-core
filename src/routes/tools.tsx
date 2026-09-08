import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/zanto/AppShell";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { TOOLS } from "@/lib/zanto/catalog";
import { listToolPermissions, setToolPermission } from "@/lib/zanto/db";
import { useWorkspace } from "@/lib/zanto/workspace-context";

export const Route = createFileRoute("/tools")({
  head: () => ({
    meta: [
      { title: "Tools — ZAnto.AI" },
      { name: "description", content: "Autorizza i tool che l'agente può eseguire in questo workspace." },
      { property: "og:title", content: "Tools — ZAnto.AI" },
      { property: "og:description", content: "Permessi tool dell'agente in ZAnto.AI." },
    ],
  }),
  component: ToolsPage,
});

function ToolsPage() {
  const { activeId } = useWorkspace();
  const queryClient = useQueryClient();
  const { data: permissions = [] } = useQuery({
    queryKey: ["permissions", activeId],
    queryFn: () => listToolPermissions(activeId!),
    enabled: Boolean(activeId),
  });

  return (
    <PageShell
      title="Tools"
      description="Un tool disattivato non viene mai proposto all'agente: la richiesta parte senza quel permesso."
    >
      <ul className="space-y-2">
        {TOOLS.map((tool) => {
          const row = permissions.find((p) => p.tool_name === tool.name);
          const allowed = row ? row.allowed : true;
          return (
            <li
              key={tool.name}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{tool.name}</span>
                  {tool.mutating && <Badge variant="secondary">scrive dati</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{tool.description}</p>
              </div>
              <Switch
                checked={allowed}
                disabled={!activeId}
                onCheckedChange={async (value) => {
                  await setToolPermission(activeId!, tool.name, value);
                  void queryClient.invalidateQueries({ queryKey: ["permissions", activeId] });
                  void queryClient.invalidateQueries({ queryKey: ["activity", activeId] });
                }}
              />
            </li>
          );
        })}
      </ul>
    </PageShell>
  );
}
