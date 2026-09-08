import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { PageShell } from "@/components/zanto/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getGuestKey, getGuestName, setGuestName } from "@/lib/zanto/guest";
import { useTheme } from "@/lib/zanto/theme";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ZAnto.AI" },
      { name: "description", content: "Identità guest locale, tema e scorciatoie di ZAnto.AI." },
      { property: "og:title", content: "Settings — ZAnto.AI" },
      { property: "og:description", content: "Impostazioni di ZAnto.AI." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { theme, toggle } = useTheme();
  const [name, setName] = useState(() => getGuestName());

  return (
    <PageShell title="Settings" description="Nessun login richiesto: l'identità guest resta in questo browser.">
      <div className="space-y-4">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Identità guest</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            I tuoi dati sono legati a questa chiave locale. Cancellare i dati del browser fa perdere
            l'accesso ai workspace.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <label className="text-xs text-muted-foreground" htmlFor="guest-name">
                Nome visualizzato
              </label>
              <Input id="guest-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <Button
              onClick={() => {
                setGuestName(name.trim() || "Guest");
                toast.success("Nome aggiornato");
              }}
            >
              Salva
            </Button>
          </div>
          <p className="mt-3 font-mono text-xs text-muted-foreground">chiave: {getGuestKey()}</p>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Aspetto</h2>
          <div className="mt-2 flex items-center gap-3">
            <Badge variant="secondary">tema attuale: {theme}</Badge>
            <Button size="sm" variant="outline" onClick={toggle}>
              Passa a {theme === "dark" ? "chiaro" : "scuro"}
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Scorciatoie</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>
              <span className="font-mono text-foreground">⌘/Ctrl + K</span> — command palette
            </li>
            <li>
              <span className="font-mono text-foreground">Invio</span> — invia messaggio
            </li>
            <li>
              <span className="font-mono text-foreground">Shift + Invio</span> — nuova riga
            </li>
          </ul>
        </section>
      </div>
    </PageShell>
  );
}
