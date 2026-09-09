/**
 * Browser-side OpenRouter Agent: tool calls run in the client against Supabase VFS.
 * Avoids Lovable server stripping Authorization on outbound OpenRouter calls.
 */
import type { StreamHandlers, ToolActivity } from "./chat-client";
import { listMemory, listNodes, saveMemory, writeFile } from "./db";
import { humanizeOpenRouterError } from "./openrouter-client";

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

const OPENROUTER_TOOLS = [
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
      description: "Crea o sovrascrive un file nel filesystem virtuale. Usa percorsi assoluti tipo /ciao.txt",
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
      description: "Elenca le note di memoria del workspace.",
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
        properties: {
          label: { type: "string" },
          body: { type: "string" },
        },
        required: ["label", "body"],
        additionalProperties: false,
      },
    },
  },
] as const;

const MAX_STEPS = 8;

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
      const path = String(args['path'] ?? "");
      const nodes = await listNodes(workspaceId);
      const hit = nodes.find((n) => n.path === path);
      if (!hit) return { error: `File non trovato: ${path}` };
      return { path: hit.path, kind: hit.kind, content: hit.content ?? "" };
    }
    case "vfs_write": {
      const path = String(args['path'] ?? "");
      const content = String(args['content'] ?? "");
      if (!path.startsWith("/")) return { error: "Il path deve iniziare con /" };
      const node = await writeFile(workspaceId, path, content);
      return { ok: true, path: node.path };
    }
    case "memory_list": {
      const notes = await listMemory(workspaceId);
      return { notes: notes.map((n) => ({ label: n.label, body: n.body })) };
    }
    case "memory_save": {
      const note = await saveMemory(workspaceId, String(args['label'] ?? ""), String(args['body'] ?? ""));
      return { ok: true, id: note.id };
    }
    default:
      return { error: `Tool sconosciuto: ${name}` };
  }
}

export async function streamOpenRouterAgent(opts: {
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
        "Sei ZAnto.AI con strumenti REALI sul filesystem virtuale del workspace.",
        "Se l'utente chiede di creare/modificare un file, DEVI chiamare subito vfs_write.",
        "Non dire che non puoi creare file. Non suggerire comandi bash/terminal.",
        "Dopo vfs_write conferma in una riga il path creato. Rispondi in italiano.",
      ].join(" "),
    },
    ...opts.messages,
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    if (opts.signal.aborted) return;

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          typeof window !== "undefined" ? window.location.origin : "https://smart-workspace-core.lovable.app",
        "X-Title": "ZAnto.AI",
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        tools: OPENROUTER_TOOLS,
        tool_choice: "auto",
        stream: false,
      }),
      signal: opts.signal,
    });

    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      // Account quota: don't burn more steps retrying the same free key.
      opts.handlers.onError(humanizeOpenRouterError(bodyText || `OpenRouter ${res.status}`));
      return;
    }

    let data: {
      choices?: {
        message?: {
          role?: string;
          content?: string | null;
          tool_calls?: {
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          }[];
        };
        finish_reason?: string;
      }[];
      error?: { message?: string };
    };
    try {
      data = JSON.parse(bodyText);
    } catch {
      opts.handlers.onError("OpenRouter: risposta non JSON");
      return;
    }

    if (data.error?.message) {
      opts.handlers.onError(humanizeOpenRouterError(data.error.message));
      return;
    }

    const message = data.choices?.[0]?.message;
    if (!message) {
      opts.handlers.onError("OpenRouter: nessuna scelta nella risposta");
      return;
    }

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      const text = (message.content ?? "").trim();
      if (text) opts.handlers.onText(text);
      else
        opts.handlers.onError(
          "Il modello non ha usato i tool. Riprova con Agent ON e modello North Mini / Laguna, o usa Gemini.",
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
    "\n\n⚠️ Creazione incompleta: raggiunto il limite di step Agent. Controlla i file a sinistra: se manca qualcosa, invia «continua» (non serve riscrivere tutto il prompt).",
  );
}
