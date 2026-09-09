import { createFileRoute } from "@tanstack/react-router";
import { createServerSupabase } from "@/lib/zanto/server-db.server";

function normalizePath(path: string): string {
  let p = path.trim().replace(/\\/g, "/");
  if (!p.startsWith("/")) p = `/${p}`;
  return p.replace(/\/+/g, "/");
}

function mimeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

/**
 * Serve a single VFS file for live preview (web / Lovable).
 * GET /api/preview?workspaceId=…&path=/index.html
 */
export const Route = createFileRoute("/api/preview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const workspaceId = url.searchParams.get("workspaceId")?.trim();
        const rawPath = url.searchParams.get("path")?.trim() || "/index.html";
        if (!workspaceId) {
          return Response.json({ error: "workspaceId richiesto" }, { status: 400 });
        }
        const path = normalizePath(rawPath);
        const supabase = createServerSupabase();
        const { data, error } = await supabase
          .from("vfs_nodes")
          .select("kind, content, path")
          .eq("workspace_id", workspaceId)
          .eq("path", path)
          .maybeSingle();

        if (error) {
          return Response.json({ error: error.message }, { status: 500 });
        }
        if (!data || data.kind !== "file") {
          return new Response("File non trovato nel VFS", { status: 404 });
        }

        const body = data.content ?? "";
        // data-URL images stored as text: return as-is with html wrapper if needed
        if (body.startsWith("data:") && !path.match(/\.(html?|css|js|mjs|svg|txt|md|json)$/i)) {
          return new Response(
            `<!doctype html><meta charset="utf-8"><img src="${body.replace(/"/g, "&quot;")}" style="max-width:100%" />`,
            {
              status: 200,
              headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
              },
            },
          );
        }

        let html = body;
        if (/\.html?$/i.test(path)) {
          const base = `/api/preview?workspaceId=${encodeURIComponent(workspaceId)}&path=`;
          // Inject helper so relative assets can be resolved via query API if needed
          if (!/<base\s/i.test(html)) {
            html = html.replace(
              /<head([^>]*)>/i,
              `<head$1><meta name="zanto-preview" content="1" data-base="${base}" />`,
            );
          }
        }

        return new Response(html, {
          status: 200,
          headers: {
            "content-type": mimeFor(path),
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
