import { CONFIG } from "./config.mjs";

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
      model: readString(prefs, CONFIG.AI_GEMINI_MODEL_PREF, ""),
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

const readString = (prefs, name, fallback) =>
  prefs?.prefHasUserValue?.(name) && prefs.getPrefType(name) === prefs.PREF_STRING ? prefs.getStringPref(name) : fallback;

const readBool = (prefs, name, fallback) =>
  prefs?.prefHasUserValue?.(name) && prefs.getPrefType(name) === prefs.PREF_BOOL ? prefs.getBoolPref(name) : fallback;
