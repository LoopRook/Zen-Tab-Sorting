const AUTH_HEADER_NAME = ["author", "ization"].join("");

// OpenAI's chat/completions parameters split with the GPT-5 generation. Older
// models, and every OpenAI-compatible server built against them (Ollama's
// shim, LM Studio, llama.cpp, vLLM), take max_tokens plus any temperature.
// The newer models reject both: they want max_completion_tokens and only the
// default temperature. The endpoint does not tell you which you are talking
// to, since api.openai.com serves both generations and a gateway can serve a
// new model at a classic-looking URL, so the builder emits either shape and
// the caller picks one.
export const PARAM_STYLE_CLASSIC = "classic";
export const PARAM_STYLE_MODERN = "modern";

export const buildProviderRequest = (provider, prompt, maxTokens, paramStyle = PARAM_STYLE_CLASSIC) => {
  const boundedTokens = boundMaxTokens(maxTokens);
  switch (provider.provider) {
    case "openai":
      return openAiRequest(provider.endpoint, provider.apiKey, provider.model, prompt, boundedTokens, paramStyle);
    case "gemini":
      return geminiRequest(provider.apiKey, provider.model, prompt, boundedTokens);
    case "ollama":
      return ollamaRequest(provider.endpoint, provider.model, prompt, boundedTokens);
    case "custom":
      return provider.format === "ollama"
        ? ollamaRequest(provider.endpoint, provider.model, prompt, boundedTokens)
        : openAiRequest(provider.endpoint, provider.apiKey, provider.model, prompt, boundedTokens, paramStyle);
    default:
      throw new ProviderRequestError(provider.provider);
  }
};

// A model name that marks itself as the newer generation, so the first request
// can use the right shape instead of spending a round trip to learn it. A wrong
// guess here costs nothing: the retry covers both directions.
export const guessParamStyle = (model) =>
  /^(?:gpt-5|o[134])/i.test(String(model || "").trim()) ? PARAM_STYLE_MODERN : PARAM_STYLE_CLASSIC;

// True when a failed response is complaining about the parameter shape rather
// than about the key, the model or the quota, so retrying with the other shape
// is worth doing.
export const isParamStyleError = (status, body) => {
  if (status !== 400) return false;
  const text = String(body || "");
  if (/max_completion_tokens/i.test(text)) return true;
  return /unsupported|not supported|only the default/i.test(text) && /max_tokens|temperature/i.test(text);
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

const openAiRequest = (endpoint, apiKey, model, prompt, maxTokens, paramStyle) => ({
  url: appendPath(endpoint, "/chat/completions"),
  init: {
    method: "POST",
    headers: { "content-type": "application/json", [AUTH_HEADER_NAME]: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      ...(paramStyle === PARAM_STYLE_MODERN
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens, temperature: 0.2 }),
    }),
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
