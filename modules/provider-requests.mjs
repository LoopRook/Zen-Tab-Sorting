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
export const PARAM_STYLE_MODERN_BARE = "modern-bare";

// Shapes to try, best guess first. A gateway may serve a newer model but
// reject reasoning_effort, so the modern guess falls back to a bare modern
// request before giving up and trying the classic one.
export const paramStyleLadder = (model) =>
  guessParamStyle(model) === PARAM_STYLE_MODERN
    ? [PARAM_STYLE_MODERN, PARAM_STYLE_MODERN_BARE, PARAM_STYLE_CLASSIC]
    : [PARAM_STYLE_CLASSIC, PARAM_STYLE_MODERN, PARAM_STYLE_MODERN_BARE];

const isModernStyle = (paramStyle) =>
  paramStyle === PARAM_STYLE_MODERN || paramStyle === PARAM_STYLE_MODERN_BARE;

export const buildProviderRequest = (provider, prompt, maxTokens, paramStyle = PARAM_STYLE_CLASSIC) => {
  const boundedTokens = boundMaxTokens(maxTokens, paramStyle);
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
  return /unsupported|not supported|only the default|unrecognized|unknown/i.test(text)
    && /max_tokens|temperature|reasoning_effort/i.test(text);
};

// A 200 with no usable text is a dead end to debug from, so say why: a
// reasoning model that spent its whole budget thinking reports
// finish_reason "length" with the reasoning tokens it burned.
export const describeEmptyResponse = (kind, text) => {
  if (kind !== "openai") return "";
  const parsed = parseJson(text);
  const choice = parsed?.choices?.[0];
  if (!choice) return "";
  const parts = [];
  if (choice.finish_reason) parts.push(`finish_reason=${choice.finish_reason}`);
  if (choice.message?.refusal) parts.push(`refusal=${String(choice.message.refusal).slice(0, 80)}`);
  const reasoning = parsed?.usage?.completion_tokens_details?.reasoning_tokens;
  if (Number.isFinite(reasoning)) parts.push(`reasoning_tokens=${reasoning}`);
  return parts.join(", ");
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
      ...(isModernStyle(paramStyle)
        ? {
          max_completion_tokens: maxTokens,
          // "low" rather than "minimal": at minimal effort these models have
          // been reported to return nothing at all on extraction-shaped
          // prompts, which is exactly what sorting asks of them.
          ...(paramStyle === PARAM_STYLE_MODERN ? { reasoning_effort: "low" } : {}),
        }
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

// Reasoning models bill hidden reasoning against max_completion_tokens before
// they emit a single visible character, so a budget sized for the answer alone
// comes back empty with finish_reason "length". The budget is a ceiling rather
// than an allocation — unused tokens cost nothing — so modern requests get
// generous headroom and a floor that a short reply cannot starve under.
const REASONING_HEADROOM = 4096;
const MODERN_MIN_TOKENS = 2048;
const MODERN_MAX_TOKENS = 16384;

const boundMaxTokens = (value, paramStyle) => {
  const requested = Number.isFinite(value) ? Math.trunc(value) : 800;
  return isModernStyle(paramStyle)
    ? Math.min(Math.max(requested + REASONING_HEADROOM, MODERN_MIN_TOKENS), MODERN_MAX_TOKENS)
    : Math.min(Math.max(requested, 64), 4096);
};

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
