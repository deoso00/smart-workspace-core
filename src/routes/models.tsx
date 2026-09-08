import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/zanto/AppShell";
import { Badge } from "@/components/ui/badge";
import { MODES, PROVIDERS, RUNTIMES } from "@/lib/zanto/catalog";
import { isProviderConfigured } from "@/lib/zanto/providers";

export const Route = createFileRoute("/models")({
  head: () => ({
    meta: [
      { title: "Models — ZAnto.AI" },
      { name: "description", content: "Catalogo modelli per provider, runtime e modalità AUTO/ONLINE/LOCAL." },
      { property: "og:title", content: "Models — ZAnto.AI" },
      { property: "og:description", content: "Catalogo modelli e runtime di ZAnto.AI." },
    ],
  }),
  component: ModelsPage,
});

function ModelsPage() {
  return (
    <PageShell
      title="Models"
      description="Modelli disponibili per provider. I provider non configurati sono segnalati come tali, senza finte disponibilità."
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-3">
          <h2 className="text-sm font-semibold">Modalità</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {MODES.map((mode) => (
              <li key={mode.id}>
                <span className="font-mono text-foreground">{mode.label}</span> — {mode.help}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <h2 className="text-sm font-semibold">Runtime</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {RUNTIMES.map((runtime) => (
              <li key={runtime.id}>
                <span className="font-mono text-foreground">{runtime.label}</span> — {runtime.help}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="space-y-4">
        {PROVIDERS.map((provider) => (
          <section key={provider.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold">{provider.label}</h2>
              <Badge variant={isProviderConfigured(provider.id) ? "default" : "outline"}>
                {isProviderConfigured(provider.id) ? "configurato" : "non configurato"}
              </Badge>
              <Badge variant="secondary">{provider.runtime}</Badge>
            </div>
            <ul className="mt-3 divide-y divide-border">
              {provider.models.map((model) => (
                <li key={model.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-mono text-xs">{model.id}</span>
                  <span className="font-medium">{model.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{model.note}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
