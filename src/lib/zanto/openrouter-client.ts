/**
 * Browser-side OpenRouter chat. Used on hosts (e.g. Lovable) that may strip
 * outbound Authorization headers from server fetches, causing false "invalid key".
 */
import type { StreamHandlers } from "./chat-client";

type OpenRouterMessage = { role: "user" | "assistant" | "system"; content: string };

/** Rotate across free models when one provider is saturated (not for account daily quota). */
const FALLBACK_MODELS = [
  "openrouter/free",
  "cohere/north-mini-code:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-4b-it:free",
  "qwen/qwen3-4b:free",
];

const ATTEMPT_MS = 40_000;

function isAccountQuotaError(raw: string): boolean {
  const d = raw.toLowerCase();
  return (
    /\b429\b/.test(d) ||
    d.includes("rate limit") ||
    d.includes("rate-limit") ||
    d.includes("too many requests") ||
    d.includes("free-models-per-day") ||
    d.includes("free_models_per_day") ||
    d.includes("daily limit") ||
    d.includes("requests per day") ||
    d.includes("key limit") ||
    (d.includes("quota") && d.includes("free"))
  );
}

function isProviderSaturated(raw: string): boolean {
  const d = raw.toLowerCase();
  return (
    d.includes("provider returned error") ||
    d.includes("no endings") ||
    d.includes("no available provider") ||
    d.includes("unavailable") ||
    d.includes("capacity") ||
    d.includes("overloaded") ||
    d.includes("timed out") ||
    d.includes("timeout")
  );
}

export function humanizeOpenRouterError(raw: string): string {
  const detail = raw.toLowerCase();

  if (isAccountQuotaError(raw)) {
    return (
      "Limite OpenRouter FREE esaurito (~50 richieste/giorno, condiviso da TUTTI i modelli free). " +
      "Cambiare modello free NON serve. Aspetta il reset (mezzanotte UTC), oppure: " +
      "Agent OFF + meno messaggi, Ollama sul PC, Gemini diretto, o ricarica ≥$10 su openrouter.ai per alzare il tetto a ~1000/giorno. " +
      "Nota: Agent ON e i retry contano come più richieste."
    );
  }

  if (isProviderSaturated(raw) || detail.includes("aborted")) {
    return (
      "Quel modello free è saturo in questo momento. Prova Free router, oppure Ollama / Gemini. " +
      "Se succede con tutti i free, probabilmente hai finito le 50 req/giorno."
    );
  }

  if (
    detail.includes("401") ||
    detail.includes("403") ||
    detail.includes("user not found") ||
    detail.includes("invalid") ||
    detail.includes("unauthorized")
  ) {
    return "OpenRouter rifiuta la chiave. Providers → Rimuovi → incolla sk-or-v1-… → Salva → Testa chiave.";
  }

  return raw;
}

export async function probeOpenRouterKey(apiKey: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return { ok: true, detail: "Chiave OpenRouter valida" };
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      detail: humanizeOpenRouterError(`OpenRouter ${res.status}: ${body.slice(0, 180) || res.statusText}`),
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Rete bloccata verso openrouter.ai",
    };
  }
}

/** Optional: read remaining free quota from OpenRouter key endpoint. */
export async function probeOpenRouterQuota(
  apiKey: string,
): Promise<{ ok: boolean; label: string }> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return { ok: false, label: humanizeOpenRouterError(`OpenRouter ${res.status}`) };
    }
    const json = (await res.json()) as {
      data?: {
        limit_remaining?: number | null;
        usage?: number;
        limit?: number | null;
        is_free_tier?: boolean;
      };
    };
    const data = json.data;
    if (!data) return { ok: true, label: "Chiave OK" };
    const rem = data.limit_remaining;
    if (typeof rem === "number") {
      return {
        ok: rem > 0,
        label:
          rem <= 0
            ? "Credito/limite chiave esaurito su OpenRouter"
            : `Chiave OK · rimanente ~${rem.toFixed(4)}`,
      };
    }
    return {
      ok: true,
      label: data.is_free_tier
        ? "Chiave OK · piano free (~50 req/giorno totali sui modelli :free)"
        : "Chiave OK",
    };
  } catch (error) {
    return {
      ok: false,
      label: error instanceof Error ? error.message : "Impossibile leggere quota OpenRouter",
    };
  }
}

function mergeSignals(parent: AbortSignal, ms: number): { signal: AbortSignal; cancel: () => void } {
  const local = new AbortController();
  const timer = setTimeout(() => local.abort(), ms);
  const onParent = () => local.abort();
  parent.addEventListener("abort", onParent, { once: true });
  const cancel = () => {
    clearTimeout(timer);
    parent.removeEventListener("abort", onParent);
  };
  return { signal: local.signal, cancel };
}

async function streamOnce(opts: {
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  handlers: StreamHandlers;
  signal: AbortSignal;
}): Promise<{ ok: boolean; error?: string; gotText: boolean; status?: number }> {
  const { signal, cancel } = mergeSignals(opts.signal, ATTEMPT_MS);
  try {
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
        messages: opts.messages,
        stream: true,
      }),
      signal,
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
      return { ok: false, error: message, gotText: false, status: res.status };
    }

    if (!res.body) return { ok: false, error: "OpenRouter: risposta vuota", gotText: false };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let gotText = false;

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
            return { ok: false, error: json.error.message, gotText };
          }
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            gotText = true;
            opts.handlers.onText(delta);
          }
        } catch {
          /* ignore partial SSE */
        }
      }
    }

    return { ok: true, gotText };
  } catch (error) {
    if (signal.aborted && !opts.signal.aborted) {
      return { ok: false, error: `Timeout su ${opts.model}`, gotText: false };
    }
    throw error;
  } finally {
    cancel();
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

  const queue = [
    opts.model,
    ...FALLBACK_MODELS.filter((m) => m !== opts.model),
  ].slice(0, 4);

  let lastError = "OpenRouter non ha risposto";
  for (const model of queue) {
    if (opts.signal.aborted) return;

    const result = await streamOnce({
      apiKey: opts.apiKey,
      model,
      messages,
      handlers: opts.handlers,
      signal: opts.signal,
    });

    if (result.ok && result.gotText) return;

    if (result.ok && !result.gotText) {
      lastError = `Modello ${model} ha chiuso senza testo (spesso free saturo).`;
      continue;
    }

    lastError = result.error ?? lastError;

    // Account daily/minute quota: changing free model never helps — stop immediately.
    if (result.status === 429 || isAccountQuotaError(lastError)) {
      opts.handlers.onError(humanizeOpenRouterError(lastError));
      return;
    }

    const soft = isProviderSaturated(lastError) || /timeout|aborted/i.test(lastError);
    if (!soft) {
      opts.handlers.onError(humanizeOpenRouterError(lastError));
      return;
    }
  }

  opts.handlers.onError(humanizeOpenRouterError(lastError));
}
