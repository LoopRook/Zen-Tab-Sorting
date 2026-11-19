import test from "node:test";
import assert from "node:assert/strict";

import { getProviderReadiness, requestProviderFetch } from "../modules/provider-readiness.mjs";

test("Given disabled provider When readiness is checked Then no provider fetch is allowed", async () => {
  let calls = 0;
  const result = await requestProviderFetch({ provider: "off", consentToSendData: false }, async () => {
    calls += 1;
    return "unexpected";
  });

  assert.deepEqual(result, { ok: false, reason: "provider_disabled" });
  assert.equal(calls, 0);
});

test("Given remote provider without consent When readiness is checked Then consent is required", () => {
  const result = getProviderReadiness({
    provider: "openai",
    consentToSendData: false,
    endpoint: "https://api.example.test/v1",
    apiKey: "sk-test",
    model: "gpt-tabs",
  });

  assert.deepEqual(result, { ok: false, reason: "consent_required" });
});

test("Given remote provider with consent but missing config When readiness is checked Then missing fields are named", () => {
  const result = getProviderReadiness({
    provider: "gemini",
    consentToSendData: true,
    apiKey: "",
    model: "",
  });

  assert.deepEqual(result, { ok: false, reason: "missing_required_config", missingFields: ["apiKey", "model"] });
});

test("Given local Ollama provider When readiness is checked Then data consent is not required", () => {
  const result = getProviderReadiness({
    provider: "ollama",
    consentToSendData: false,
    endpoint: "http://localhost:11434",
    model: "qwen2.5:1.5b",
  });

  assert.equal(result.ok, true);
});

test("Given a Custom OpenAI-format server without a key When readiness is checked Then it is ready", () => {
  const result = getProviderReadiness({
    provider: "custom",
    consentToSendData: true,
    endpoint: "http://localhost:1234/v1",
    apiKey: "",
    model: "qwen2.5-coder",
    format: "openai",
  });

  assert.equal(result.ok, true);
});
