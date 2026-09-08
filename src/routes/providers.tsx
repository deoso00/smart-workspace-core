import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, CircleSlash, ExternalLink, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageShell } from "@/components/zanto/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROVIDERS } from "@/lib/zanto/catalog";
import {
  clearCredential,
  isProviderConfigured,
  probeLocalRuntime,
  readCredential,
  writeCredential,
} from "@/lib/zanto/providers";

export const Route = createFileRoute("/providers")({
  head: () => ({
    meta: [
      { title: "Providers — ZAnto.AI" },
      {
        name: "description",
        content:
          "Configura i provider AI: gateway integrato, chiavi personali salvate solo nel browser, runtime locale con rilevamento reale.",
      },
      { property: "og:title", content: "Providers — ZAnto.AI" },
      { property: "og:description", content: "Configurazione sicura dei provider AI in ZAnto.AI." },
    ],
  }),
  component: ProvidersPage,
});

function ProvidersPage() {
  const [tick, setTick] = useState(0);
  const [probe, setProbe] = useState<Record<string, string>>({});

  return (
    <PageShell
      title="Providers"
      description="Le chiavi che inserisci restano solo in questo browser: non vengono salvate nel database né nei log."
    >
      <ul className="space-y-4">
        {PROVIDERS.map((provider) => {
          const configured = isProviderConfigured(provider.id);
          return (
            <li key={provider.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-semibold">{provider.label}</h2>
                {configured ? (
                  <Badge className="gap-1">
                    <CheckCircle2 className="size-3" /> configurato
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 text-muted-foreground">
                    <CircleSlash className="size-3" /> non configurato
                  </Badge>
                )}
                <Badge variant="secondary">{provider.runtime}</Badge>
                {provider.docs && (
                  <a
                    href={provider.docs}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    documentazione <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{provider.description}</p>

              {(!provider.builtInKey || Boolean(provider.keyLabel)) && (
                <CredentialForm
                  key={`${provider.id}-${tick}`}
                  providerId={provider.id}
                  label={provider.keyLabel ?? "Credenziale"}
                  local={provider.runtime === "local"}
                  onSaved={() => setTick((value) => value + 1)}
                />
              )}

              {provider.builtInKey && provider.id === "openrouter" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Su Lovable/Vercel: metti <code className="font-mono">OPENROUTER_API_KEY</code> nel{" "}
                  <code className="font-mono">.env</code> (chiave gratis su openrouter.ai/keys). Qui sotto
                  puoi anche incollarla solo in questo browser.
                </p>
              )}

              {provider.runtime === "local" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={async () => {
                      const baseUrl = readCredential(provider.id).baseUrl ?? "http://localhost:11434";
                      const result = await probeLocalRuntime(baseUrl);
                      setProbe((state) => ({ ...state, [provider.id]: result.detail }));
                    }}
                  >
                    <Radio className="size-3.5" /> Rileva runtime
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {probe[provider.id] ?? "Stato runtime sconosciuto: esegui il rilevamento."}
                  </span>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-1.5">
                {provider.models.map((model) => (
                  <Badge key={model.id} variant="outline" className="font-mono text-[11px]">
                    {model.id}
                  </Badge>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </PageShell>
  );
}

function CredentialForm({
  providerId,
  label,
  local,
  onSaved,
}: {
  providerId: string;
  label: string;
  local: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    const cred = readCredential(providerId);
    setValue(local ? (cred.baseUrl ?? "") : cred.apiKey ? "••••••••••••" : "");
  }, [providerId, local]);

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <div className="min-w-[240px] flex-1">
        <label className="text-xs text-muted-foreground" htmlFor={`cred-${providerId}`}>
          {label}
        </label>
        <Input
          id={`cred-${providerId}`}
          type={local ? "text" : "password"}
          value={value}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          placeholder={local ? "http://localhost:11434" : "incolla la chiave"}
        />
      </div>
      <Button
        size="sm"
        onClick={() => {
          if (!value.trim() || value.startsWith("••")) return;
          writeCredential(providerId, local ? { baseUrl: value.trim() } : { apiKey: value.trim() });
          toast.success("Credenziale salvata in questo browser");
          onSaved();
        }}
      >
        Salva
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          clearCredential(providerId);
          setValue("");
          toast.success("Credenziale rimossa");
          onSaved();
        }}
      >
        Rimuovi
      </Button>
    </div>
  );
}
