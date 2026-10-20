import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProviderRequest,
  getProviderKind,
  guessParamStyle,
  isParamStyleError,
  parseProviderResponse,
  PARAM_STYLE_CLASSIC,
  PARAM_STYLE_MODERN,
} from "../modules/provider-requests.mjs";

test("Given OpenAI-compatible provider When building request Then chat completions payload and auth header are used", () => {
  const request = buildProviderRequest({
    provider: "openai",
    endpoint: "https://api.example.test/v1/",
    apiKey: "sk-test",
    model: "gpt-tabs",
    consentToSendData: true,
  }, "sort tabs", 800);

  assert.equal(request.url, "https://api.example.test/v1/chat/completions");
  assert.equal(request.init.headers.authorization, "Bearer sk-test");
  assert.match(request.init.body, /"messages"/);
});

test("Given Gemini provider When building request Then generateContent URL is used", () => {
  const request = buildProviderRequest({
    provider: "gemini",
    apiKey: "AIza-test",
    model: "gemini-2.0-flash",
    consentToSendData: true,
  }, "sort tabs", 800);

  assert.match(request.url, /generativelanguage\.googleapis\.com/);
  assert.match(request.url, /gemini-2\.0-flash:generateContent/);
  assert.equal(request.init.headers["content-type"], "application/json");
});

test("Given custom Ollama provider When building request Then Ollama format is used", () => {
  const provider = {
    provider: "custom",
    endpoint: "http://localhost:11434",
    apiKey: "",
    model: "llama3.2",
    format: "ollama",
    consentToSendData: true,
  };
  const request = buildProviderRequest(provider, "sort tabs", 800);

  assert.equal(getProviderKind(provider), "ollama");
  assert.equal(request.url, "http://localhost:11434/api/generate");
  assert.match(request.init.body, /"stream":false/);
});

test("Given malformed provider response When parsing Then parser fails closed", () => {
  assert.equal(parseProviderResponse("openai", "{ nope"), null);
  assert.equal(parseProviderResponse("openai", JSON.stringify({ choices: [] })), null);
  assert.equal(parseProviderResponse("ollama", JSON.stringify({ response: "Tabs" })), "Tabs");
});

test("Given the modern parameter style When building an OpenAI request Then max_completion_tokens replaces max_tokens and temperature", () => {
  const request = buildProviderRequest({
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-5.6-luna",
    consentToSendData: true,
  }, "sort tabs", 800, PARAM_STYLE_MODERN);

  const body = JSON.parse(request.init.body);
  assert.equal(body.max_completion_tokens, 800);
  assert.equal("max_tokens" in body, false);
  assert.equal("temperature" in body, false);
});

test("Given no parameter style When building an OpenAI request Then the classic shape is kept for local servers", () => {
  const request = buildProviderRequest({
    provider: "custom",
    endpoint: "http://localhost:1234/v1",
    apiKey: "",
    model: "qwen2.5-coder",
    format: "openai",
    consentToSendData: true,
  }, "sort tabs", 800);

  const body = JSON.parse(request.init.body);
  assert.equal(body.max_tokens, 800);
  assert.equal(body.temperature, 0.2);
  assert.equal("max_completion_tokens" in body, false);
});

test("Given a model name When guessing the parameter style Then only the newer families are treated as modern", () => {
  assert.equal(guessParamStyle("gpt-5.6-luna"), PARAM_STYLE_MODERN);
  assert.equal(guessParamStyle("  o3-mini "), PARAM_STYLE_MODERN);
  assert.equal(guessParamStyle("gpt-4o-mini"), PARAM_STYLE_CLASSIC);
  assert.equal(guessParamStyle("llama3.2"), PARAM_STYLE_CLASSIC);
  assert.equal(guessParamStyle(""), PARAM_STYLE_CLASSIC);
});

test("Given a provider error body When checking for a parameter-shape failure Then only parameter complaints match", () => {
  const unsupported = JSON.stringify({
    error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." },
  });
  const temperature = JSON.stringify({
    error: { message: "Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported." },
  });

  assert.equal(isParamStyleError(400, unsupported), true);
  assert.equal(isParamStyleError(400, temperature), true);
  assert.equal(isParamStyleError(400, JSON.stringify({ error: { message: "The model `nope` does not exist" } })), false);
  assert.equal(isParamStyleError(401, unsupported), false);
  assert.equal(isParamStyleError(429, JSON.stringify({ error: { message: "quota exceeded" } })), false);
});
