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
  const [agent, setAgent] = useState(true);
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
          onError: (message) => toast.error(message),
        },
        controller.signal,
      );
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast.error((error as Error).message);
    }

    if (assembled.trim() || collected.length > 0) {
      await addMessage(
        conversationId,
        "assistant",
        assembled || "(interrotto)",
        collected as unknown[],
      );
    }
    setStreamText("");
    setBusy(false);
    abortRef.current = null;
    void queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
    void queryClient.invalidateQueries({ queryKey: ["vfs", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["activity", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["memory", workspaceId] });
  };

  if (loading || !workspaceId) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Preparo il workspace…
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Panel 1: conversations */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Conversazioni
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto"
            title="Nuova conversazione"
            onClick={() => newConversation.mutate()}
          >
            <Plus className="size-4" />
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
              className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
                convoId === convo.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/50"
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

      {/* Panel 2: chat */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Select
            value={provider}
            onValueChange={(value) => {
              setProvider(value);
              const first = getProvider(value)?.models[0]?.id;
              if (first) setModel(first);
            }}
          >
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(providerInfo?.models ?? []).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger className="h-8 w-[110px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Badge variant="outline" className="text-xs">
            runtime: {providerInfo?.runtime ?? "cloud"}
          </Badge>

          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="agent-toggle" className="text-xs text-muted-foreground">
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
        </div>

        {!configured && (
          <div className="flex items-start gap-2 border-b border-border bg-destructive/10 px-3 py-2 text-xs text-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span>
              {providerInfo?.label} non è configurato. Aggiungi le credenziali nella pagina Providers:
              ZAnto.AI non simula risposte.
            </span>
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.length === 0 && !streamText && (
              <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
                <p className="font-display text-base font-semibold text-foreground">
                  Inizia una conversazione
                </p>
                <p className="mt-1">
                  L'agente può leggere e scrivere nel filesystem virtuale del workspace e salvare
                  note di memoria, usando solo i tool autorizzati.
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

        <div className="border-t border-border px-3 py-3 md:px-6">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="Scrivi un messaggio…  (Invio per inviare, Shift+Invio per andare a capo)"
              className="max-h-40 min-h-[52px] flex-1 resize-none"
            />
            {busy ? (
              <Button variant="destructive" className="gap-1.5" onClick={stop}>
                <Square className="size-4" /> Stop
              </Button>
            ) : (
              <Button className="gap-1.5" onClick={() => void send()} disabled={!input.trim()}>
                <SendHorizontal className="size-4" /> Invia
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Panel 3: files + activity */}
      <aside className="hidden w-[22rem] shrink-0 flex-col border-l border-border bg-sidebar xl:flex">
        <Tabs defaultValue="files" className="flex min-h-0 flex-1 flex-col gap-0">
          <TabsList className="m-2">
            <TabsTrigger value="files">File</TabsTrigger>
            <TabsTrigger value="activity">Attività</TabsTrigger>
          </TabsList>
          <TabsContent value="files" className="min-h-0 flex-1 overflow-hidden p-2">
            <FileExplorer workspaceId={workspaceId} compact />
          </TabsContent>
          <TabsContent value="activity" className="min-h-0 flex-1 overflow-y-auto p-2">
            <ul className="space-y-2">
              {activity.map((row) => (
                <li key={row.id} className="rounded-md border border-border bg-card p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {row.kind}
                    </Badge>
                    <span className="text-muted-foreground">
                      {new Date(row.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="mt-1">{row.message}</p>
                </li>
              ))}
              {activity.length === 0 && (
                <li className="p-2 text-xs text-muted-foreground">Nessuna attività registrata.</li>
              )}
            </ul>
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
    <div className="flex gap-3">
      <span
        className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-border ${
          isUser ? "bg-primary text-primary-foreground" : "bg-card text-foreground"
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
                className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-xs"
              >
                <Wrench className="size-3 text-muted-foreground" />
                <span className="font-mono">{tool.name}</span>
                <Badge
                  variant={tool.status === "error" ? "destructive" : "secondary"}
                  className="ml-auto text-[10px]"
                >
                  {tool.status === "running" ? "in corso" : tool.status === "done" ? "completato" : "errore"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {isUser ? (
          <div className="inline-block whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
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
