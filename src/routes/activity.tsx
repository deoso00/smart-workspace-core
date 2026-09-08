import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/zanto/AppShell";
import { Badge } from "@/components/ui/badge";
import { listActivity } from "@/lib/zanto/db";
import { useWorkspace } from "@/lib/zanto/workspace-context";

export const Route = createFileRoute("/activity")({
  head: () => ({
    meta: [
      { title: "Activity — ZAnto.AI" },
      { name: "description", content: "Log delle attività del workspace: file, agent, permessi, memoria." },
      { property: "og:title", content: "Activity — ZAnto.AI" },
      { property: "og:description", content: "Registro attività di ZAnto.AI." },
    ],
  }),
  component: ActivityPage,
});

function ActivityPage() {
  const { activeId } = useWorkspace();
  const { data: rows = [] } = useQuery({
    queryKey: ["activity", activeId],
    queryFn: () => listActivity(activeId!, 200),
    enabled: Boolean(activeId),
  });

  return (
    <PageShell title="Activity" description="Ogni operazione persistente viene registrata qui.">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nessuna attività.</p>}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm"
          >
            <Badge variant="secondary">{row.kind}</Badge>
            <span className="min-w-0 flex-1">{row.message}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(row.created_at).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
