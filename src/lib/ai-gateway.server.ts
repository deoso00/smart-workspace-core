import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Google Gemini via the official OpenAI-compatible API.
 * Key comes only from server env GEMINI_API_KEY — never from the browser.
 * Lovable hosts the app; Google bills this usage (not Lovable AI Gateway credits).
 */
export function createGeminiProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "google",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    headers: { Authorization: `Bearer ${apiKey}` },
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
