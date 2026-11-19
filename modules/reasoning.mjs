// Zen Tab Sorting — reasoning-effort policy for OpenAI-shaped requests.
//
// A reasoning model spends hidden tokens thinking before it writes a visible
// character. Sorting tabs is a classification job that does not need that, and
// the provider's default can turn a sub-second answer into several seconds. So
// the default preference ("fast") asks for reasoning off, and walks down to the
// cheapest level the model accepts when it cannot be switched off.
//
// No preference is ever applied blindly: a provider that rejects the field, or
// the value, gets one corrected retry, and the caller remembers what worked.
// Pure functions only, so the policy is testable without a browser.

import { CONFIG } from "./config.mjs";

export const REASONING_FAST = "fast";
export const REASONING_DEFAULT = "default";
export const REASONING_PREFERENCES = [REASONING_FAST, "low", "medium", "high", REASONING_DEFAULT];

// Cheapest first. Only the order matters, for "nearest accepted level".
export const REASONING_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

// What "fast" tries, in order. "minimal" is last on purpose: at minimal effort
// some models return an empty message on extraction-shaped prompts, which is
// what a sort asks for, so "low" is the safer fallback when "none" is refused.
const FAST_ORDER = ["none", "low", "minimal"];

const rank = (level) => {
  const idx = REASONING_LEVELS.indexOf(level);
  return idx === -1 ? 99 : idx;
};

export const normalizeReasoningPreference = (value) => {
  const raw = String(value ?? "").trim().toLowerCase();
  return REASONING_PREFERENCES.includes(raw) ? raw : CONFIG.AI_REASONING_EFFORT_DEFAULT;
};

// The value to send on the first attempt. null means "send no reasoning field".
export const initialReasoningEffort = (preference) => {
  const pref = normalizeReasoningPreference(preference);
  if (pref === REASONING_DEFAULT) return null;
  return pref === REASONING_FAST ? FAST_ORDER[0] : pref;
};

// A 400 that complains about the reasoning field itself, as opposed to the
// model, the key or max_tokens. Wording differs between providers:
//   OpenAI:   "Unsupported value: 'reasoning_effort' does not support 'none' ..."
//   OpenAI:   "Unrecognized request argument supplied: reasoning_effort"
//   Gateways: "thinking is not supported for this model", "extra fields not permitted"
export const isReasoningParamError = (status, body) => {
  // 422 is how FastAPI-based servers (vLLM and similar) reject unknown fields.
  if (status !== 400 && status !== 422) return false;
  const text = String(body || "");
  if (!/reasoning|thinking|effort/i.test(text)) return false;
  return /unsupported|not supported|does not support|unrecognized|unknown|invalid|unexpected|extra|not permitted/i.test(text);
};

// OpenAI lists the values it would accept in the rejection
// ("Supported values are: 'low', 'medium', and 'high'."). Use that list
// instead of guessing. Returns [] when the error names none.
export const parseSupportedEfforts = (body) => {
  const text = String(body || "");
  // \b keeps "Unsupported value: ..." (which names the rejected value) from
  // being read as the list of accepted ones.
  const at = text.search(/\bsupported values?\b/i);
  if (at === -1) return [];
  const tail = text.slice(at, at + 240);
  const found = tail.match(/\b(none|minimal|low|medium|high|xhigh|max)\b/gi) || [];
  return [...new Set(found.map((v) => v.toLowerCase()))];
};

// The provider does not know the field at all (as opposed to disliking one
// value): "Unrecognized request argument supplied: reasoning_effort",
// "Unsupported parameter: 'reasoning_effort'", pydantic "extra inputs are not
// permitted". No value will help, so the field should be dropped at once.
export const isReasoningFieldUnknown = (body) =>
  /unrecognized request argument|unsupported parameter|unknown (?:parameter|field|argument)|unexpected (?:keyword|field|parameter|argument)|extra (?:inputs?|fields?)|extra_forbidden|not permitted/i
    .test(String(body || ""));

// The next value to try after `current` was rejected, or null to drop the
// field entirely. `tried` holds every value already sent (null included).
export const nextReasoningEffort = (preference, body, tried = new Set()) => {
  const pref = normalizeReasoningPreference(preference);
  if (pref === REASONING_DEFAULT) return null;
  const supported = parseSupportedEfforts(body);
  if (!supported.length && isReasoningFieldUnknown(body)) return null;
  const untried = (list) => list.find((v) => !tried.has(v)) ?? null;

  if (pref === REASONING_FAST) {
    if (supported.length) {
      const ordered = [
        ...FAST_ORDER.filter((v) => supported.includes(v)),
        ...[...supported].filter((v) => !FAST_ORDER.includes(v)).sort((a, b) => rank(a) - rank(b)),
      ];
      return untried(ordered);
    }
    return untried(FAST_ORDER);
  }

  if (supported.length) {
    const wanted = rank(pref);
    const ordered = [...supported].sort((a, b) =>
      Math.abs(rank(a) - wanted) - Math.abs(rank(b) - wanted) || rank(a) - rank(b));
    return untried(ordered);
  }
  return null;
};

// Short phrase for the settings connection test.
export const describeReasoningEffort = (effort) => {
  if (effort == null) return "provider's default reasoning";
  if (effort === "none") return "reasoning off";
  return `reasoning ${effort}`;
};

// AI time limit, in seconds. Free text in Sine, so be forgiving: blank uses the
// default, 0 switches the limit off, anything else is clamped into range.
export const normalizeTimeLimitSeconds = (value) => {
  const raw = String(value ?? "").trim().replace(",", ".").replace(/s(ec(onds?)?)?$/i, "").trim();
  if (!raw) return CONFIG.AI_TIME_LIMIT_DEFAULT;
  const num = Number.parseFloat(raw);
  if (!Number.isFinite(num) || num < 0) return CONFIG.AI_TIME_LIMIT_DEFAULT;
  if (num === 0) return 0;
  return Math.min(CONFIG.AI_TIME_LIMIT_MAX, Math.max(CONFIG.AI_TIME_LIMIT_MIN, num));
};

// Absolute deadline (ms since epoch) for one AI pass, or null for no limit.
export const deadlineFromSeconds = (seconds, now = Date.now()) =>
  seconds > 0 ? now + seconds * 1000 : null;
