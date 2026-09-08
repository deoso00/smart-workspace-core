import { createFileRoute } from "@tanstack/react-router";
import { streamText, tool, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import { createByoProvider, createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { createServerSupabase } from "@/lib/zanto/server-db.server";

type ChatBody = {
  workspaceId?: string;
  ownerKey?: string;
  provider?: string;
  model?: string;
  mode?: string;
  agent?: boolean;
  allowedTools?: string[];
  credential?: { apiKey?: string; baseUrl?: string };
  messages?: { role: "user" | "assistant" | "system"; content: string }[];
  memory?: string;
};

const BYO_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
};

function jsonLine(payload: unknown) {
  return new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
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

        const providerId = body.provider ?? "lovable";
        const modelId = body.model ?? "google/gemini-3.7-flash";

        let model;
        try {
          if (providerId === "lovable") {
            const key = process.env["LOVABLE_API_KEY"];
            if (!key) {
              return new Response(
                JSON.stringify({ error: "Lovable AI non configurato su questo progetto." }),
                { status: 500, headers: { "content-type": "application/json" } },
              );
            }
            model = createLovableAiGatewayProvider(key)(modelId);
          } else if (providerId === "ollama") {
            const base = body.credential?.baseUrl;
            if (!base) {
              return new Response(
                JSON.stringify({ error: "Runtime locale non configurato: nessun endpoint." }),
                { status: 400, headers: { "content-type": "application/json" } },
              );
            }
            model = createByoProvider("ollama", `${base.replace(/\/$/, "")}/v1`)(modelId);
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
          return new Response(JSON.stringify({ error: String(error) }), {
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
        };

        const tools = Object.fromEntries(
          Object.entries(allTools).filter(([name]) => allowed.has(name)),
        );
        const useAgent = Boolean(body.agent) && Object.keys(tools).length > 0;

        const system = [
          "Sei ZAnto.AI, un assistente AI personale che lavora dentro un workspace con filesystem virtuale.",
          "Rispondi in italiano se l'utente scrive in italiano. Sii concreto e onesto: non inventare risultati di strumenti.",
          useAgent
            ? "Modalità Agent attiva: puoi usare gli strumenti autorizzati per leggere e scrivere file virtuali e memoria. Descrivi brevemente ogni azione."
            : "Modalità chat semplice: nessuno strumento disponibile.",
          body.memory ? `Memoria del workspace:\n${body.memory}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        const modelMessages: ModelMessage[] = messages.map((m) => ({
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
              const result = streamText({
                model,
                system,
                messages: modelMessages,
                ...(useAgent ? { tools, stopWhen: stepCountIs(50) } : {}),
                abortSignal: request.signal,
              });

              for await (const part of result.fullStream) {
                if (request.signal.aborted) break;
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
                  controller.enqueue(jsonLine({ t: "error", v: String(part.error) }));
                }
              }
              controller.enqueue(jsonLine({ t: "done" }));
              close();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (!request.signal.aborted) {
                controller.enqueue(jsonLine({ t: "error", v: message }));
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
