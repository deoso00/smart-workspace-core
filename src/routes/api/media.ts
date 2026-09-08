import { createFileRoute } from "@tanstack/react-router";
import {
  generateImage,
  generateGeminiVideo,
  slugFromPrompt,
  toDataUrl,
  IMAGE_MODEL,
  VIDEO_MODEL,
} from "@/lib/media-gen.server";
import { createServerSupabase } from "@/lib/zanto/server-db.server";
import { writeVfsFileServer } from "@/lib/zanto/vfs.server";

type MediaBody = {
  kind?: "image" | "video";
  prompt?: string;
  workspaceId?: string;
  ownerKey?: string;
  path?: string;
  credential?: { apiKey?: string };
};

export const Route = createFileRoute("/api/media")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as MediaBody;
        const kind = body.kind === "video" ? "video" : "image";
        const prompt = body.prompt?.trim();
        if (!prompt) {
          return Response.json({ error: "Prompt mancante." }, { status: 400 });
        }
        if (!body.workspaceId) {
          return Response.json({ error: "Workspace richiesto." }, { status: 400 });
        }

        const apiKey = body.credential?.apiKey?.trim() || process.env["GEMINI_API_KEY"];
        if (kind === "video" && !apiKey) {
          return Response.json(
            {
              error:
                "Video Veo richiede la chiave Gemini in Providers → Google Gemini (e billing a pagamento).",
            },
            { status: 400 },
          );
        }

        const ownerKey = body.ownerKey ?? "guest";
        const supabase = createServerSupabase();
        const slug = slugFromPrompt(prompt);
        const stamp = Date.now().toString(36);

        try {
          if (kind === "image") {
            const image = await generateImage(prompt, apiKey);
            const dataUrl = toDataUrl(image.mimeType, image.base64);
            const ext = image.mimeType.includes("png") ? "png" : "jpg";
            const path = body.path?.startsWith("/")
              ? body.path
              : `/media/${slug}-${stamp}.${ext}`;
            const written = await writeVfsFileServer(
              supabase,
              body.workspaceId,
              ownerKey,
              path,
              dataUrl,
            );
            if ("error" in written) {
              return Response.json({ error: written.error }, { status: 500 });
            }
            return Response.json({
              ok: true,
              kind: "image",
              model: image.source === "gemini" ? "gemini-2.5-flash-image" : IMAGE_MODEL,
              path: written.path,
              mimeType: image.mimeType,
              source: image.source ?? "pollinations",
            });
          }

          const video = await generateGeminiVideo(apiKey!, prompt);
          let path: string;
          let content: string;

          if (video.base64 && !video.tooLarge) {
            path = body.path?.startsWith("/") ? body.path : `/media/${slug}-${stamp}.mp4`;
            content = toDataUrl(video.mimeType, video.base64);
          } else {
            path = body.path?.startsWith("/")
              ? body.path
              : `/media/${slug}-${stamp}.video.html`;
            const safeUri = video.uri ?? "";
            content = `<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"/><title>Video ZAnto</title>
<style>body{font-family:system-ui;background:#111;color:#eee;padding:1.5rem}a{color:#7dd3fc}</style>
</head>
<body>
<h1>Video generato (Veo)</h1>
<p>Il file è troppo grande per il VFS testuale. URI temporaneo Google:</p>
<p><a href="${safeUri}" rel="noreferrer">${safeUri || "(nessun URI)"}</a></p>
<p>Prompt: ${prompt.replace(/</g, "&lt;")}</p>
<p>Modello: ${VIDEO_MODEL}. Veo richiede billing Google a pagamento.</p>
</body>
</html>`;
          }

          const written = await writeVfsFileServer(
            supabase,
            body.workspaceId,
            ownerKey,
            path,
            content,
          );
          if ("error" in written) {
            return Response.json({ error: written.error }, { status: 500 });
          }
          return Response.json({
            ok: true,
            kind: "video",
            model: VIDEO_MODEL,
            path: written.path,
            mimeType: video.mimeType,
            uri: video.uri,
            tooLarge: Boolean(video.tooLarge || !video.base64),
            billingNote: "Veo richiede account Gemini a pagamento.",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
