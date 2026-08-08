import { CONFIG } from "./config.mjs";

// Forgive the common paste formats for a Gemini model id:
//   "models/gemini-2.5-flash"  (Google API docs format)  -> "gemini-2.5-flash"
//   "Gemini 2.5 Flash"         (display name)            -> "gemini-2.5-flash"
//   "  gemini-2.5-flash \n"    (stray whitespace)        -> "gemini-2.5-flash"
// The request URL is `v1beta/models/{model}:generateContent` with the model
// percent-encoded, so any of the raw forms above would 404.
export const normalizeGeminiModel = (value) => {
  let model = String(value ?? "").trim();
  if (model.toLowerCase().startsWith("models/")) model = model.slice("models/".length);
  // Display-name paste: spaces and/or uppercase — canonicalize to the id form.
  if (/\s/.test(model) || /[A-Z]/.test(model)) {
    model = model.toLowerCase().replace(/\s+/g, "-");
  }
  return model;
};

export const readProviderSettings = (prefs) => {
  const provider = readString(prefs, CONFIG.AI_ENGINE_PREF, "off") || "off";
  if (provider === "local") return { provider, consentToSendData: false };
  if (provider === "ollama") {
    return {
      provider,
      consentToSendData: false,
      endpoint: readString(prefs, CONFIG.AI_OLLAMA_HOST_PREF, CONFIG.AI_OLLAMA_HOST_DEFAULT),
      model: readString(prefs, CONFIG.AI_OLLAMA_MODEL_PREF, CONFIG.AI_OLLAMA_MODEL_DEFAULT),
    };
  }
  const consentToSendData = readBool(prefs, CONFIG.AI_PROVIDER_CONSENT_PREF, false);
  if (provider === "openai") {
    return {
      provider,
      consentToSendData,
      endpoint: readString(prefs, CONFIG.AI_OPENAI_ENDPOINT_PREF, ""),
      apiKey: readString(prefs, CONFIG.AI_OPENAI_API_KEY_PREF, ""),
      model: readString(prefs, CONFIG.AI_OPENAI_MODEL_PREF, ""),
    };
  }
  if (provider === "gemini") {
    return {
      provider,
      consentToSendData,
      apiKey: readString(prefs, CONFIG.AI_GEMINI_API_KEY_PREF, ""),
      model: normalizeGeminiModel(readString(prefs, CONFIG.AI_GEMINI_MODEL_PREF, "")),
    };
  }
  if (provider === "custom") {
    return {
      provider,
      consentToSendData,
      endpoint: readString(prefs, CONFIG.AI_CUSTOM_ENDPOINT_PREF, ""),
      apiKey: readString(prefs, CONFIG.AI_CUSTOM_API_KEY_PREF, ""),
      model: readString(prefs, CONFIG.AI_CUSTOM_MODEL_PREF, ""),
      format: readString(prefs, CONFIG.AI_CUSTOM_FORMAT_PREF, "openai") === "ollama" ? "ollama" : "openai",
    };
  }
  return { provider: "off", consentToSendData: false };
};

// All provider fields are copy-pasted by users; stray whitespace in an endpoint,
// key, or model is a classic invisible 401/404 cause, so trim every string read.
const readString = (prefs, name, fallback) =>
  (prefs?.prefHasUserValue?.(name) && prefs.getPrefType(name) === prefs.PREF_STRING
    ? prefs.getStringPref(name)
    : fallback
  ).trim();

const readBool = (prefs, name, fallback) =>
  prefs?.prefHasUserValue?.(name) && prefs.getPrefType(name) === prefs.PREF_BOOL ? prefs.getBoolPref(name) : fallback;
