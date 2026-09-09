/**
 * Groq remote inference from the browser (RAM on Groq servers).
 * Chat + Agent with VFS tools — same pattern as OpenRouter client agent.
 */
import type { StreamHandlers, ToolActivity } from "./chat-client";
import { listMemory, listNodes, saveMemory, writeFile } from "./db";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_STEPS = 8;

type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

const TOOLS = [
  {
    type: "function",
    function: {
      name: "vfs_list",
      description: "Elenca i file del filesystem virtuale del workspace.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "vfs_read",
      description: "Legge un file virtuale.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vfs_write",
      description: "Crea o sovrascrive un file. Percorsi assoluti tipo /index.html",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_list",
      description: "Elenca le note di memoria.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_save",
      description: "Salva una nota in memoria.",
      parameters: {
        type: "object",
        properties: { label: { type: "string" }, body: { type: "string" } },
        required: ["label", "body"],
        additionalProperties: false,
      },
    },
  },
] as const;

export function humanizeGroqError(raw: string): string {
  const d = raw.toLowerCase();
  if (d.includes("401") || d.includes("invalid") || d.includes("unauthorized")) {
    return "Chiave Groq non valida. Providers → Groq → incolla una chiave gsk_… da https://console.groq.com/keys";
  }
  if (d.includes("429") || d.includes("rate limit") || d.includes("too many")) {
    return "Limite Groq raggiunto (piano free). Aspetta un minuto o usa Ollama in locale.";
  }
  if (d.includes("model") && (d.includes("not found") || d.includes("decommissioned"))) {
    return "Modello Groq non disponibile. Seleziona Llama 3.1 8B Instant o Llama 3.3 70B.";
  }
  return raw;
}

export async function probeGroqKey(apiKey: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return { ok: true, detail: "Chiave Groq valida — server remoto pronto" };
    const body = await res.text().catch(() => "");
    return { ok: false, detail: humanizeGroqError(`Groq ${res.status}: ${body.slice(0, 160)}`) };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Rete bloccata verso api.groq.com",
    };
  }
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  workspaceId: string,
): Promise<unknown> {
  switch (name) {
    case "vfs_list": {
      const nodes = await listNodes(workspaceId);
      return { nodes: nodes.map((n) => ({ path: n.path, kind: n.kind })) };
    }
    case "vfs_read": {
      const path = String(args.path ?? "");
      const nodes = await listNodes(workspaceId);
      const hit = nodes.find((n) => n.path === path);
      if (!hit) return { error: `File non trovato: ${path}` };
      return { path: hit.path, kind: hit.kind, content: hit.content ?? "" };
    }
    case "vfs_write": {
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      if (!path.startsWith("/")) return { error: "Il path deve iniziare con /" };
      const node = await writeFile(workspaceId, path, content);
      return { ok: true, path: node.path };
    }
    case "memory_list": {
      const notes = await listMemory(workspaceId);
      return { notes: notes.map((n) => ({ label: n.label, body: n.body })) };
    }
    case "memory_save": {
      const note = await saveMemory(workspaceId, String(args.label ?? ""), String(args.body ?? ""));
      return { ok: true, id: note.id };
    }
    default:
      return { error: `Tool sconosciuto: ${name}` };
  }
}

export async function streamGroqChat(opts: {
  apiKey: string;
  model: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  system?: string;
  handlers: StreamHandlers;
  signal: AbortSignal;
}): Promise<void> {
  const messages = opts.system
    ? [{ role: "system" as const, content: opts.system }, ...opts.messages]
    : opts.messages;

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      stream: true,
      temperature: 0.4,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = `Groq ${res.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      if (body) message = body.slice(0, 240);
    }
    opts.handlers.onError(humanizeGroqError(message));
    return;
  }

  if (!res.body) {
    opts.handlers.onError("Groq: risposta vuota");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let got = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
          error?: { message?: string };
        };
        if (json.error?.message) {
          opts.handlers.onError(humanizeGroqError(json.error.message));
          return;
        }
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          got = true;
          opts.handlers.onText(delta);
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (!got) opts.handlers.onError("Groq non ha prodotto testo. Prova Llama 3.1 8B Instant.");
}

export async function streamGroqAgent(opts: {
  apiKey: string;
  model: string;
  workspaceId: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  handlers: StreamHandlers;
  signal: AbortSignal;
}): Promise<void> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "Sei ZAnto.AI su Groq (server remoto) con strumenti REALI sul filesystem virtuale.",
        "Se l'utente chiede di creare/modificare un file, DEVI chiamare subito vfs_write.",
        "Non dire che non puoi. Non suggerire bash. Dopo vfs_write conferma il path. Italiano.",
      ].join(" "),
    },
    ...opts.messages,
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    if (opts.signal.aborted) return;

    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        stream: false,
        temperature: 0.2,
      }),
      signal: opts.signal,
    });

    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      opts.handlers.onError(humanizeGroqError(bodyText || `Groq ${res.status}`));
      return;
    }

    let data: {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: {
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          }[];
        };
      }[];
      error?: { message?: string };
    };
    try {
      data = JSON.parse(bodyText);
    } catch {
      opts.handlers.onError("Groq: risposta non JSON");
      return;
    }

    if (data.error?.message) {
      opts.handlers.onError(humanizeGroqError(data.error.message));
      return;
    }

    const message = data.choices?.[0]?.message;
    if (!message) {
      opts.handlers.onError("Groq: nessuna scelta nella risposta");
      return;
    }

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      const text = (message.content ?? "").trim();
      if (text) opts.handlers.onText(text);
      else
        opts.handlers.onError(
          "Groq non ha usato i tool. Agent ON + Llama 3.3 70B, oppure chiedi: crea /index.html",
        );
      return;
    }

    messages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      if (opts.signal.aborted) return;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }

      const activity: ToolActivity = {
        id: call.id,
        name: call.function.name,
        status: "running",
        input: args,
      };
      opts.handlers.onTool(activity);

      let output: unknown;
      try {
        output = await runTool(call.function.name, args, opts.workspaceId);
        opts.handlers.onTool({ ...activity, status: "done", output });
      } catch (error) {
        output = { error: error instanceof Error ? error.message : String(error) };
        opts.handlers.onTool({ ...activity, status: "error", output });
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(output),
      });
    }
  }

  opts.handlers.onText(
    "\n\n⚠️ Limite step Agent Groq. Controlla i file; se manca qualcosa scrivi «continua».",
  );
}
