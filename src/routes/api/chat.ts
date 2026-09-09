import { createFileRoute } from "@tanstack/react-router";
import { streamText, tool, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import {
  createByoProvider,
  createGeminiProvider,
  createLovableAiGatewayProvider,
  sanitizeApiKey,
} from "@/lib/ai-gateway.server";
import {
  generateImage,
  generateGeminiVideo,
  slugFromPrompt,
  toDataUrl,
  IMAGE_MODEL,
  VIDEO_MODEL,
  NON_CHAT_MODEL_IDS,
} from "@/lib/media-gen.server";
import { createServerSupabase } from "@/lib/zanto/server-db.server";
import { writeVfsFileServer } from "@/lib/zanto/vfs.server";

type ChatBody = {
  workspaceId?: string;
  ownerKey?: string;
  provider?: string;
  model?: string;
  mode?: string;
  agent?: boolean;
  allowedTools?: string[];
  credential?: { apiKey?: string; baseUrl?: string };
  /** Gemini key for media tools even when chat uses another provider. */
  mediaCredential?: { apiKey?: string };
  messages?: { role: "user" | "assistant" | "system"; content: string }[];
  memory?: string;
};

const BYO_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

const DEFAULT_PROVIDER = "google";
const DEFAULT_MODEL = "gemini-3.7-flash";
const AGENT_MAX_STEPS = 8;
/** Lovable AI Gateway bills per call+tokens: keep Agent short and chats lean. */
const LOVABLE_AGENT_MAX_STEPS = 4;
const LOVABLE_MAX_OUTPUT_TOKENS = 2048;
const LOVABLE_HISTORY_LIMIT = 12;

function jsonLine(payload: unknown) {
  return new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
}

/** Clear provider errors without leaking secrets. */
function formatChatError(error: unknown): string {
  const nest =
    error && typeof error === "object" && "lastError" in error
      ? (error as { lastError: unknown }).lastError
      : error;
  const raw = nest instanceof Error ? nest.message : error instanceof Error ? error.message : String(error);
  const status =
    typeof (nest as { statusCode?: unknown })?.statusCode === "number"
      ? (nest as { statusCode: number }).statusCode
      : typeof (error as { statusCode?: unknown })?.statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : undefined;
  const body =
    (nest as { responseBody?: string })?.responseBody ||
    (error as { responseBody?: string })?.responseBody ||
    "";
  const detail = `${raw} ${body}`.toLowerCase();

  if (
    detail.includes("quota") ||
    detail.includes("rate limit") ||
    detail.includes("resource_exhausted") ||
    detail.includes("limit: 0") ||
    status === 429
  ) {
    return "Quota Gemini esaurita o modello media non disponibile in chat. Usa Media Studio per le immagini; per la chat tieni Gemini 3.7 Flash / OpenRouter / Ollama.";
  }
  if (detail.includes("not found") && detail.includes("veo")) {
    return "Veo non è un modello chat. Usa Media Studio → Genera video (serve billing Google).";
  }
  if (status === 429 || /\b429\b/.test(raw) || detail.includes("rate limit") || detail.includes("resource_exhausted")) {
    return "Limite di richieste raggiunto (rate limit). Aspetta un minuto e riprova, o cambia modello.";
  }
  if (
    status === 401 ||
    status === 403 ||
    detail.includes("api key") ||
    detail.includes("unauthorized") ||
    detail.includes("unauthenticated") ||
    detail.includes("user not found") ||
    /invalid.{0,20}key/i.test(detail)
  ) {
    return "Chiave API non valida. OpenRouter: Providers → Rimuovi → incolla di nuovo una chiave sk-or-v1-… da https://openrouter.ai/keys (senza spazi/virgolette), oppure metti OPENROUTER_API_KEY nel .env su GitHub.";
  }
  if (status === 402 || detail.includes("no credit") || detail.includes("payment required") || detail.includes("insufficient")) {
    return "Crediti Lovable AI Gateway esauriti. In ZAnto: Agent OFF + Flash Lite, oppure passa a Gemini diretto / OpenRouter / Ollama. I crediti Build (chat editor Lovable) sono un altro bilancio.";
  }
  if (detail.includes("provider returned error") || detail.includes("failed after")) {
    return "Modello free OpenRouter saturo. Spegni Agent, prova Free router / North Mini Code, o riprova tra un minuto.";
  }
  if (body && body.length < 400) return `${raw}: ${body}`;
  return raw;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as ChatBody;
        const messages = body.messages ?? [];
        if (messages.length === 0) {
          return new Response("Nessun messaggio", { status: 400 });
        }

        const providerId = body.provider ?? DEFAULT_PROVIDER;
        const modelId = body.model ?? DEFAULT_MODEL;

        if (NON_CHAT_MODEL_IDS.has(modelId) || /veo|flash-image|image-generation/i.test(modelId)) {
          return new Response(
            JSON.stringify({
              error:
                "Questo modello non serve per la chat. Usa Media Studio sotto il composer per immagini/video, e tieni Gemini 3.7 Flash / Laguna / Ollama per il testo.",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        let model;
        try {
          if (providerId === "google") {
            const key = body.credential?.apiKey?.trim() || process.env["GEMINI_API_KEY"];
            if (!key) {
              return new Response(
                JSON.stringify({
                  error:
                    "Gemini non configurato: inserisci la API key in Providers → Google Gemini.",
                }),
                { status: 400, headers: { "content-type": "application/json" } },
              );
            }
            model = createGeminiProvider(key)(modelId);
          } else if (providerId === "lovable") {
            const key = process.env["LOVABLE_API_KEY"];
            if (!key) {
              return new Response(
                JSON.stringify({ error: "Lovable AI non configurato su questo progetto." }),
                { status: 500, headers: { "content-type": "application/json" } },
              );
            }
            model = createLovableAiGatewayProvider(key)(modelId);
          } else if (providerId === "ollama") {
            const base = body.credential?.baseUrl?.trim() || "http://localhost:11434";
            model = createByoProvider("ollama", `${base.replace(/\/$/, "")}/v1`)(modelId);
          } else if (providerId === "openrouter") {
            const apiKey = sanitizeApiKey(
              body.credential?.apiKey || process.env["OPENROUTER_API_KEY"] || "",
            );
            if (!apiKey) {
              return new Response(
                JSON.stringify({
                  error:
                    "OpenRouter: manca la chiave. Aggiungi OPENROUTER_API_KEY nel .env (Lovable/Vercel) oppure incollala in Providers. Chiave gratis su https://openrouter.ai/keys",
                }),
                { status: 400, headers: { "content-type": "application/json" } },
              );
            }
            if (!apiKey.startsWith("sk-or-")) {
              return new Response(
                JSON.stringify({
                  error:
                    "OpenRouter: la chiave non inizia con sk-or-. Hai forse incollato una chiave Gemini (AIza...)? Usa una chiave da https://openrouter.ai/keys",
                }),
                { status: 400, headers: { "content-type": "application/json" } },
              );
            }
            model = createByoProvider("openrouter", BYO_BASE_URLS.openrouter, apiKey)(modelId);
          } else {
            const apiKey = body.credential?.apiKey;
            const base = BYO_BASE_URLS[providerId];
            if (!apiKey || !base) {
              return new Response(
                JSON.stringify({
                  error: `Provider "${providerId}" non configurato: chiave assente.`,
                }),
                { status: 400, headers: { "content-type": "application/json" } },
              );
            }
            model = createByoProvider(providerId, base, apiKey)(modelId);
          }
        } catch (error) {
          return new Response(JSON.stringify({ error: formatChatError(error) }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const workspaceId = body.workspaceId ?? null;
        const ownerKey = body.ownerKey ?? "guest";
        const allowed = new Set(body.allowedTools ?? []);
        const supabase = workspaceId ? createServerSupabase() : null;

        const allTools = {
          vfs_list: tool({
            description: "Elenca i percorsi del filesystem virtuale del workspace.",
            inputSchema: z.object({}),
            execute: async () => {
              if (!supabase || !workspaceId) return { error: "Workspace non disponibile" };
              const { data, error } = await supabase
                .from("vfs_nodes")
                .select("path, kind")
                .eq("workspace_id", workspaceId)
                .order("path");
              if (error) return { error: error.message };
              return { nodes: data ?? [] };
            },
          }),
          vfs_read: tool({
            description: "Legge il contenuto di un file virtuale dato il percorso assoluto.",
            inputSchema: z.object({ path: z.string() }),
            execute: async ({ path }) => {
              if (!supabase || !workspaceId) return { error: "Workspace non disponibile" };
              const { data, error } = await supabase
                .from("vfs_nodes")
                .select("path, content, kind")
                .eq("workspace_id", workspaceId)
                .eq("path", path)
                .maybeSingle();
              if (error) return { error: error.message };
              if (!data) return { error: `File non trovato: ${path}` };
              return data;
            },
          }),
          vfs_write: tool({
            description:
              "Crea o sovrascrive un file virtuale. Il percorso deve iniziare con /. Le cartelle mancanti vengono create.",
            inputSchema: z.object({ path: z.string(), content: z.string() }),
            execute: async ({ path, content }) => {
              if (!supabase || !workspaceId) return { error: "Workspace non disponibile" };
              const segments = path.split("/").filter(Boolean);
              let currentPath = "";
              let parentId: string | null = null;
              for (let i = 0; i < segments.length - 1; i++) {
                currentPath += `/${segments[i]}`;
                const found = await supabase
                  .from("vfs_nodes")
                  .select("id")
                  .eq("workspace_id", workspaceId)
                  .eq("path", currentPath)
                  .maybeSingle();
                if (found.data) {
                  parentId = found.data.id;
                } else {
                  const created: {
                    data: { id: string } | null;
                    error: { message: string } | null;
                  } = await supabase
                    .from("vfs_nodes")
                    .insert({
                      workspace_id: workspaceId,
                      owner_key: ownerKey,
                      parent_id: parentId,
                      kind: "folder",
                      name: segments[i]!,
                      path: currentPath,
                    })
                    .select("id")
                    .single();
                  if (created.error || !created.data) {
                    return { error: created.error?.message ?? "insert folder failed" };
                  }
                  parentId = created.data.id;
                }
              }
              const fullPath = `/${segments.join("/")}`;
              const existing = await supabase
                .from("vfs_nodes")
                .select("id")
                .eq("workspace_id", workspaceId)
                .eq("path", fullPath)
                .maybeSingle();
              if (existing.data) {
                const res = await supabase
                  .from("vfs_nodes")
                  .update({ content })
                  .eq("id", existing.data.id);
                if (res.error) return { error: res.error.message };
              } else {
                const res = await supabase.from("vfs_nodes").insert({
                  workspace_id: workspaceId,
                  owner_key: ownerKey,
                  parent_id: parentId,
                  kind: "file",
                  name: segments[segments.length - 1]!,
                  path: fullPath,
                  content,
                });
                if (res.error) return { error: res.error.message };
              }
              await supabase.from("activity_log").insert({
                workspace_id: workspaceId,
                owner_key: ownerKey,
                kind: "tool",
                message: `Agent ha scritto ${fullPath}`,
              });
              return { ok: true, path: fullPath, bytes: content.length };
            },
          }),
          memory_save: tool({
            description: "Salva una nota persistente nella memoria del workspace.",
            inputSchema: z.object({ label: z.string(), body: z.string() }),
            execute: async ({ label, body: noteBody }) => {
              if (!supabase || !workspaceId) return { error: "Workspace non disponibile" };
              const res = await supabase
                .from("memory_notes")
                .insert({ workspace_id: workspaceId, owner_key: ownerKey, label, body: noteBody });
              if (res.error) return { error: res.error.message };
              return { ok: true, label };
            },
          }),
          memory_list: tool({
            description: "Elenca le note di memoria del workspace.",
            inputSchema: z.object({}),
            execute: async () => {
              if (!supabase || !workspaceId) return { error: "Workspace non disponibile" };
              const { data, error } = await supabase
                .from("memory_notes")
                .select("label, body")
                .eq("workspace_id", workspaceId)
                .order("created_at", { ascending: false })
                .limit(50);
              if (error) return { error: error.message };
              return { notes: data ?? [] };
            },
          }),
          media_generate_image: tool({
            description:
              "Genera una VERA immagine raster (PNG/JPEG) e la salva in /media/. Usalo SEMPRE se l'utente chiede un'immagine/disegno/logo. MAI rispondere con ASCII art.",
            inputSchema: z.object({
              prompt: z.string().describe("Descrizione dell'immagine da generare"),
              path: z
                .string()
                .optional()
                .describe("Percorso assoluto opzionale, es. /media/logo.png"),
            }),
            execute: async ({ prompt, path }) => {
              if (!supabase || !workspaceId) return { error: "Workspace non disponibile" };
              const key =
                body.mediaCredential?.apiKey?.trim() ||
                (providerId === "google" ? body.credential?.apiKey?.trim() : undefined) ||
                process.env["GEMINI_API_KEY"];
              try {
                const image = await generateImage(prompt, key);
                const dataUrl = toDataUrl(image.mimeType, image.base64);
                const ext = image.mimeType.includes("png") ? "png" : "jpg";
                const dest =
                  path?.startsWith("/")
                    ? path
                    : `/media/${slugFromPrompt(prompt)}-${Date.now().toString(36)}.${ext}`;
                const written = await writeVfsFileServer(
                  supabase,
                  workspaceId,
                  ownerKey,
                  dest,
                  dataUrl,
                );
                if ("error" in written) return written;
                return {
                  ok: true,
                  path: written.path,
                  model: image.source === "gemini" ? "gemini-2.5-flash-image" : IMAGE_MODEL,
                  source: image.source,
                };
              } catch (error) {
                return { error: error instanceof Error ? error.message : String(error) };
              }
            },
          }),
          media_generate_video: tool({
            description:
              "Genera un video breve con Veo (richiede billing Google a pagamento) e lo salva in /media/.",
            inputSchema: z.object({
              prompt: z.string().describe("Descrizione del video"),
              path: z.string().optional().describe("Percorso assoluto opzionale"),
            }),
            execute: async ({ prompt, path }) => {
              if (!supabase || !workspaceId) return { error: "Workspace non disponibile" };
              const key =
                body.mediaCredential?.apiKey?.trim() ||
                (providerId === "google" ? body.credential?.apiKey?.trim() : undefined) ||
                process.env["GEMINI_API_KEY"];
              if (!key) {
                return {
                  error:
                    "Chiave Gemini assente: salvala in Providers → Google Gemini.",
                };
              }
              try {
                const video = await generateGeminiVideo(key, prompt);
                const stamp = Date.now().toString(36);
                let dest: string;
                let content: string;
                if (video.base64 && !video.tooLarge) {
                  dest = path?.startsWith("/") ? path : `/media/${slugFromPrompt(prompt)}-${stamp}.mp4`;
                  content = toDataUrl(video.mimeType, video.base64);
                } else {
                  dest = path?.startsWith("/")
                    ? path
                    : `/media/${slugFromPrompt(prompt)}-${stamp}.video.html`;
                  content = `<!DOCTYPE html><html lang="it"><body><h1>Video Veo</h1><p>${prompt.replace(/</g, "&lt;")}</p><p>URI: ${video.uri ?? ""}</p><p>Modello ${VIDEO_MODEL} — richiede billing.</p></body></html>`;
                }
                const written = await writeVfsFileServer(
                  supabase,
                  workspaceId,
                  ownerKey,
                  dest,
                  content,
                );
                if ("error" in written) return written;
                return {
                  ok: true,
                  path: written.path,
                  model: VIDEO_MODEL,
                  tooLarge: Boolean(video.tooLarge || !video.base64),
                };
              } catch (error) {
                return { error: error instanceof Error ? error.message : String(error) };
              }
            },
          }),
        };

        const tools = Object.fromEntries(
          Object.entries(allTools).filter(([name]) => allowed.has(name)),
        );
        const useAgent = Boolean(body.agent) && Object.keys(tools).length > 0;
        const isLovable = providerId === "lovable";
        const agentStepLimit = isLovable ? LOVABLE_AGENT_MAX_STEPS : AGENT_MAX_STEPS;
        const historyMessages = isLovable ? messages.slice(-LOVABLE_HISTORY_LIMIT) : messages;
        const memorySnippet =
          body.memory && isLovable
            ? body.memory.slice(0, 1200)
            : body.memory
              ? body.memory
              : "";

        const system = [
          "Sei ZAnto.AI, un assistente AI personale che lavora dentro un workspace con filesystem virtuale.",
          "Rispondi in italiano se l'utente scrive in italiano. Sii concreto e onesto: non inventare risultati di strumenti.",
          "VIETATO disegnare in ASCII art, emoji-art o fingere un'immagine in testo. Non sei un generatore di immagini in chat.",
          isLovable
            ? "Risposte brevi e utili: evita ripetizioni e lunghi riassunti inutili (risparmio crediti gateway)."
            : "",
          useAgent
            ? [
                "Modalità Agent attiva: hai strumenti reali (vfs_list, vfs_read, vfs_write, memory_save, memory_list, media_generate_image, media_generate_video).",
                "Quando l'utente chiede di creare o modificare file, CHIAMA subito vfs_write: non narrare i passi, non dire 'ti prego di aspettare', non fingere di scrivere.",
                "Se l'utente chiede un'immagine, un disegno, un logo, una foto o una illustrazione: CHIAMA subito media_generate_image con il prompt. Non scrivere ASCII, non descrivere pixel, non dire 'ecco il disegno'.",
                "Per video: media_generate_video (richiede billing Google). Se fallisce, dillo chiaramente.",
                "Percorsi assoluti che iniziano con / (es. /index.html). Dopo il tool, conferma breve con il path scritto.",
                isLovable
                  ? "Su Lovable: massimo pochi tool call; preferisci 1–2 scritture mirate invece di molti round-trip."
                  : "",
              ]
                .filter(Boolean)
                .join(" ")
            : "Modalità chat semplice: nessuno strumento. Se chiede un'immagine, digli di usare Media Studio sotto il composer (Genera immagine) oppure di attivare Agent.",
          memorySnippet ? `Memoria del workspace:\n${memorySnippet}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        const modelMessages: ModelMessage[] = historyMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })) as ModelMessage[];

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let closed = false;
            const close = () => {
              if (!closed) {
                closed = true;
                controller.close();
              }
            };
            try {
              const timeout = AbortSignal.timeout(useAgent ? 200_000 : 85_000);
              const signal = AbortSignal.any
                ? AbortSignal.any([request.signal, timeout])
                : request.signal;

              const result = streamText({
                model,
                system,
                messages: modelMessages,
                // Lovable: no retry double-billing on transient errors
                maxRetries: isLovable ? 0 : 1,
                ...(isLovable ? { maxOutputTokens: LOVABLE_MAX_OUTPUT_TOKENS } : {}),
                ...(useAgent ? { tools, stopWhen: stepCountIs(agentStepLimit) } : {}),
                abortSignal: signal,
              });

              for await (const part of result.fullStream) {
                if (signal.aborted) break;
                if (part.type === "text-delta") {
                  controller.enqueue(jsonLine({ t: "text", v: part.text }));
                } else if (part.type === "tool-call") {
                  controller.enqueue(
                    jsonLine({
                      t: "tool",
                      status: "running",
                      id: part.toolCallId,
                      name: part.toolName,
                      input: part.input,
                    }),
                  );
                } else if (part.type === "tool-result") {
                  controller.enqueue(
                    jsonLine({
                      t: "tool",
                      status: "done",
                      id: part.toolCallId,
                      name: part.toolName,
                      output: part.output,
                    }),
                  );
                } else if (part.type === "error") {
                  controller.enqueue(jsonLine({ t: "error", v: formatChatError(part.error) }));
                }
              }
              controller.enqueue(jsonLine({ t: "done" }));
              close();
            } catch (error) {
              if (!request.signal.aborted) {
                const timedOut =
                  error instanceof Error &&
                  (error.name === "TimeoutError" || /aborted|timeout/i.test(error.message));
                controller.enqueue(
                  jsonLine({
                    t: "error",
                    v: timedOut
                      ? "Timeout verso il modello. Riprova con Agent spento, un messaggio più corto, o un altro modello."
                      : formatChatError(error),
                  }),
                );
              }
              close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-cache, no-transform",
          },
        });
      },
    },
  },
});
