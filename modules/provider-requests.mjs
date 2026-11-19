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

// The other shape, for the one retry after a provider rejects the first.
export const otherParamStyle = (paramStyle) =>
  paramStyle === PARAM_STYLE_MODERN ? PARAM_STYLE_CLASSIC : PARAM_STYLE_MODERN;

const isModernStyle = (paramStyle) => paramStyle === PARAM_STYLE_MODERN;

// `reasoningEffort` is sent as-is on either OpenAI shape, or omitted when null.
// Which value to send, and what to do when a provider refuses it, is decided by
// modules/reasoning.mjs and the caller; this builder only serializes.
export const buildProviderRequest = (provider, prompt, maxTokens, paramStyle = PARAM_STYLE_CLASSIC, reasoningEffort = null) => {
  const boundedTokens = boundMaxTokens(maxTokens, paramStyle);
  switch (provider.provider) {
    case "openai":
      return openAiRequest(provider.endpoint, provider.apiKey, provider.model, prompt, boundedTokens, paramStyle, reasoningEffort);
    case "gemini":
      return geminiRequest(provider.apiKey, provider.model, prompt, boundedTokens);
    case "ollama":
      return ollamaRequest(provider.endpoint, provider.model, prompt, boundedTokens);
    case "custom":
      return provider.format === "ollama"
        ? ollamaRequest(provider.endpoint, provider.model, prompt, boundedTokens)
        : openAiRequest(provider.endpoint, provider.apiKey, provider.model, prompt, boundedTokens, paramStyle, reasoningEffort);
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
// is worth doing. Complaints about the reasoning field are handled separately
// (reasoning.mjs isReasoningParamError) and checked first by the caller.
export const isParamStyleError = (status, body) => {
  if (status !== 400) return false;
  const text = String(body || "");
  if (/max_completion_tokens/i.test(text)) return true;
  return /unsupported|not supported|only the default|unrecognized|unknown/i.test(text)
    && /max_tokens|temperature/i.test(text);
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

// A 200 is not always an answer. Returns a reason string when the response
// must not be used, or "" when it looks like a normal answer:
//   - gateways (OpenRouter among them) report API errors inside a 200
//   - a cut-off answer (finish_reason "length", Gemini MAX_TOKENS, Ollama
//     done_reason "length") can still parse as JSON yet be missing tabs, so it
//     is rejected and the caller's smaller-batch retry takes over
//   - a refusal or content filter is not an answer either
// (Adapted from upstream OpenTabSort-Zen 68977f7 / d1a0022.)
export const describeUnusableResponse = (kind, text) => {
  const parsed = parseJson(text);
  if (!parsed || typeof parsed !== "object") return "";
  if (parsed.error) {
    const message = typeof parsed.error === "string" ? parsed.error : parsed.error.message || parsed.error.code || "";
    return `Provider reported an error${message ? `: ${String(message).slice(0, 160)}` : ""}`;
  }
  const finish = parsed.choices?.[0]?.finish_reason ?? parsed.candidates?.[0]?.finishReason ?? parsed.done_reason;
  if (finish === "content_filter" || finish === "SAFETY" || parsed.choices?.[0]?.message?.refusal) {
    return "Provider blocked the response";
  }
  if (finish === "length" || finish === "MAX_TOKENS") {
    const detail = describeEmptyResponse(kind, text);
    return `Provider response hit its output limit${detail ? ` (${detail})` : ""}`;
  }
  return "";
};

// Pull the JSON object out of a model's answer. Models asked for JSON still
// wrap it: a leading <think>…</think> block, a ```json fence, or a sentence
// before or after. Accept exactly one complete object; two candidates are
// ambiguous and a truncated one is not an answer, so both throw.
// (Adapted from upstream OpenTabSort-Zen d1a0022.)
export const parseAnswerObject = (text) => {
  let raw = String(text || "").trim().replace(/^(?:\s*<(think|thinking|analysis)>[\s\S]*?<\/\1>)+\s*/i, "");
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) raw = fenced[1].trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const candidates = [];
    let start = -1;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (depth === 0) {
        if (ch === "{") {
          start = i;
          depth = 1;
        }
        continue;
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try { candidates.push(JSON.parse(raw.slice(start, i + 1))); } catch {}
      }
    }
    if (candidates.length !== 1 || depth !== 0) {
      throw new Error(candidates.length > 1
        ? "Provider returned more than one JSON answer"
        : `Provider returned non-JSON content: ${raw.slice(0, 120)}`);
    }
    [parsed] = candidates;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Provider returned non-object JSON");
  }
  return parsed;
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

const openAiRequest = (endpoint, apiKey, model, prompt, maxTokens, paramStyle, reasoningEffort) => ({
  url: appendPath(endpoint, "/chat/completions"),
  init: {
    method: "POST",
    // A blank key sends no header at all; "Bearer " with nothing after it is
    // rejected as malformed by some servers that need no key.
    headers: { "content-type": "application/json", ...(apiKey ? { [AUTH_HEADER_NAME]: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      ...(isModernStyle(paramStyle)
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens, temperature: 0.2 }),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
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
