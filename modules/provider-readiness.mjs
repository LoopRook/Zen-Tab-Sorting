export const PROVIDER_NAMES = ["off", "local", "ollama", "openai", "gemini", "custom"];

export const getProviderReadiness = (settings) => {
  if (settings.provider === "off" || settings.provider === "local") {
    return { ok: false, reason: "provider_disabled" };
  }
  if (settings.provider === "ollama") {
    const missingFields = missingStringFields({ endpoint: settings.endpoint, model: settings.model });
    return missingFields.length > 0 ? { ok: false, reason: "missing_required_config", missingFields } : { ok: true, value: settings };
  }
  if (!settings.consentToSendData) {
    return { ok: false, reason: "consent_required" };
  }
  const missingFields = getMissingRequiredFields(settings);
  return missingFields.length > 0 ? { ok: false, reason: "missing_required_config", missingFields } : { ok: true, value: settings };
};

export const requestProviderFetch = async (settings, fetchProvider) => {
  const readiness = getProviderReadiness(settings);
  if (!readiness.ok) return readiness;
  return { ok: true, value: await fetchProvider(readiness.value) };
};

const getMissingRequiredFields = (settings) => {
  switch (settings.provider) {
    case "openai":
      return missingStringFields({ endpoint: settings.endpoint, apiKey: settings.apiKey, model: settings.model });
    case "gemini":
      return missingStringFields({ apiKey: settings.apiKey, model: settings.model });
    case "custom":
      return missingStringFields({
        endpoint: settings.endpoint,
        model: settings.model,
        format: settings.format,
        ...(settings.format === "openai" ? { apiKey: settings.apiKey } : {}),
      });
    default:
      return ["provider"];
  }
};

const missingStringFields = (fields) =>
  Object.entries(fields)
    .filter(([, value]) => typeof value !== "string" || value.trim().length === 0)
    .map(([field]) => field);
