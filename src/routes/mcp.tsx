import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/zanto/AppShell";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/mcp")({
  head: () => ({
    meta: [
      { title: "MCP — ZAnto.AI" },
      { name: "description", content: "Stato del layer MCP: nessun server collegato, nessuna simulazione." },
      { property: "og:title", content: "MCP — ZAnto.AI" },
      { property: "og:description", content: "Layer MCP di ZAnto.AI." },
    ],
  }),
  component: McpPage,
});

function McpPage() {
  return (
    <PageShell
      title="MCP"
      description="Il layer Tools è già astratto per accogliere server MCP esterni."
    >
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Server collegati</h2>
          <Badge variant="outline" className="text-muted-foreground">
            nessun server rilevato
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Un server MCP richiede un endpoint raggiungibile e credenziali proprie. Finché non ne colleghi
          uno, l'agente usa solo i tool interni elencati nella pagina Tools — nessun tool viene simulato.
        </p>
      </div>
    </PageShell>
  );
}
