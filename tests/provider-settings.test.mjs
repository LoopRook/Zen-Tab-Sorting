import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGeminiModel, readProviderSettings } from "../modules/provider-settings.mjs";
import { CONFIG } from "../modules/config.mjs";

// Minimal Services.prefs stand-in: string prefs from a plain object.
const fakePrefs = (values) => ({
  PREF_STRING: "string",
  PREF_BOOL: "bool",
  prefHasUserValue: (name) => name in values,
  getPrefType: (name) => (typeof values[name] === "boolean" ? "bool" : "string"),
  getStringPref: (name) => values[name],
  getBoolPref: (name) => values[name],
});

test("Given Google-docs model format When normalized Then the models/ prefix is stripped", () => {
  assert.equal(normalizeGeminiModel("models/gemini-2.5-flash"), "gemini-2.5-flash");
});

test("Given a display-name paste When normalized Then it becomes the lowercase-hyphenated id", () => {
  assert.equal(normalizeGeminiModel("Gemini 2.5 Flash"), "gemini-2.5-flash");
});

test("Given stray whitespace When normalized Then it is trimmed", () => {
  assert.equal(normalizeGeminiModel("  gemini-2.5-flash \n"), "gemini-2.5-flash");
});

test("Given an already-clean id When normalized Then it is unchanged", () => {
  assert.equal(normalizeGeminiModel("gemini-2.5-flash"), "gemini-2.5-flash");
});

test("Given Gemini settings with messy model and padded key When read Then both come back clean", () => {
  const settings = readProviderSettings(fakePrefs({
    [CONFIG.AI_ENGINE_PREF]: "gemini",
    [CONFIG.AI_PROVIDER_CONSENT_PREF]: true,
    [CONFIG.AI_GEMINI_API_KEY_PREF]: "  AIzaExample  ",
    [CONFIG.AI_GEMINI_MODEL_PREF]: "models/Gemini 2.5 Flash",
  }));
  assert.equal(settings.provider, "gemini");
  assert.equal(settings.apiKey, "AIzaExample");
  assert.equal(settings.model, "gemini-2.5-flash");
});

test("Given OpenAI settings with padded endpoint When read Then the endpoint is trimmed", () => {
  const settings = readProviderSettings(fakePrefs({
    [CONFIG.AI_ENGINE_PREF]: "openai",
    [CONFIG.AI_OPENAI_ENDPOINT_PREF]: " https://api.openai.com/v1 ",
    [CONFIG.AI_OPENAI_API_KEY_PREF]: "sk-test",
    [CONFIG.AI_OPENAI_MODEL_PREF]: "gpt-4o-mini",
  }));
  assert.equal(settings.endpoint, "https://api.openai.com/v1");
});
