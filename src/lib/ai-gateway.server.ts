import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/** Google Gemini via the official OpenAI-compatible endpoint (server-side key only). */
export function createGeminiProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "google",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

/** Lovable AI Gateway provider (optional secondary path; billed on Lovable credits). */
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
