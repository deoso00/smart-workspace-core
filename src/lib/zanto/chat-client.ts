/**
 * Layer: Agent (client side). Streams the /api/chat NDJSON protocol with real
 * abort support. Stop cancels the HTTP request, which cancels generation.
 */
export type ToolActivity = {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  input?: unknown;
  output?: unknown;
};

export type StreamHandlers = {
  onText: (delta: string) => void;
  onTool: (activity: ToolActivity) => void;
  onError: (message: string) => void;
};

export type ChatRequest = {
  workspaceId: string;
  ownerKey: string;
  provider: string;
  model: string;
  mode: string;
  agent: boolean;
  allowedTools: string[];
  credential?: { apiKey?: string; baseUrl?: string };
  memory?: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
};

export async function streamChat(
  req: ChatRequest,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok || !res.body) {
    let message = `Errore ${res.status}`;
    try {
      const payload = (await res.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      /* keep status message */
    }
    handlers.onError(message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event: { t: string; v?: string; [k: string]: unknown };
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.t === "text") handlers.onText(String(event.v ?? ""));
      else if (event.t === "tool")
        handlers.onTool({
          id: String(event["id"] ?? crypto.randomUUID()),
          name: String(event["name"] ?? "tool"),
          status: (event["status"] as ToolActivity["status"]) ?? "running",
          input: event["input"],
          output: event["output"],
        });
      else if (event.t === "error") handlers.onError(String(event.v ?? "Errore sconosciuto"));
    }
  }
}
