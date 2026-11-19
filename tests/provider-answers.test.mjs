import test from "node:test";
import assert from "node:assert/strict";

import { describeUnusableResponse, parseAnswerObject } from "../modules/provider-requests.mjs";
import { testProviderConnection } from "../modules/remote-provider.mjs";

test("Given a plain JSON answer When parsing Then it is returned", () => {
  assert.deepEqual(parseAnswerObject('{"0":"Dev"}'), { 0: "Dev" });
});

test("Given a fenced answer When parsing Then the fence is removed", () => {
  assert.deepEqual(parseAnswerObject('```json\n{"0":"Dev"}\n```'), { 0: "Dev" });
});

test("Given a leading think block When parsing Then it is skipped", () => {
  assert.deepEqual(parseAnswerObject('<think>tab 0 looks like {code}</think>\n{"0":"Dev"}'), { 0: "Dev" });
});

test("Given prose around one object When parsing Then the object is extracted", () => {
  assert.deepEqual(parseAnswerObject('Here you go: {"0":"News","1":"Dev {beta}"} — hope that helps.'), { 0: "News", 1: "Dev {beta}" });
});

test("Given two objects or a truncated one When parsing Then it refuses to guess", () => {
  assert.throws(() => parseAnswerObject('{"0":"A"} or maybe {"0":"B"}'), /more than one/);
  assert.throws(() => parseAnswerObject('{"0":"A","1":"B'), /non-JSON/);
  assert.throws(() => parseAnswerObject("[1,2]"), /non-object|non-JSON/);
});

test("Given 200 responses that are not answers When checking Then each is named", () => {
  assert.match(describeUnusableResponse("openai", JSON.stringify({ error: { message: "Rate limit exceeded", code: 429 } })), /reported an error: Rate limit/);
  assert.match(describeUnusableResponse("openai", JSON.stringify({ choices: [{ finish_reason: "length", message: { content: '{"0":"A"' } }] })), /output limit/);
  assert.match(describeUnusableResponse("gemini", JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS" }] })), /output limit/);
  assert.match(describeUnusableResponse("ollama", JSON.stringify({ response: "{", done_reason: "length" })), /output limit/);
  assert.match(describeUnusableResponse("openai", JSON.stringify({ choices: [{ finish_reason: "content_filter", message: { content: "" } }] })), /blocked/);
  assert.equal(describeUnusableResponse("openai", JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] })), "");
  assert.equal(describeUnusableResponse("openai", "not json"), "");
});

test("Given a gateway error inside a 200 When testing the connection Then the error is reported, not 'no text'", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "No endpoints found for this model" } }), { status: 200 });
  try {
    const result = await testProviderConnection({
      provider: "openai", consentToSendData: true, endpoint: "https://gateway-200.example.test/v1", apiKey: "sk", model: "m",
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /No endpoints found/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
