/**
 * Local Ollama Agent — works with small models (3B) that ignore OpenAI tool-calling.
 * Uses an explicit tag protocol the model can follow, then writes to VFS in the browser.
 */
import type { StreamHandlers, ToolActivity } from "./chat-client";
import { listNodes, writeFile } from "./db";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const MAX_STEPS = 6;

const SYSTEM = [
  "Sei ZAnto.AI Agent locale. Italiano.",
  "Niente internet. Solo file del progetto.",
  "OBBLIGATORIO: per creare file usa SOLO questo formato, nient'altro prima:",
  '<<<vfs_write path="/index.html">>>',
  "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Ciao</title></head><body><h1>Ciao mondo</h1></body></html>",
  "<<<end>>>",
  "Poi una riga: creato /index.html",
  "Se chiedono un sito/pagina/app: SEMPRE scrivi almeno /index.html con i tag sopra.",
  "VIETATO rispondere solo a parole senza i tag <<<vfs_write>>> <<<end>>>",
].join("\n");

function toolId(): string {
  return crypto.randomUUID();
}

function parseWrites(text: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const re =
    /<<<vfs_write\s+path=["']([^"']+)["']\s*>>>([\s\S]*?)<<<end>>>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ path: m[1]!.trim(), content: m[2]!.replace(/^\n/, "").replace(/\n$/, "") });
  }
  return out;
}

function wantsList(text: string): boolean {
  return /<<<vfs_list>>>/i.test(text);
}

function parseReads(text: string): string[] {
  const out: string[] = [];
  const re = /<<<vfs_read\s+path=["']([^"']+)["']\s*>>>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]!.trim());
  return out;
}

/** Fallback: extract fenced html/css/js if the model forgot tags. */
function extractFencedFiles(text: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const re = /```(\w+)?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let htmlCount = 0;
  while ((m = re.exec(text))) {
    const lang = (m[1] || "").toLowerCase();
    const body = m[2]!.trim();
    if (!body) continue;
    if (lang === "html" || (!lang && /<!doctype html|<html[\s>]/i.test(body))) {
      htmlCount += 1;
      out.push({
        path: htmlCount === 1 ? "/index.html" : `/page-${htmlCount}.html`,
        content: body,
      });
    } else if (lang === "css") {
      out.push({ path: "/styles.css", content: body });
    } else if (lang === "js" || lang === "javascript") {
      out.push({ path: "/app.js", content: body });
    }
  }
  return out;
}

async function ollamaChat(opts: {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  signal: AbortSignal;
}): Promise<string> {
  const base = opts.baseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: false,
      options: { temperature: 0.2, num_predict: 4096 },
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      body ||
        `Ollama ${res.status}. Verifica che Ollama sia avviato e che il modello sia scaricato (ollama list).`,
    );
  }
  const data = (await res.json()) as { message?: { content?: string }; error?: string };
  if (data.error) throw new Error(data.error);
  return (data.message?.content ?? "").trim();
}

export async function streamOllamaAgent(opts: {
  baseUrl?: string;
  model: string;
  workspaceId: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  handlers: StreamHandlers;
  signal: AbortSignal;
}): Promise<void> {
  const baseUrl = opts.baseUrl?.trim() || "http://127.0.0.1:11434";
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    ...opts.messages.map((m) => ({
      role: m.role === "system" ? ("user" as const) : m.role,
      content: m.content,
    })),
  ];

  let wroteAny = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (opts.signal.aborted) return;

    let reply: string;
    try {
      reply = await ollamaChat({
        baseUrl,
        model: opts.model,
        messages,
        signal: opts.signal,
      });
    } catch (error) {
      opts.handlers.onError(error instanceof Error ? error.message : String(error));
      return;
    }

    if (!reply) {
      opts.handlers.onError("Ollama non ha risposto. Prova llama3.2:1b o riavvia Ollama.");
      return;
    }

    let writes = parseWrites(reply);
    const reads = parseReads(reply);
    const list = wantsList(reply);

    if (writes.length === 0 && !list && reads.length === 0) {
      writes = extractFencedFiles(reply);
    }

    // Strip protocol tags from what we show the user
    const visible = reply
      .replace(/<<<vfs_write\s+path=["'][^"']+["']\s*>>>[\s\S]*?<<<end>>>/gi, "")
      .replace(/<<<vfs_read\s+path=["'][^"']+["']\s*>>>/gi, "")
      .replace(/<<<vfs_list>>>/gi, "")
      .trim();

    if (visible) opts.handlers.onText((step > 0 ? "\n" : "") + visible);

    if (writes.length === 0 && !list && reads.length === 0) {
      // Model finished talking without tools
      if (!wroteAny) {
        opts.handlers.onText(
          "\n\n⚠️ Il modello non ha creato file. Riprova con Agent ON e chiedi esplicitamente: «crea /index.html con una pagina ciao mondo». Oppure usa llama3.2:latest.",
        );
      }
      return;
    }

    const toolResults: string[] = [];

    if (list) {
      const id = toolId();
      const activity: ToolActivity = { id, name: "vfs_list", status: "running" };
      opts.handlers.onTool(activity);
      try {
        const nodes = await listNodes(opts.workspaceId);
        const paths = nodes.map((n) => `${n.kind} ${n.path}`).join("\n") || "(vuoto)";
        opts.handlers.onTool({ ...activity, status: "done", output: { count: nodes.length } });
        toolResults.push(`vfs_list:\n${paths}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        opts.handlers.onTool({ ...activity, status: "error", output: { error: msg } });
        toolResults.push(`vfs_list errore: ${msg}`);
      }
    }

    for (const path of reads) {
      const id = toolId();
      const activity: ToolActivity = {
        id,
        name: "vfs_read",
        status: "running",
        input: { path },
      };
      opts.handlers.onTool(activity);
      try {
        const nodes = await listNodes(opts.workspaceId);
        const node = nodes.find((n) => n.path === path);
        const content = node?.content ?? "";
        opts.handlers.onTool({
          ...activity,
          status: "done",
          output: { path, bytes: content.length },
        });
        toolResults.push(`vfs_read ${path}:\n${content.slice(0, 4000)}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        opts.handlers.onTool({ ...activity, status: "error", output: { error: msg } });
        toolResults.push(`vfs_read ${path} errore: ${msg}`);
      }
    }

    for (const w of writes) {
      const path = w.path.startsWith("/") ? w.path : `/${w.path}`;
      const id = toolId();
      const activity: ToolActivity = {
        id,
        name: "vfs_write",
        status: "running",
        input: { path },
      };
      opts.handlers.onTool(activity);
      try {
        await writeFile(opts.workspaceId, path, w.content);
        wroteAny = true;
        opts.handlers.onTool({
          ...activity,
          status: "done",
          output: { path, bytes: w.content.length },
        });
        toolResults.push(`OK scritto ${path} (${w.content.length} caratteri)`);
        opts.handlers.onText(`\n✓ creato ${path}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        opts.handlers.onTool({ ...activity, status: "error", output: { error: msg } });
        toolResults.push(`ERRORE ${path}: ${msg}`);
      }
    }

    // If only writes and no further questions, stop — small models often loop
    if (writes.length > 0 && !list && reads.length === 0) {
      opts.handlers.onText("\n\nCreazione locale completata. Apri Anteprima.");
      return;
    }

    messages.push({ role: "assistant", content: reply });
    messages.push({
      role: "user",
      content: `Risultato tool:\n${toolResults.join("\n")}\nSe hai finito, conferma in una riga. Se manca qualcosa, usa di nuovo i tag <<<vfs_write>>>.`,
    });
  }

  opts.handlers.onText(
    "\n\n⚠️ Limite step Agent locale. Controlla i file a sinistra; se manca qualcosa scrivi «continua».",
  );
}

/** Simple local chat (no tools) — direct to Ollama, bypasses server tool-calling. */
export async function streamOllamaChat(opts: {
  baseUrl?: string;
  model: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  handlers: StreamHandlers;
  signal: AbortSignal;
}): Promise<void> {
  const base = (opts.baseUrl?.trim() || "http://127.0.0.1:11434").replace(/\/$/, "");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Sei ZAnto.AI. Rispondi in italiano. Per creare file l'utente deve attivare Agent. Non inventare ricerche web.",
    },
    ...opts.messages.map((m) => ({
      role: (m.role === "system" ? "user" : m.role) as "user" | "assistant",
      content: m.content,
    })),
  ];

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages,
      stream: true,
      options: { temperature: 0.4, num_predict: 2048 },
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    opts.handlers.onError(
      body ||
        `Ollama ${res.status}. Avvia Ollama e verifica il modello (ollama list).`,
    );
    return;
  }
  if (!res.body) {
    opts.handlers.onError("Ollama: stream vuoto");
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
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line) as {
          message?: { content?: string };
          error?: string;
        };
        if (json.error) {
          opts.handlers.onError(json.error);
          return;
        }
        const delta = json.message?.content;
        if (delta) {
          got = true;
          opts.handlers.onText(delta);
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (!got) opts.handlers.onError("Ollama non ha prodotto testo. Prova llama3.2:latest.");
}
