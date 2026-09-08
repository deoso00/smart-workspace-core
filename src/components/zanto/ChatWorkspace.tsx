import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
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
import { MODES, PROVIDERS, TOOLS, getProvider } from "@/lib/zanto/catalog";
import { streamChat, type ToolActivity } from "@/lib/zanto/chat-client";
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
import { isProviderConfigured, readCredential } from "@/lib/zanto/providers";
import { useWorkspace } from "@/lib/zanto/workspace-context";
import { FileExplorer } from "./FileExplorer";
import { MediaStudio } from "./MediaStudio";

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
        ? "poolside/laguna-s-2.1:free"
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
      const convo = await createConversation(workspaceId, {
        title: text.slice(0, 60),
        provider,
        model,
        mode,
        runtime: providerInfo?.runtime ?? "cloud",
      });
      conversationId = convo.id;
      setConvoId(convo.id);
    }

    setInput("");
    setTools([]);
    setStreamText("");
    setBusy(true);

    const history = [
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
      { role: "user" as const, content: text },
    ];

    await addMessage(conversationId, "user", text);
    void queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
    void queryClient.invalidateQueries({ queryKey: ["conversations", workspaceId] });

    const controller = new AbortController();
    abortRef.current = controller;
    let assembled = "";
    const collected: ToolActivity[] = [];
    let sawError = false;
    const timeoutId = window.setTimeout(() => {
      controller.abort();
      toast.error("Timeout: il modello non ha risposto in tempo. Riprova o disattiva Agent.");
    }, agent ? 210_000 : 90_000);

    try {
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
        {
          onText: (delta) => {
            assembled += delta;
            setStreamText(assembled);
          },
          onTool: (activity) => {
            const idx = collected.findIndex((t) => t.id === activity.id);
            if (idx >= 0) collected[idx] = activity;
            else collected.push(activity);
            setTools([...collected]);
          },
          onError: (message) => {
            sawError = true;
            toast.error(message);
          },
        },
        controller.signal,
      );

      if (!sawError && !assembled.trim() && collected.length === 0) {
        toast.error(
          "Nessuna risposta da Gemini. Controlla la API key in Providers e riprova (Agent spento).",
        );
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast.error((error as Error).message);
    } finally {
      window.clearTimeout(timeoutId);
      if (assembled.trim() || collected.length > 0) {
        try {
          await addMessage(
            conversationId,
            "assistant",
            assembled || "(interrotto)",
            collected as unknown[],
          );
        } catch (error) {
          toast.error((error as Error).message);
        }
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
  const selectableModels = providerInfo?.models ?? [];

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
          {busy && <Loader2 className="ml-auto size-3.5 animate-spin text-primary" />}
        </div>

        {!configured && (
          <div className="flex items-start gap-2 border-b border-border bg-destructive/10 px-4 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span>
              {providerInfo?.label} non configurato — apri Providers e inserisci la API key.
            </span>
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.length === 0 && !streamText && (
              <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
                <p className="font-display text-base font-semibold text-foreground">
                  Cosa vuoi costruire?
                </p>
                <p className="mt-1">Scrivi sotto. I file del progetto sono a sinistra.</p>
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
                placeholder="Scrivi cosa vuoi costruire…"
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
                <SelectContent>
                  {selectableModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.label}
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
    </div>
  );
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
                <span className="font-mono">{tool.name}</span>
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {tool.status}
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
                <Loader2 className="size-3.5 animate-spin" /> sto pensando…
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
