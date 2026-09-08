/**
 * Image: Pollinations (free, no key) with optional Gemini Flash Image if key works.
 * Video: Google Veo via predictLongRunning (requires paid Gemini billing).
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const IMAGE_MODEL = "pollinations/flux";
export const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
export const VIDEO_MODEL = "veo-3.1-fast-generate-preview";

/** Chat models that must never go through generateContent/streamText. */
export const NON_CHAT_MODEL_IDS = new Set([
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-preview-image",
  "gemini-2.0-flash-preview-image-generation",
  "veo-3.1-fast-generate-preview",
  "veo-3.1-generate-preview",
  "veo-3.0-generate-preview",
  "veo-2.0-generate-001",
]);

export type MediaBinary = {
  mimeType: string;
  base64: string;
  source?: string;
};

function apiErrorMessage(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (
    status === 429 ||
    lower.includes("resource_exhausted") ||
    lower.includes("rate") ||
    lower.includes("quota exceeded") ||
    lower.includes("limit: 0")
  ) {
    return "Quota Gemini esaurita o non disponibile sul free tier per questo modello. Per le immagini usa Media Studio (Pollinations gratis). Per i video serve billing Google.";
  }
  if (status === 401 || status === 403 || status === 404) {
    if (
      lower.includes("billing") ||
      lower.includes("paid") ||
      lower.includes("permission") ||
      lower.includes("not available") ||
      lower.includes("not found") ||
      lower.includes("not supported")
    ) {
      return "Video Veo non disponibile: richiede billing Google (tier a pagamento) e non va usato come modello chat. Usa Media Studio → Genera video.";
    }
    return "Chiave Gemini non valida o modello non permesso su questo account.";
  }
  if (status === 400 && (lower.includes("billing") || lower.includes("only available"))) {
    return "Questo modello richiede billing Google a pagamento.";
  }
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) {
      const msg = parsed.error.message;
      if (/quota|rate|billing|paid|not found|not supported/i.test(msg)) {
        return apiErrorMessage(status, msg);
      }
      return msg;
    }
  } catch {
    /* ignore */
  }
  return body.slice(0, 400) || `Errore provider ${status}`;
}

/** Free image generation via Pollinations (no API key). */
export async function generatePollinationsImage(prompt: string): Promise<MediaBinary> {
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=1024&height=1024&nologo=true&model=flux&seed=${Date.now() % 1_000_000}`;
  const res = await fetch(url, {
    headers: { Accept: "image/*" },
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    throw new Error(
      `Pollinations ha risposto ${res.status}. Riprova tra poco con un prompt più corto.`,
    );
  }
  const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 500) {
    throw new Error("Pollinations ha restituito un'immagine vuota. Riprova.");
  }
  return {
    mimeType: mimeType.startsWith("image/") ? mimeType : "image/jpeg",
    base64: buf.toString("base64"),
    source: "pollinations",
  };
}

async function generateGeminiImage(apiKey: string, prompt: string): Promise<MediaBinary> {
  const url = `${GEMINI_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(apiErrorMessage(res.status, text));

  const data = JSON.parse(text) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }>;
      };
    }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return {
        mimeType: part.inlineData.mimeType || "image/png",
        base64: part.inlineData.data,
        source: "gemini",
      };
    }
  }
  throw new Error("Gemini non ha restituito un'immagine.");
}

/**
 * Prefer Gemini if a key is provided; on quota/billing failure fall back to Pollinations.
 * Without a key, use Pollinations directly.
 */
export async function generateImage(
  prompt: string,
  apiKey?: string,
): Promise<MediaBinary> {
  if (apiKey?.trim()) {
    try {
      return await generateGeminiImage(apiKey.trim(), prompt);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (
        /quota|rate|billing|paid|limit: 0|esaurit|non disponibile|403|429/i.test(msg)
      ) {
        return generatePollinationsImage(prompt);
      }
      // Still try free path for unknown Gemini failures
      try {
        return await generatePollinationsImage(prompt);
      } catch {
        throw new Error(msg);
      }
    }
  }
  return generatePollinationsImage(prompt);
}

/** @deprecated use generateImage */
export async function generateGeminiImagePublic(apiKey: string, prompt: string) {
  return generateImage(prompt, apiKey);
}

type VeoPollResponse = {
  done?: boolean;
  error?: { message?: string; code?: number };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string; videoBytes?: string } }>;
    };
    generatedVideos?: Array<{ video?: { uri?: string } }>;
  };
};

export async function generateGeminiVideo(
  apiKey: string,
  prompt: string,
): Promise<{ mimeType: string; base64?: string; uri?: string; tooLarge?: boolean }> {
  const startUrl = `${GEMINI_BASE}/models/${VIDEO_MODEL}:predictLongRunning`;
  const startRes = await fetch(startUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        aspectRatio: "16:9",
        sampleCount: 1,
        durationSeconds: 4,
        resolution: "720p",
      },
    }),
  });
  const startText = await startRes.text();
  if (!startRes.ok) throw new Error(apiErrorMessage(startRes.status, startText));

  const started = JSON.parse(startText) as { name?: string };
  if (!started.name) throw new Error("Veo non ha avviato l'operazione video.");

  const opUrl = `${GEMINI_BASE}/${started.name}`;
  const deadline = Date.now() + 180_000;
  let last: VeoPollResponse = {};

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 8_000));
    const pollRes = await fetch(opUrl, {
      headers: { "x-goog-api-key": apiKey },
    });
    const pollText = await pollRes.text();
    if (!pollRes.ok) throw new Error(apiErrorMessage(pollRes.status, pollText));
    last = JSON.parse(pollText) as VeoPollResponse;
    if (last.error?.message) {
      throw new Error(apiErrorMessage(last.error.code ?? 400, last.error.message));
    }
    if (last.done) break;
  }

  if (!last.done) throw new Error("Timeout generazione video Veo (oltre 3 minuti). Riprova.");

  const sample =
    last.response?.generateVideoResponse?.generatedSamples?.[0]?.video ??
    last.response?.generatedVideos?.[0]?.video;
  const uri = sample?.uri;
  const inlineBytes = (sample as { videoBytes?: string } | undefined)?.videoBytes;

  if (inlineBytes) {
    const tooLarge = inlineBytes.length > 450_000;
    if (tooLarge) {
      return uri
        ? { mimeType: "video/mp4", uri, tooLarge: true }
        : { mimeType: "video/mp4", tooLarge: true };
    }
    return uri
      ? { mimeType: "video/mp4", base64: inlineBytes, uri, tooLarge: false }
      : { mimeType: "video/mp4", base64: inlineBytes, tooLarge: false };
  }

  if (!uri) throw new Error("Veo ha finito ma senza URI video nel response.");

  const dl = await fetch(uri, { headers: { "x-goog-api-key": apiKey } });
  if (!dl.ok) {
    return { mimeType: "video/mp4", uri, tooLarge: true };
  }
  const buf = Buffer.from(await dl.arrayBuffer());
  const tooLarge = buf.byteLength > 350_000;
  if (tooLarge) {
    return { mimeType: "video/mp4", uri, tooLarge: true };
  }
  return {
    mimeType: "video/mp4",
    base64: buf.toString("base64"),
    uri,
    tooLarge: false,
  };
}

export function slugFromPrompt(prompt: string): string {
  const base = prompt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || "media";
}

export function toDataUrl(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`;
}
