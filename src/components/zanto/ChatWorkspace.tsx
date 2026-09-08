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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MODES, PROVIDERS, TOOLS, getProvider } from "@/lib/zanto/catalog";
import { streamChat, type ToolActivity } from "@/lib/zanto/chat-client";
import {
  addMessage,
  createConversation,
  deleteConversation,
  listActivity,
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

export function ChatWorkspace() {
  const { activeId: workspaceId, loading } = useWorkspace();
  const queryClient = useQueryClient();

  const [convoId, setConvoId] = useState<string | null>(null);
  const [provider, setProvider] = useState("google");
  const [model, setModel] = useState("gemini-3.7-flash");
  const [mode, setMode] = useState("AUTO");
  const [agent, setAgent] = useState(false);
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

  const { data: activity = [] } = useQuery({
    queryKey: ["activity", workspaceId],
    queryFn: () => listActivity(workspaceId!, 60),
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
    return row ? row.allowed : !tool.mutating || tool.name === "vfs_write" || tool.name === "memory_save";
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
      toast.error("Timeout: Gemini non ha risposto in tempo. Riprova o disattiva Agent.");
    }, 90_000);

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

  if (loading || !workspaceId) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-primary" /> Preparo il workspace…
        </span>
      </div>
    );
  }

  const selectableProviders = PROVIDERS;
  const selectableModels = providerInfo?.models ?? [];

  return (
    <div className="flex h-full min-h-0">
      {/* Conversations strip */}
      <aside className="zanto-glass hidden w-[13.5rem] shrink-0 flex-col border-r border-border/80 md:flex">
        <div className="flex items-center gap-2 border-b border-border/80 px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Chat
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto size-7"
            title="Nuova conversazione"
            onClick={() => newConversation.mutate()}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {conversations.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              Nessuna conversazione: scrivi un messaggio per iniziare.
            </p>
          )}
          {conversations.map((convo) => (
            <div
              key={convo.id}
              className={`group mb-0.5 flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors ${
                convoId === convo.id
                  ? "zanto-glow-sm bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/40"
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-[13px]"
                onClick={() => setConvoId(convo.id)}
              >
                {convo.title ?? "Senza titolo"}
              </button>
              <button
                type="button"
                title="Elimina"
                className="hidden p-1 text-muted-foreground hover:text-destructive group-hover:block"
                onClick={() => void removeConversation(convo.id)}
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Center: Chat / Agent */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border/80 px-3 py-2 md:px-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Chat / Agent</p>
          <Badge variant="outline" className="ml-auto font-mono text-[10px]">
            {agent ? "agent on" : "chat"}
          </Badge>
          {busy && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin text-primary" /> in corso
            </span>
          )}
        </div>

        {!configured && (
          <div className="flex items-start gap-2 border-b border-border/80 bg-destructive/10 px-3 py-2 text-xs text-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span>
              {providerInfo?.label} non è configurato. Aggiungi le credenziali in Providers: ZAnto.AI
              non simula risposte.
            </span>
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.length === 0 && !streamText && (
              <div className="zanto-panel zanto-enter rounded-lg p-6 text-sm text-muted-foreground">
                <p className="font-display text-base font-semibold text-foreground">
                  Inizia una conversazione
                </p>
                <p className="mt-1">
                  Scrivi sotto cosa vuoi costruire. Modello e provider si scelgono nella barra del
                  composer.
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

        {/* Composer + control bar (under input, wireframe) */}
        <div className="zanto-glass border-t border-border/80 px-3 py-3 md:px-5">
          <div className="mx-auto max-w-3xl space-y-2">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="＋  Scrivi cosa vuoi costruire…"
                className="max-h-40 min-h-[56px] flex-1 resize-none border-border/70 bg-background/40 text-sm"
              />
              {busy ? (
                <Button variant="destructive" className="h-10 gap-1.5" onClick={stop}>
                  <Square className="size-4" /> Stop
                </Button>
              ) : (
                <Button
                  className="h-10 gap-1.5"
                  onClick={() => void send()}
                  disabled={!input.trim()}
                >
                  <SendHorizontal className="size-4" /> Invia
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Select
                value={model}
                onValueChange={setModel}
                disabled={selectableModels.length === 0}
              >
                <SelectTrigger className="h-8 w-[min(100%,11.5rem)] border-border/70 bg-background/30 text-[11px]">
                  <Bot className="mr-1 size-3 text-primary" />
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
                <SelectTrigger className="h-8 w-[min(100%,10.5rem)] border-border/70 bg-background/30 text-[11px]">
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                  {selectableProviders.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.label}
                      {isProviderConfigured(p.id) ? "" : " · non config."}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-background/30 px-2">
                <Label htmlFor="agent-toggle" className="text-[11px] text-muted-foreground">
                  Agent
                </Label>
                <Switch
                  id="agent-toggle"
                  checked={agent}
                  onCheckedChange={(value) => {
                    setAgent(value);
                    if (convoId) void updateConversation(convoId, { agent_enabled: value });
                  }}
                />
              </div>

              <Badge variant="secondary" className="h-8 gap-1 font-mono text-[10px]">
                <Wrench className="size-3" />
                {allowedTools.length} tools
              </Badge>

              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="h-8 w-[6.5rem] border-border/70 bg-background/30 text-[11px]">
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

              <span className="ml-auto hidden font-mono text-[10px] text-muted-foreground sm:inline">
                {providerInfo?.runtime ?? "cloud"} · {providerInfo?.label ?? provider}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Right: Activity rail */}
      <aside className="zanto-glass hidden w-[19rem] shrink-0 flex-col border-l border-border/80 xl:flex">
        <div className="border-b border-border/80 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Activity
          </p>
        </div>
        <Tabs defaultValue="agent" className="flex min-h-0 flex-1 flex-col gap-0">
          <TabsList className="mx-2 mt-2 grid h-8 grid-cols-4">
            <TabsTrigger value="agent" className="text-[10px]">
              Agent
            </TabsTrigger>
            <TabsTrigger value="tools" className="text-[10px]">
              Tools
            </TabsTrigger>
            <TabsTrigger value="files" className="text-[10px]">
              Files
            </TabsTrigger>
            <TabsTrigger value="terminal" className="text-[10px]">
              Term
            </TabsTrigger>
          </TabsList>

          <TabsContent value="agent" className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="zanto-panel mb-2 rounded-md p-2.5 text-xs">
              <div className="flex items-center gap-2">
                <span className={agent ? "zanto-online-dot" : "size-2 rounded-full bg-muted-foreground/40"} />
                <span className="font-medium">{agent ? "Agent attivo" : "Agent spento"}</span>
              </div>
              <p className="mt-1 text-muted-foreground">
                {busy
                  ? "Esecuzione in corso…"
                  : agent
                    ? `Fino a 8 step tool · ${allowedTools.length} tool autorizzati`
                    : "Modalità chat semplice, nessun tool."}
              </p>
            </div>
            <ul className="space-y-1.5">
              {tools.map((tool) => (
                <li
                  key={tool.id}
                  className="flex items-center gap-2 rounded-md border border-border/80 bg-card/60 px-2 py-1.5 text-[11px]"
                >
                  <Wrench className="size-3 text-primary" />
                  <span className="font-mono">{tool.name}</span>
                  <Badge
                    variant={tool.status === "error" ? "destructive" : "secondary"}
                    className="ml-auto text-[9px]"
                  >
                    {tool.status}
                  </Badge>
                </li>
              ))}
              {activity.slice(0, 12).map((row) => (
                <li
                  key={row.id}
                  className="rounded-md border border-border/70 bg-card/50 p-2 text-[11px]"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px]">
                      {row.kind}
                    </Badge>
                    <span className="text-muted-foreground">
                      {new Date(row.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{row.message}</p>
                </li>
              ))}
              {activity.length === 0 && tools.length === 0 && (
                <li className="p-2 text-[11px] text-muted-foreground">Nessuna attività.</li>
              )}
            </ul>
          </TabsContent>

          <TabsContent value="tools" className="min-h-0 flex-1 overflow-y-auto p-2">
            <ul className="space-y-1">
              {TOOLS.map((tool) => {
                const on = allowedTools.includes(tool.name);
                return (
                  <li
                    key={tool.name}
                    className="flex items-center gap-2 rounded-md border border-border/70 px-2 py-1.5 text-[11px]"
                  >
                    <span className={`size-1.5 rounded-full ${on ? "bg-primary" : "bg-muted-foreground/30"}`} />
                    <span className="font-mono">{tool.name}</span>
                    <span className="ml-auto text-muted-foreground">{on ? "on" : "off"}</span>
                  </li>
                );
              })}
            </ul>
          </TabsContent>

          <TabsContent value="files" className="min-h-0 flex-1 overflow-hidden p-2">
            <FileExplorer workspaceId={workspaceId} compact />
          </TabsContent>

          <TabsContent value="terminal" className="min-h-0 flex-1 overflow-y-auto p-3 text-[11px] text-muted-foreground">
            Terminale di sistema non disponibile in ambiente browser/edge. Nessuna simulazione.
          </TabsContent>
        </Tabs>
      </aside>
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
    <div className="zanto-enter flex gap-3">
      <span
        className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-border/80 ${
          isUser
            ? "bg-primary text-primary-foreground shadow-[0_0_12px_var(--zanto-glow)]"
            : "bg-card text-foreground"
        }`}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        {parts.length > 0 && (
          <ul className="mb-2 space-y-1">
            {parts.map((tool) => (
              <li
                key={tool.id}
                className="flex items-center gap-2 rounded-md border border-border/80 bg-card/70 px-2 py-1 text-xs"
              >
                <Wrench className="size-3 text-primary" />
                <span className="font-mono">{tool.name}</span>
                <Badge
                  variant={tool.status === "error" ? "destructive" : "secondary"}
                  className="ml-auto text-[10px]"
                >
                  {tool.status === "running"
                    ? "in corso"
                    : tool.status === "done"
                      ? "completato"
                      : "errore"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {isUser ? (
          <div className="inline-block whitespace-pre-wrap rounded-lg bg-primary/90 px-3 py-2 text-sm text-primary-foreground">
            {content}
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {content}
            {streaming && !content && (
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin text-primary" /> sto pensando…
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
