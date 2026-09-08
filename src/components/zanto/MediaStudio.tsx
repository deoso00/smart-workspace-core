import { useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Loader2, Video } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getGuestKey } from "@/lib/zanto/guest";
import { readCredential } from "@/lib/zanto/providers";

type MediaStudioProps = {
  workspaceId: string;
};

export function MediaStudio({ workspaceId }: MediaStudioProps) {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"image" | "video" | null>(null);
  const [lastPath, setLastPath] = useState<string | null>(null);

  const generate = async (kind: "image" | "video") => {
    const text = prompt.trim();
    if (!text) {
      toast.error("Scrivi un prompt per l'immagine o il video.");
      return;
    }
    const gemini = readCredential("google");
    if (kind === "video" && !gemini.apiKey?.trim()) {
      toast.error("Per i video serve la chiave Gemini (e billing Google).");
      return;
    }
    setBusy(kind);
    try {
      const res = await fetch("/api/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          prompt: text,
          workspaceId,
          ownerKey: getGuestKey(),
          credential: gemini.apiKey?.trim()
            ? { apiKey: gemini.apiKey.trim() }
            : undefined,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        path?: string;
        tooLarge?: boolean;
        source?: string;
      };
      if (!res.ok || data.error) {
        throw new Error(data.error || `Errore ${res.status}`);
      }
      setLastPath(data.path ?? null);
      void queryClient.invalidateQueries({ queryKey: ["vfs", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId] });
      if (kind === "image") {
        toast.success(
          `Immagine salvata in ${data.path}${data.source === "pollinations" ? " (Pollinations gratis)" : ""}`,
        );
      } else if (data.tooLarge) {
        toast.success(`Video OK → ${data.path} (file grande: HTML con URI)`);
      } else {
        toast.success(`Video salvato in ${data.path}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-border/80 bg-background/60 px-2.5 py-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Media Studio
        </span>
        <span className="text-[10px] text-muted-foreground">
          Immagini gratis · Video Veo (billing)
        </span>
      </div>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Prompt: es. logo verde neon per ZAnto, stile flat…"
        className="min-h-[52px] resize-none text-xs"
        disabled={Boolean(busy)}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-1 text-[11px]"
          disabled={Boolean(busy)}
          onClick={() => void generate("image")}
        >
          {busy === "image" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <ImageIcon className="size-3" />
          )}
          Genera immagine
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-[11px]"
          disabled={Boolean(busy)}
          title="Veo richiede billing Google a pagamento"
          onClick={() => void generate("video")}
        >
          {busy === "video" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Video className="size-3" />
          )}
          Genera video
        </Button>
        {lastPath && (
          <span className="truncate font-mono text-[10px] text-muted-foreground">{lastPath}</span>
        )}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Per un&apos;immagine vera usa questo bottone (non chiedere a OpenRouter in chat: farebbe solo ASCII).
        Video: solo con billing Google.
      </p>
    </div>
  );
}
