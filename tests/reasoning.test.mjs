import test from "node:test";
import assert from "node:assert/strict";

import {
  deadlineFromSeconds,
  describeReasoningEffort,
  initialReasoningEffort,
  isReasoningParamError,
  nextReasoningEffort,
  normalizeReasoningPreference,
  normalizeTimeLimitSeconds,
  parseSupportedEfforts,
} from "../modules/reasoning.mjs";

const openAiRejects = (value, supported) => JSON.stringify({
  error: {
    message: `Unsupported value: 'reasoning_effort' does not support '${value}' with this model. Supported values are: ${supported}.`,
    type: "invalid_request_error",
    param: "reasoning_effort",
  },
});

test("Given a stored preference When normalizing Then unknown values fall back to fast", () => {
  assert.equal(normalizeReasoningPreference("fast"), "fast");
  assert.equal(normalizeReasoningPreference(" High "), "high");
  assert.equal(normalizeReasoningPreference("default"), "default");
  assert.equal(normalizeReasoningPreference(""), "fast");
  assert.equal(normalizeReasoningPreference("turbo"), "fast");
  assert.equal(normalizeReasoningPreference(undefined), "fast");
});

test("Given a preference When picking the first value Then fast asks for none and default sends nothing", () => {
  assert.equal(initialReasoningEffort("fast"), "none");
  assert.equal(initialReasoningEffort("medium"), "medium");
  assert.equal(initialReasoningEffort("default"), null);
});

test("Given provider errors When classifying Then only complaints about the reasoning field match", () => {
  assert.equal(isReasoningParamError(400, openAiRejects("none", "'minimal', 'low', 'medium', and 'high'")), true);
  assert.equal(isReasoningParamError(400, JSON.stringify({ error: { message: "Unrecognized request argument supplied: reasoning_effort" } })), true);
  assert.equal(isReasoningParamError(422, JSON.stringify({ detail: [{ type: "extra_forbidden", loc: ["body", "reasoning_effort"] }] })), true);
  assert.equal(isReasoningParamError(400, JSON.stringify({ error: { message: "thinking is not supported for this model" } })), true);
  assert.equal(isReasoningParamError(400, JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model." } })), false);
  assert.equal(isReasoningParamError(401, openAiRejects("none", "'low'")), false);
  assert.equal(isReasoningParamError(400, JSON.stringify({ error: { message: "The model `nope` does not exist" } })), false);
});

test("Given an OpenAI rejection When parsing Then the supported values are read from it", () => {
  assert.deepEqual(parseSupportedEfforts(openAiRejects("none", "'minimal', 'low', 'medium', and 'high'")), ["minimal", "low", "medium", "high"]);
  assert.deepEqual(parseSupportedEfforts("Unrecognized request argument supplied: reasoning_effort"), []);
  // max_tokens must not be read as the level "max".
  assert.deepEqual(parseSupportedEfforts("Supported values are: 'low' and 'high'. See max_tokens."), ["low", "high"]);
});

test("Given fast When a model refuses none Then low is preferred over minimal", () => {
  const body = openAiRejects("none", "'minimal', 'low', 'medium', and 'high'");
  assert.equal(nextReasoningEffort("fast", body, new Set(["none"])), "low");
});

test("Given fast When a model only allows high levels Then the cheapest allowed is used", () => {
  // GLM-style: reasoning cannot be switched off over chat/completions.
  const body = openAiRejects("none", "'high' and 'max'");
  assert.equal(nextReasoningEffort("fast", body, new Set(["none"])), "high");
});

test("Given fast When the error lists no values Then it steps none, low, minimal, then drops the field", () => {
  const body = JSON.stringify({ error: { message: "Invalid value for reasoning_effort" } });
  assert.equal(nextReasoningEffort("fast", body, new Set(["none"])), "low");
  assert.equal(nextReasoningEffort("fast", body, new Set(["none", "low"])), "minimal");
  assert.equal(nextReasoningEffort("fast", body, new Set(["none", "low", "minimal"])), null);
});

test("Given an explicit level When it is refused Then the nearest supported level is used, or the field is dropped", () => {
  assert.equal(nextReasoningEffort("medium", openAiRejects("medium", "'low' and 'high'"), new Set(["medium"])), "low");
  assert.equal(nextReasoningEffort("high", openAiRejects("high", "'low', 'medium'"), new Set(["high"])), "medium");
  assert.equal(nextReasoningEffort("medium", "Unrecognized request argument supplied: reasoning_effort", new Set(["medium"])), null);
});

test("Given an effort When describing it for the connection test Then it reads naturally", () => {
  assert.equal(describeReasoningEffort("none"), "reasoning off");
  assert.equal(describeReasoningEffort("low"), "reasoning low");
  assert.equal(describeReasoningEffort(null), "provider's default reasoning");
});

test("Given time limit text When normalizing Then blanks default, zero disables and values are clamped", () => {
  assert.equal(normalizeTimeLimitSeconds(""), 30);
  assert.equal(normalizeTimeLimitSeconds("0"), 0);
  assert.equal(normalizeTimeLimitSeconds("12"), 12);
  assert.equal(normalizeTimeLimitSeconds("12s"), 12);
  assert.equal(normalizeTimeLimitSeconds("2,5"), 5);
  assert.equal(normalizeTimeLimitSeconds("9999"), 300);
  assert.equal(normalizeTimeLimitSeconds("soon"), 30);
  assert.equal(normalizeTimeLimitSeconds(-4), 30);
  assert.equal(deadlineFromSeconds(0, 1000), null);
  assert.equal(deadlineFromSeconds(10, 1000), 11000);
});
