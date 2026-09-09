import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Eye,
  Loader2,
  Plus,
  SendHorizontal,
  Square,
  Trash2,
  User,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MODES, PROVIDERS, TOOLS, getProvider, type ModelInfo } from "@/lib/zanto/catalog";
import { streamChat, type ToolActivity } from "@/lib/zanto/chat-client";
import { streamOpenRouterChat } from "@/lib/zanto/openrouter-client";
import { streamOpenRouterAgent } from "@/lib/zanto/openrouter-agent";
import {
  cleanProviderSecret,
  isProviderConfigured,
  listOllamaModelNames,
  readCredential,
} from "@/lib/zanto/providers";
import {
  addMessage,
  createConversation,
  deleteConversation,
  listConversations,
  listMemory,
  listMessages,
  listToolPermissions,
  updateConversation,
  type Conversation,
} from "@/lib/zanto/db";
import { getGuestKey } from "@/lib/zanto/guest";
import { useWorkspace } from "@/lib/zanto/workspace-context";
import { FileExplorer } from "./FileExplorer";
import { MediaStudio } from "./MediaStudio";
import { PreviewPanel } from "./PreviewPanel";
export function ChatWorkspace() {
  const { activeId: workspaceId, loading, error: workspaceError, retry } = useWorkspace();
  const queryClient = useQueryClient();

  const [convoId, setConvoId] = useState<string | null>(null);
  const desktop =
    import.meta.env.VITE_ZANTO_DESKTOP === "1" ||
    (typeof window !== "undefined" && Boolean((window as { zantoDesktop?: unknown }).zantoDesktop));
  const onLovableHost =
    typeof window !== "undefined" &&
    /\.(lovable\.app|lovableproject\.com|lovableproject-dev\.com)$/i.test(window.location.hostname);
  const [provider, setProvider] = useState(
    desktop ? "ollama" : onLovableHost ? "openrouter" : "google",
  );
  const [model, setModel] = useState(
    desktop
      ? "llama3.2:1b"
      : onLovableHost
        ? "openrouter/free"
        : "gemini-3.7-flash",
  );
  const [mode, setMode] = useState(desktop ? "LOCAL" : "AUTO");
  const [agent, setAgent] = useState(false);

  useEffect(() => {
    if (/veo|flash-image|image-generation/i.test(model)) {
      setModel(getProvider(provider)?.models[0]?.id ?? "gemini-3.7-flash");
    }
  }, [model, provider]);
  const [input, setInput] = useState("");
  const [streamText, setStreamText] = useState("");
  const [tools, setTools] = useState<ToolActivity[]>([]);
  const [busy, setBusy] = useState(false);
  const [runStatus, setRunStatus] = useState<"idle" | "thinking" | "working" | "done" | "incomplete">("idle");
  const [lastDoneSummary, setLastDoneSummary] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [ollamaLiveModels, setOllamaLiveModels] = useState<ModelInfo[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations", workspaceId],
    queryFn: () => listConversations(workspaceId!),
    enabled: Boolean(workspaceId),
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["messages", convoId],
    queryFn: () => listMessages(convoId!),
    enabled: Boolean(convoId),
  });

  const { data: permissions = [] } = useQuery({
    queryKey: ["permissions", workspaceId],
    queryFn: () => listToolPermissions(workspaceId!),
    enabled: Boolean(workspaceId),
  });

  const { data: memory = [] } = useQuery({
    queryKey: ["memory", workspaceId],
    queryFn: () => listMemory(workspaceId!),
    enabled: Boolean(workspaceId),
  });

  useEffect(() => {
    if (!convoId && conversations.length > 0) setConvoId(conversations[0]!.id);
  }, [conversations, convoId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, streamText]);

  useEffect(() => {
    if (provider !== "ollama") {
      setOllamaLiveModels([]);
      return;
    }
    let cancelled = false;
    const base = readCredential("ollama").baseUrl?.trim() || "http://localhost:11434";
    void listOllamaModelNames(base)
      .then((names) => {
        if (cancelled) return;
        const catalog = getProvider("ollama")?.models ?? [];
        const map = new Map<string, ModelInfo>();
        for (const m of catalog) map.set(m.id, m);
        for (const name of names) {
          const short = name.replace(/:latest$/, "");
          if (!map.has(name)) {
            map.set(name, { id: name, label: name, note: "Rilevato da Ollama" });
          }
          if (short !== name && !map.has(short)) {
            map.set(short, { id: short, label: short, note: "Rilevato da Ollama" });
          }
          // Upgrade label if catalog has a nicer name for the short id
          const nice = catalog.find((c) => c.id === short || c.id === name);
          if (nice) {
            map.set(short, nice);
            if (name !== short) map.set(name, { ...nice, id: name, label: `${nice.label} (${name})` });
          }
        }
        setOllamaLiveModels([...map.values()]);
      })
      .catch(() => {
        if (!cancelled) setOllamaLiveModels(getProvider("ollama")?.models ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const providerInfo = getProvider(provider);
  const configured = isProviderConfigured(provider);

  const allowedTools = TOOLS.filter((tool) => {
    const row = permissions.find((p) => p.tool_name === tool.name);
    return row
      ? row.allowed
      : !tool.mutating ||
          tool.name === "vfs_write" ||
          tool.name === "memory_save" ||
          tool.name === "media_generate_image" ||
          tool.name === "media_generate_video";
  }).map((tool) => tool.name);

  const newConversation = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("Nessun workspace attivo");
      return createConversation(workspaceId, {
        title: "Nuova conversazione",
        provider,
        model,
        mode,
        runtime: providerInfo?.runtime ?? "cloud",
      });
    },
    onSuccess: (convo: Conversation) => {
      setConvoId(convo.id);
      void queryClient.invalidateQueries({ queryKey: ["conversations", workspaceId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeConversation = async (id: string) => {
    await deleteConversation(id);
    if (convoId === id) setConvoId(null);
    void queryClient.invalidateQueries({ queryKey: ["conversations", workspaceId] });
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setRunStatus("incomplete");
    setLastDoneSummary("Interrotto. I file già scritti restano a sinistra — puoi scrivere «continua».");
  };

  const openPreview = () => {
    setPreviewOpen(true);
    setPreviewRefresh((n) => n + 1);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !workspaceId || busy) return;
    if (!configured) {
      toast.error(`${providerInfo?.label ?? provider} non è configurato.`);
      return;
    }

    let conversationId = convoId;
    if (!conversationId) {
      try {
        const convo = await Promise.race([
          createConversation(workspaceId, {
            title: text.slice(0, 60),
            provider,
            model,
            mode,
            runtime: providerInfo?.runtime ?? "cloud",
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout creazione chat (Supabase). Controlla la connessione.")), 12_000),
          ),
        ]);
        conversationId = convo.id;
        setConvoId(convo.id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Impossibile creare la conversazione");
        return;
      }
    }

    setInput("");
    setTools([]);
    setStreamText("");
    setBusy(true);
    setRunStatus("thinking");
    setLastDoneSummary(null);

    const history = [
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
      { role: "user" as const, content: text },
    ];

    const controller = new AbortController();
    abortRef.current = controller;
    let assembled = "";
    const collected: ToolActivity[] = [];
    let sawError = false;
    // Timeout starts immediately — never wait forever on Supabase or the model.
    const timeoutMs = provider === "ollama" ? (agent ? 180_000 : 90_000) : agent ? 120_000 : 45_000;
    const timeoutId = window.setTimeout(() => {
      controller.abort();
      setInput((prev) => prev || text);
      toast.error(
        provider === "ollama"
          ? "Timeout Ollama. I modelli 7B sul PC sono lenti: attendi o usa llama3.2:1b / OpenRouter."
          : "Timeout: nessuna risposta. Controlla rete/Supabase/chiave, Agent OFF, riprova.",
      );
    }, timeoutMs);

    // Persist user message in background — do not block the model call.
    void Promise.race([
      addMessage(conversationId, "user", text),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("timeout-save")), 10_000),
      ),
    ])
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
        void queryClient.invalidateQueries({ queryKey: ["conversations", workspaceId] });
      })
      .catch(() => {
        toast.message("Messaggio inviato al modello; salvataggio chat lento (Supabase).");
      });

    try {
      const handlers = {
        onText: (delta: string) => {
          assembled += delta;
          setStreamText(assembled);
        },
        onTool: (activity: ToolActivity) => {
          const idx = collected.findIndex((t) => t.id === activity.id);
          if (idx >= 0) collected[idx] = activity;
          else collected.push(activity);
          setTools([...collected]);
          setRunStatus("working");
        },
        onError: (message: string) => {
          sawError = true;
          setInput((prev) => prev || text);
          toast.error(message);
        },
      };

      const openRouterKey = cleanProviderSecret(readCredential("openrouter").apiKey ?? "");
      // OpenRouter sempre dal browser su Lovable (server toglie Authorization).
      // Agent ON → tool VFS nel client; Agent OFF → chat semplice.
      if (provider === "openrouter") {
        if (!openRouterKey.startsWith("sk-or-")) {
          toast.error(
            "OpenRouter: Providers → Rimuovi → incolla solo sk-or-v1-… → Salva → Testa chiave.",
          );
          sawError = true;
          setInput(text);
        } else if (agent) {
          await streamOpenRouterAgent({
            apiKey: openRouterKey,
            model,
            workspaceId,
            messages: history,
            handlers,
            signal: controller.signal,
          });
        } else {
          await streamOpenRouterChat({
            apiKey: openRouterKey,
            model,
            messages: history,
            system:
              "Sei ZAnto.AI. Rispondi in italiano. Se l'utente chiede di creare file, digli di attivare Agent (toggle) e riprovare — non inventare comandi bash.",
            handlers,
            signal: controller.signal,
          });
        }
      } else {
        await streamChat(
          {
            workspaceId,
            ownerKey: getGuestKey(),
            provider,
            model,
            mode,
            agent,
            allowedTools,
            credential: readCredential(provider),
            mediaCredential: readCredential("google"),
            memory: memory
              .slice(0, 10)
              .map((note) => `- ${note.label}: ${note.body}`)
              .join("\n"),
            messages: history,
          },
          handlers,
          controller.signal,
        );
      }

      if (!sawError && !assembled.trim() && collected.length === 0 && !controller.signal.aborted) {
        setInput((prev) => prev || text);
        toast.error(
          "Nessuna risposta dal modello. Prova Free router / North Mini, Agent OFF, o Stop e riprova.",
        );
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setInput((prev) => prev || text);
        toast.error((error as Error).message);
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (assembled.trim() || collected.length > 0) {
        try {
          await Promise.race([
            addMessage(
              conversationId,
              "assistant",
              assembled || "(interrotto)",
              collected as unknown[],
            ),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error("timeout-save-assistant")), 10_000),
            ),
          ]);
        } catch {
          toast.message("Risposta ricevuta ma salvataggio lento (Supabase).");
        }
      }

      const writes = collected.filter(
        (t) => t.name === "vfs_write" && t.status === "done",
      );
      const incomplete =
        /creazione incompleta|limite di step/i.test(assembled) || controller.signal.aborted;
      if (writes.length > 0) {
        const paths = writes
          .map((t) => {
            const inputObj = t.input as { path?: string } | undefined;
            return inputObj?.path;
          })
          .filter(Boolean) as string[];
        const hasHtml = paths.some((p) => /\.html?$/i.test(p));
        setRunStatus(incomplete ? "incomplete" : "done");
        setLastDoneSummary(
          incomplete
            ? `Scritti ${writes.length} file, ma il giro Agent non è completo. Scrivi «continua» senza rifare tutto il prompt.`
            : `Creazione finita · ${writes.length} file${paths.length ? `: ${paths.slice(0, 4).join(", ")}` : ""}${hasHtml ? " · Anteprima disponibile" : ""}`,
        );
        if (hasHtml) {
          setPreviewOpen(true);
          setPreviewRefresh((n) => n + 1);
          toast.success("File pronti — anteprima aperta a destra.");
        } else {
          toast.success("Creazione finita. Controlla i file a sinistra.");
        }
      } else if (!sawError && !controller.signal.aborted) {
        setRunStatus("done");
        setLastDoneSummary("Risposta completa.");
      } else if (controller.signal.aborted) {
        setRunStatus("incomplete");
      }

      setStreamText("");
      setBusy(false);
      abortRef.current = null;
      void queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["vfs", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["memory", workspaceId] });
    }
  };

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-primary" /> Preparo il workspace…
        </span>
      </div>
    );
  }

  if (workspaceError || !workspaceId) {
    const isSupabase =
      Boolean(workspaceError?.includes("Supabase")) ||
      Boolean(workspaceError?.includes("SUPABASE_"));
    return (
      <div className="grid h-full place-items-center px-4">
        <div className="max-w-lg space-y-3 rounded-xl border border-border bg-card p-6 text-center shadow-lg">
          <AlertTriangle className="mx-auto size-7 text-destructive" />
          <p className="font-display text-lg font-semibold">Chat non disponibile</p>
          <p className="text-sm text-muted-foreground">
            {workspaceError ?? "Nessun workspace attivo."}
          </p>
          {isSupabase && (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-left text-xs text-muted-foreground">
              Su Lovable: apri il progetto → <strong>Connect Supabase</strong> / Cloud, oppure
              verifica che esistano{" "}
              <code className="text-foreground">VITE_SUPABASE_URL</code> e{" "}
              <code className="text-foreground">VITE_SUPABASE_PUBLISHABLE_KEY</code>, poi fai
              Publish di nuovo.
            </p>
          )}
          <Button onClick={retry}>Riprova</Button>
        </div>
      </div>
    );
  }

  const selectableProviders = PROVIDERS;
  const selectableModels =
    provider === "ollama" && ollamaLiveModels.length > 0
      ? ollamaLiveModels
      : (providerInfo?.models ?? []);

  return (
    <div className="flex h-full min-h-0 bg-background">
      {/* LEFT: file tree (Bolt-style workbench) */}
      <aside className="flex w-[min(100%,17rem)] shrink-0 flex-col border-r border-border bg-card/30 sm:w-64">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Files</span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            title="Nuova chat"
            onClick={() => newConversation.mutate()}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <FileExplorer workspaceId={workspaceId} compact />
        </div>
        <div className="max-h-36 shrink-0 overflow-y-auto border-t border-border">
          <p className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Chat
          </p>
          {conversations.map((convo) => (
            <div
              key={convo.id}
              className={`group flex items-center gap-1 px-2 py-1 text-xs ${
                convoId === convo.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => setConvoId(convo.id)}
              >
                {convo.title ?? "Senza titolo"}
              </button>
              <button
                type="button"
                className="hidden p-0.5 hover:text-destructive group-hover:block"
                onClick={() => void removeConversation(convo.id)}
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* CENTER: chat + composer with models under */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 items-center gap-2 border-b border-border px-4">
          <span className="text-sm font-medium">Chat</span>
          {agent && (
            <Badge variant="secondary" className="text-[10px]">
              Agent
            </Badge>
          )}
          {busy && runStatus === "thinking" && (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-primary" /> Sto pensando…
            </span>
          )}
          {busy && runStatus === "working" && (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-primary" />
              Sto creando… {tools.filter((t) => t.status === "done").length}/{Math.max(tools.length, 1)} tool
            </span>
          )}
          {!busy && runStatus === "done" && (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" /> Finito
            </span>
          )}
          {!busy && runStatus === "incomplete" && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400">Incompleto — scrivi «continua»</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant={previewOpen ? "secondary" : "ghost"}
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => (previewOpen ? setPreviewOpen(false) : openPreview())}
            >
              <Eye className="size-3.5" />
              Anteprima
            </Button>
            {busy && <Loader2 className="size-3.5 animate-spin text-primary" />}
          </div>
        </div>

        {!configured && (
          <div className="flex items-start gap-2 border-b border-border bg-destructive/10 px-4 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span>
              {providerInfo?.label} non configurato — apri Providers e inserisci la API key.
            </span>
          </div>
        )}

        {provider === "lovable" && (
          <div className="flex items-start gap-2 border-b border-border bg-amber-500/10 px-4 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <span>
              Se Lovable AI dice di passare ad altri modelli, i crediti <strong>Run/Gateway</strong> sono
              finiti (non i Build dell&apos;editor). Usa <strong>OpenRouter</strong> o{" "}
              <strong>Ollama</strong> — non è un bug della chat.
            </span>
          </div>
        )}

        {provider === "openrouter" && (
          <div className="flex items-start gap-2 border-b border-border bg-amber-500/10 px-4 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <span>
              OpenRouter free: ~<strong>50 msg/giorno</strong> in totale (tutti i modelli :free insieme).
              Se il limite compare su tutti, <strong>non cambiare modello</strong> — spegni Agent, usa{" "}
              <strong>Ollama</strong> (PC) / <strong>Gemini</strong>, o aspetta il reset.
            </span>
          </div>
        )}

        {lastDoneSummary && !busy && (
          <div className="flex items-center gap-2 border-b border-border bg-emerald-500/10 px-4 py-2 text-xs">
            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
            <span className="min-w-0 flex-1">{lastDoneSummary}</span>
            <Button size="sm" variant="outline" className="h-6 shrink-0 text-[10px]" onClick={openPreview}>
              Apri anteprima
            </Button>
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.length === 0 && !streamText && (
              <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
                <p className="font-display text-base font-semibold text-foreground">
                  Cosa vuoi costruire?
                </p>
                <p className="mt-1">
                  Agent ON → crea file. Poi Anteprima a destra (URL localhost sul desktop).
                </p>
              </div>
            )}
            {messages.map((message) => (
              <MessageRow
                key={message.id}
                role={message.role}
                content={message.content}
                parts={(message.parts as unknown as ToolActivity[]) ?? []}
              />
            ))}
            {(streamText || busy) && (
              <MessageRow role="assistant" content={streamText} parts={tools} streaming={busy} />
            )}
          </div>
        </div>

        <div className="border-t border-border bg-card/40 px-4 py-3">
          <div className="mx-auto max-w-2xl space-y-2">
            <div className="flex items-end gap-2 rounded-xl border border-border bg-background p-2 shadow-sm">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  runStatus === "incomplete"
                    ? "Scrivi «continua» per riprendere senza rifare tutto il prompt…"
                    : "Scrivi cosa vuoi costruire…"
                }
                className="max-h-36 min-h-[48px] flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              {busy ? (
                <Button variant="destructive" size="icon" className="size-9 shrink-0" onClick={stop}>
                  <Square className="size-4" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="size-9 shrink-0"
                  onClick={() => void send()}
                  disabled={!input.trim()}
                >
                  <SendHorizontal className="size-4" />
                </Button>
              )}
            </div>
            <MediaStudio workspaceId={workspaceId} />

            {/* Model / provider under chat — real catalog only */}
            <div className="flex flex-wrap items-center gap-1.5 px-0.5">
              <Select
                value={model}
                onValueChange={setModel}
                disabled={selectableModels.length === 0}
              >
                <SelectTrigger className="h-7 w-auto min-w-[9rem] gap-1 border-0 bg-transparent px-2 text-[11px] shadow-none">
                  <Bot className="size-3 text-primary" />
                  <SelectValue placeholder="Modello" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {selectableModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.label}
                      {m.note ? ` · ${m.note}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={provider}
                onValueChange={(value) => {
                  setProvider(value);
                  const first = getProvider(value)?.models[0]?.id;
                  if (first) setModel(first);
                }}
              >
                <SelectTrigger className="h-7 w-auto min-w-[8rem] border-0 bg-transparent px-2 text-[11px] shadow-none">
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                  {selectableProviders.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.label}
                      {isProviderConfigured(p.id) ? "" : " · setup"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex h-7 items-center gap-1.5 px-1">
                <Label htmlFor="agent-toggle" className="text-[11px] text-muted-foreground">
                  Agent
                </Label>
                <Switch
                  id="agent-toggle"
                  checked={agent}
                  onCheckedChange={(value) => {
                    if (value && provider === "lovable") {
                      toast.message("Agent su Lovable brucia crediti Run (fino a 4 step a messaggio). Usalo solo per i file.");
                    }
                    if (value && provider === "openrouter") {
                      toast.message("Agent ON: userà vfs_write nel browser. Poi chiedi: crea /ciao.txt con ciao");
                    }
                    setAgent(value);
                    if (convoId) void updateConversation(convoId, { agent_enabled: value });
                  }}
                />
              </div>

              {provider === "lovable" && (
                <span className="hidden max-w-[11rem] truncate text-[10px] text-muted-foreground sm:inline">
                  {agent ? "Agent=più crediti" : "Chat=1 call · meno crediti"}
                </span>
              )}

              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="h-7 w-[5.5rem] border-0 bg-transparent px-2 text-[11px] shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className="ml-auto hidden text-[10px] text-muted-foreground sm:inline">
                {allowedTools.length} tools
              </span>
            </div>
          </div>
        </div>
      </section>

      {previewOpen && (
        <div className="hidden w-[min(42%,28rem)] shrink-0 md:flex md:flex-col lg:w-[min(46%,36rem)]">
          <PreviewPanel
            workspaceId={workspaceId}
            refreshKey={previewRefresh}
            onClose={() => setPreviewOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

function toolLabel(tool: ToolActivity): string {
  const path =
    tool.input && typeof tool.input === "object" && "path" in tool.input
      ? String((tool.input as { path?: unknown }).path ?? "")
      : "";
  if (tool.name === "vfs_write" && path) return `scrive ${path}`;
  if (tool.name === "vfs_read" && path) return `legge ${path}`;
  return tool.name;
}

function MessageRow({
  role,
  content,
  parts,
  streaming = false,
}: {
  role: string;
  content: string;
  parts: ToolActivity[];
  streaming?: boolean;
}) {
  const isUser = role === "user";
  const running = parts.some((p) => p.status === "running");
  return (
    <div className="flex gap-3">
      <span
        className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-[11px] ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        }`}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        {parts.length > 0 && (
          <ul className="mb-2 space-y-1">
            {parts.map((tool) => (
              <li
                key={tool.id}
                className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
              >
                <Wrench className="size-3 text-muted-foreground" />
                <span className="min-w-0 truncate font-mono">{toolLabel(tool)}</span>
                <Badge
                  variant="secondary"
                  className={`ml-auto text-[10px] ${
                    tool.status === "done"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : tool.status === "error"
                        ? "bg-destructive/15 text-destructive"
                        : ""
                  }`}
                >
                  {tool.status === "running"
                    ? "in corso"
                    : tool.status === "done"
                      ? "ok"
                      : tool.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {isUser ? (
          <div className="inline-block whitespace-pre-wrap rounded-2xl bg-primary px-3.5 py-2 text-sm text-primary-foreground">
            {content}
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {content}
            {streaming && !content && (
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {running ? "sto creando i file…" : "sto pensando…"}
              </span>
            )}
            {streaming && content && running && (
              <span className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> ancora al lavoro sui file…
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
