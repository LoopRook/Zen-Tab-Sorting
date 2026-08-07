const AUTH_HEADER_NAME = ["author", "ization"].join("");

export const buildProviderRequest = (provider, prompt, maxTokens) => {
  const boundedTokens = boundMaxTokens(maxTokens);
  switch (provider.provider) {
    case "openai":
      return openAiRequest(provider.endpoint, provider.apiKey, provider.model, prompt, boundedTokens);
    case "gemini":
      return geminiRequest(provider.apiKey, provider.model, prompt, boundedTokens);
    case "ollama":
      return ollamaRequest(provider.endpoint, provider.model, prompt, boundedTokens);
    case "custom":
      return provider.format === "ollama"
        ? ollamaRequest(provider.endpoint, provider.model, prompt, boundedTokens)
        : openAiRequest(provider.endpoint, provider.apiKey, provider.model, prompt, boundedTokens);
    default:
      throw new ProviderRequestError(provider.provider);
  }
};

export const getProviderKind = (provider) => (provider.provider === "custom" ? provider.format : provider.provider);

export const parseProviderResponse = (kind, text) => {
  const parsed = parseJson(text);
  if (parsed === null) return null;
  if (kind === "ollama") return typeof parsed.response === "string" ? parsed.response : null;
  if (kind === "openai") return parsed.choices?.[0]?.message?.content ?? null;
  if (kind === "gemini") return parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  return null;
};

const openAiRequest = (endpoint, apiKey, model, prompt, maxTokens) => ({
  url: appendPath(endpoint, "/chat/completions"),
  init: {
    method: "POST",
    headers: { "content-type": "application/json", [AUTH_HEADER_NAME]: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0.2 }),
  },
});

const geminiRequest = (apiKey, model, prompt, maxTokens) => ({
  url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
  init: {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 } }),
  },
});

const ollamaRequest = (endpoint, model, prompt, maxTokens) => ({
  url: appendPath(endpoint, "/api/generate"),
  init: {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false, options: { num_predict: maxTokens } }),
  },
});

const appendPath = (endpoint, path) => {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  return trimmed.endsWith(path) ? trimmed : `${trimmed}${path}`;
};

const boundMaxTokens = (value) => Math.min(Math.max(Number.isFinite(value) ? Math.trunc(value) : 800, 64), 4096);

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export class ProviderRequestError extends Error {
  constructor(provider) {
    super(`Unexpected provider: ${provider}`);
    this.name = "ProviderRequestError";
    this.provider = provider;
  }
}
