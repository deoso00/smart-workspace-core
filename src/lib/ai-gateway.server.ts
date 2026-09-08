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

/** Bring-your-own provider using an OpenAI-compatible endpoint. */
export function createByoProvider(name: string, baseURL: string, apiKey?: string) {
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  if (name === "openrouter") {
    headers["HTTP-Referer"] =
      process.env["OPENROUTER_HTTP_REFERER"]?.trim() ||
      process.env["VITE_APP_URL"]?.trim() ||
      "https://github.com/deoso00/smart-workspace-core";
    headers["X-Title"] = "ZAnto.AI";
  }
  return createOpenAICompatible({
    name,
    baseURL,
    headers,
  });
}
