/**
 * Browser-side OpenRouter chat. Used on hosts (e.g. Lovable) that may strip
 * outbound Authorization headers from server fetches, causing false "invalid key".
 */
import type { StreamHandlers } from "./chat-client";

type OpenRouterMessage = { role: "user" | "assistant" | "system"; content: string };

export async function probeOpenRouterKey(apiKey: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return { ok: true, detail: "Chiave OpenRouter valida" };
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      detail: `OpenRouter ${res.status}: ${body.slice(0, 180) || res.statusText}`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Rete bloccata verso openrouter.ai",
    };
  }
}

export async function streamOpenRouterChat(opts: {
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  system?: string;
  handlers: StreamHandlers;
  signal: AbortSignal;
}): Promise<void> {
  const messages = opts.system
    ? [{ role: "system" as const, content: opts.system }, ...opts.messages]
    : opts.messages;

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
      stream: true,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = `OpenRouter errore ${res.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } | string };
      if (typeof parsed.error === "string") message = parsed.error;
      else if (parsed.error?.message) message = parsed.error.message;
      else if (body) message = `${message}: ${body.slice(0, 240)}`;
    } catch {
      if (body) message = `${message}: ${body.slice(0, 240)}`;
    }
    if (res.status === 401 || res.status === 403) {
      message =
        "OpenRouter rifiuta la chiave (401). Crea una chiave nuova su https://openrouter.ai/keys, Providers → Rimuovi → incolla solo sk-or-v1-… → Salva.";
    }
    opts.handlers.onError(message);
    return;
  }

  if (!res.body) {
    opts.handlers.onError("OpenRouter: risposta vuota");
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
          opts.handlers.onError(json.error.message);
          return;
        }
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) opts.handlers.onText(delta);
      } catch {
        /* ignore partial SSE */
      }
    }
  }
}
