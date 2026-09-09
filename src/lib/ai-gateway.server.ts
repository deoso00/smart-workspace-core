import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Google Gemini via the official @ai-sdk/google provider.
 * Prefer the browser key from Providers; optional GEMINI_API_KEY env fallback on the server.
 * Lovable hosts the app; Google bills this usage (not Lovable AI Gateway credits).
 */
export function createGeminiProvider(apiKey: string) {
  const google = createGoogleGenerativeAI({ apiKey });
  return (modelId: string) => google(modelId);
}

/** Lovable AI Gateway (optional). Uses Lovable AI Gateway credits. */
export function createLovableAiGatewayProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey },
  });
}

/** Strip quotes / accidental "Bearer " / env-line prefixes from pasted or .env keys. */
export function sanitizeApiKey(raw: string): string {
  let key = raw.trim().replace(/^\uFEFF/, "");
  // Full .env line pasted into Providers: OPENROUTER_API_KEY=sk-or-v1-...
  const envLine = key.match(/^[A-Z][A-Z0-9_]*=(.*)$/s);
  if (envLine) key = envLine[1].trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, "").trim();
  // Invisible junk from copy/paste
  key = key.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  return key;
}

/** Bring-your-own provider using an OpenAI-compatible endpoint. */
export function createByoProvider(name: string, baseURL: string, apiKey?: string) {
  const key = apiKey ? sanitizeApiKey(apiKey) : undefined;
  const headers: Record<string, string> = {};
  if (name === "openrouter") {
    headers["HTTP-Referer"] =
      process.env["OPENROUTER_HTTP_REFERER"]?.trim() ||
      process.env["VITE_APP_URL"]?.trim() ||
      "https://smart-workspace-core.lovable.app";
    headers["X-Title"] = "ZAnto.AI";
  }
  return createOpenAICompatible({
    name,
    baseURL,
    // Required: SDK auth uses apiKey (custom Authorization alone is unreliable).
    ...(key ? { apiKey: key } : {}),
    headers,
  });
}
