import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Google Gemini via the official OpenAI-compatible API.
 * Prefer the browser key from Providers; optional GEMINI_API_KEY env fallback on the server.
 * Lovable hosts the app; Google bills this usage (not Lovable AI Gateway credits).
 */
export function createGeminiProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "google",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey,
  });
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
  return createOpenAICompatible({
    name,
    baseURL,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
}
