import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { PageShell } from "@/components/zanto/AppShell";
import { Badge } from "@/components/ui/badge";
import { UNAVAILABLE_MODULES } from "@/lib/zanto/catalog";

export const Route = createFileRoute("/plugins")({
  head: () => ({
    meta: [
      { title: "Plugins — ZAnto.AI" },
      {
        name: "description",
        content: "Moduli predisposti: terminale, filesystem desktop, Android SDK e build APK con stato runtime reale.",
      },
      { property: "og:title", content: "Plugins — ZAnto.AI" },
      { property: "og:description", content: "Moduli e runtime disponibili in ZAnto.AI." },
    ],
  }),
  component: PluginsPage,
});

function PluginsPage() {
  return (
    <PageShell
      title="Plugins"
      description="Questi moduli sono predisposti ma non simulati: se il runtime non c'è, ZAnto.AI lo dichiara."
    >
      <ul className="space-y-2">
        {UNAVAILABLE_MODULES.map((module) => (
          <li key={module.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{module.label}</h2>
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <AlertTriangle className="size-3" /> runtime non rilevato
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{module.reason}</p>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
