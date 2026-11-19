import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyExistingGroupsRemoteBatch,
  runPass2Remote,
  runPass2RemoteFresh,
  testProviderConnection,
} from "../modules/remote-provider.mjs";

test("Given ready OpenAI provider When remote Pass 2 runs Then it returns an applyPass2-shaped plan", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ 0: "Dev", 1: "Recipes" }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const tabs = [
      { hostname: "github.com", title: "Pull request", url: "" },
      { hostname: "seriouseats.com", title: "Soup", url: "" },
    ];
    const plan = await runPass2Remote(tabs, [{ name: "Dev", domains: ["github.com"] }], {
      provider: "openai",
      consentToSendData: true,
      endpoint: "https://api.example.test/v1",
      apiKey: "sk-test",
      model: "gpt-tabs",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.example.test/v1/chat/completions");
    assert.deepEqual(plan.assignedToExisting, [{ tabInfo: tabs[0], groupName: "Dev", similarity: 1 }]);
    assert.deepEqual(plan.newGroups, [{ name: "Recipes", tabs: [tabs[1]] }]);
    assert.deepEqual(plan.skipped, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Given remote provider without consent When remote Pass 2 runs Then no fetch is made", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("unexpected fetch");
  };

  try {
    const tabs = [{ hostname: "github.com", title: "Pull request", url: "" }];
    const plan = await runPass2Remote(tabs, [{ name: "Dev", domains: ["github.com"] }], {
      provider: "openai",
      consentToSendData: false,
      endpoint: "https://api.example.test/v1",
      apiKey: "sk-test",
      model: "gpt-tabs",
    });

    assert.equal(calls, 0);
    assert.equal(plan.failed, "consent_required");
    assert.deepEqual(plan.skipped, tabs);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Given remote provider without consent When Plan Mode remote reassignment runs Then no fetch is made", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("unexpected fetch");
  };

  try {
    const tabs = [{ hostname: "github.com", title: "Pull request", url: "" }];
    const assignments = await classifyExistingGroupsRemoteBatch(tabs, [{ name: "Dev", domains: ["github.com"] }], {
      provider: "openai",
      consentToSendData: false,
      endpoint: "https://api.example.test/v1",
      apiKey: "sk-test",
      model: "gpt-tabs",
    });

    assert.equal(calls, 0);
    assert.deepEqual([...assignments.entries()], [[0, null]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Given OpenAI provider wraps JSON in a markdown fence When remote Pass 2 runs Then the plan still applies", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: "```json\n{\"0\":\"Dev\",\"1\":\"Recipes\"}\n```" } }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const tabs = [
      { hostname: "github.com", title: "Pull request", url: "" },
      { hostname: "seriouseats.com", title: "Soup", url: "" },
    ];
    const plan = await runPass2Remote(tabs, [{ name: "Dev", domains: ["github.com"] }], {
      provider: "openai",
      consentToSendData: true,
      endpoint: "https://api.example.test/v1",
      apiKey: "sk-test",
      model: "gpt-tabs",
    });

    assert.equal(plan.failed, undefined);
    assert.deepEqual(plan.assignedToExisting, [{ tabInfo: tabs[0], groupName: "Dev", similarity: 1 }]);
    assert.deepEqual(plan.newGroups, [{ name: "Recipes", tabs: [tabs[1]] }]);
    assert.deepEqual(plan.skipped, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Given full AI remote sorting over many tabs When provider is called Then fresh prompts use smaller chunks", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const prompt = JSON.parse(init.body).messages[0].content;
    const tabLines = [...prompt.matchAll(/^(\d+)\. ([^\n]+?) — "([^"]*)"/gm)];
    const isMergePrompt = prompt.includes("Categories to review");
    calls.push(isMergePrompt ? "merge" : tabLines.length);
    const assignments = isMergePrompt
      ? { "Batch A": "Batch", "Batch B": "Batch", "Batch C": "Batch" }
      : Object.fromEntries(tabLines.map((match) => [match[1], `Batch ${calls.length === 1 ? "A" : calls.length === 2 ? "B" : "C"}`]));
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(assignments) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const tabs = Array.from({ length: 80 }, (_, idx) => ({
      hostname: `site-${idx}.example.test`,
      title: `Tab ${idx}`,
      url: "",
    }));
    const plan = await runPass2RemoteFresh(tabs, {
      provider: "openai",
      consentToSendData: true,
      endpoint: "https://api.example.test/v1",
      apiKey: "sk-test",
      model: "gpt-tabs",
    });

    assert.deepEqual(calls, [35, 35, 10, "merge"]);
    assert.equal(plan.newGroups.length, 1);
    assert.equal(plan.newGroups[0].tabs.length, 80);
    assert.deepEqual(plan.skipped, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// The GPT-5 generation rejects max_tokens and a non-default temperature, while
// local OpenAI-compatible servers only understand those. These cover the
// handshake that lets one engine serve both.

const okBody = () => JSON.stringify({ choices: [{ message: { content: "ok" } }] });

const unsupportedParamBody = JSON.stringify({
  error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." },
});

const withStubbedFetch = async (handler, run) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return handler(calls.length);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test("Given a GPT-5 model name When testing the connection Then the first request already uses max_completion_tokens", async () => {
  await withStubbedFetch(
    () => new Response(okBody(), { status: 200 }),
    async (calls) => {
      const result = await testProviderConnection({
        provider: "openai",
        consentToSendData: true,
        endpoint: "https://api.openai.test/v1",
        apiKey: "sk-test",
        model: "gpt-5.6-luna",
      });

      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.max_completion_tokens, 4352);
      assert.equal("max_tokens" in calls[0].body, false);
    },
  );
});

test("Given a server that rejects max_tokens When a request is sent Then it retries once with the modern shape and remembers it", async () => {
  await withStubbedFetch(
    (n) => (n === 1
      ? new Response(unsupportedParamBody, { status: 400 })
      : new Response(okBody(), { status: 200 })),
    async (calls) => {
      const settings = {
        provider: "openai",
        consentToSendData: true,
        endpoint: "https://gateway.example.test/v1",
        apiKey: "sk-test",
        model: "house-model",
      };

      const first = await testProviderConnection(settings);
      assert.equal(first.ok, true);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].body.max_tokens, 256);
      assert.equal(calls[0].body.temperature, 0.2);
      assert.equal(calls[1].body.max_completion_tokens, 4352);
      assert.equal("temperature" in calls[1].body, false);

      // The detected shape is cached, so the second call does not pay for the
      // rejected request again.
      const second = await testProviderConnection(settings);
      assert.equal(second.ok, true);
      assert.equal(calls.length, 3);
      assert.equal(calls[2].body.max_completion_tokens, 4352);
    },
  );
});

test("Given a 400 that is not about parameters When a request is sent Then it fails without a retry", async () => {
  await withStubbedFetch(
    () => new Response(JSON.stringify({ error: { message: "The model `nope` does not exist" } }), { status: 400 }),
    async (calls) => {
      const result = await testProviderConnection({
        provider: "openai",
        consentToSendData: true,
        endpoint: "https://api.openai.test/v1",
        apiKey: "sk-test",
        model: "nope",
      });

      assert.equal(result.ok, false);
      assert.equal(calls.length, 1);
      assert.match(result.error, /does not exist/);
    },
  );
});

test("Given an Ollama provider When a request is sent Then no parameter-shape retry is attempted", async () => {
  await withStubbedFetch(
    () => new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens'" } }), { status: 400 }),
    async (calls) => {
      const result = await testProviderConnection({
        provider: "ollama",
        consentToSendData: true,
        endpoint: "http://localhost:11434",
        apiKey: "",
        model: "llama3.2",
      });

      assert.equal(result.ok, false);
      assert.equal(calls.length, 1);
    },
  );
});

// Reasoning effort: "fast" (the default) asks for reasoning off, corrects
// itself from the provider's rejection, and remembers what was accepted.
// Each test uses its own endpoint because the accepted shape is cached per
// endpoint + model + preference for the life of the module.

const remoteSettings = (endpoint, extra = {}) => ({
  provider: "openai",
  consentToSendData: true,
  endpoint,
  apiKey: "sk-test",
  model: "house-model",
  ...extra,
});

test("Given the default preference When a request is sent Then reasoning is switched off", async () => {
  await withStubbedFetch(
    () => new Response(okBody(), { status: 200 }),
    async (calls) => {
      const result = await testProviderConnection(remoteSettings("https://fast-default.example.test/v1"));
      assert.equal(result.ok, true);
      assert.equal(calls[0].body.reasoning_effort, "none");
      assert.equal(result.reasoning, "reasoning off");
      assert.equal(typeof result.ms, "number");
    },
  );
});

test("Given a model that cannot switch reasoning off When fast is requested Then the cheapest listed level is used and remembered", async () => {
  const refusal = JSON.stringify({
    error: { message: "Unsupported value: 'reasoning_effort' does not support 'none' with this model. Supported values are: 'minimal', 'low', 'medium', and 'high'." },
  });
  await withStubbedFetch(
    (n) => (n === 1 ? new Response(refusal, { status: 400 }) : new Response(okBody(), { status: 200 })),
    async (calls) => {
      const settings = remoteSettings("https://no-off.example.test/v1");
      const first = await testProviderConnection(settings);
      assert.equal(first.ok, true);
      assert.deepEqual(calls.map((c) => c.body.reasoning_effort), ["none", "low"]);
      assert.equal(first.reasoning, "reasoning low");

      await testProviderConnection(settings);
      assert.equal(calls.length, 3);
      assert.equal(calls[2].body.reasoning_effort, "low");
    },
  );
});

test("Given a server that does not know reasoning_effort When a request is sent Then it retries without the field and remembers", async () => {
  const unknown = JSON.stringify({ error: { message: "Unrecognized request argument supplied: reasoning_effort" } });
  await withStubbedFetch(
    (n) => (n === 1 ? new Response(unknown, { status: 400 }) : new Response(okBody(), { status: 200 })),
    async (calls) => {
      const settings = remoteSettings("https://local-server.example.test/v1", { reasoningEffort: "medium" });
      const first = await testProviderConnection(settings);
      assert.equal(first.ok, true);
      assert.equal(calls[0].body.reasoning_effort, "medium");
      assert.equal("reasoning_effort" in calls[1].body, false);
      // Classic shape kept throughout: the shape was never the problem.
      assert.equal(calls[1].body.max_tokens, 256);

      await testProviderConnection(settings);
      assert.equal(calls.length, 3);
      assert.equal("reasoning_effort" in calls[2].body, false);
    },
  );
});

test("Given a rejected shape and a rejected reasoning value When a request is sent Then both are corrected", async () => {
  await withStubbedFetch(
    (n) => (n === 1
      ? new Response(unsupportedParamBody, { status: 400 })
      : n === 2
        ? new Response(JSON.stringify({ error: { message: "reasoning_effort 'none' is not supported" } }), { status: 400 })
        : new Response(okBody(), { status: 200 })),
    async (calls) => {
      const result = await testProviderConnection(remoteSettings("https://both.example.test/v1"));
      assert.equal(result.ok, true);
      assert.equal(calls.length, 3);
      assert.equal(calls[2].body.max_completion_tokens, 4352);
      assert.equal(calls[2].body.reasoning_effort, "low");
    },
  );
});

test("Given the provider-default preference When a request is sent Then no reasoning field is sent", async () => {
  await withStubbedFetch(
    () => new Response(okBody(), { status: 200 }),
    async (calls) => {
      const result = await testProviderConnection(remoteSettings("https://provider-default.example.test/v1", { reasoningEffort: "default" }));
      assert.equal(result.ok, true);
      assert.equal("reasoning_effort" in calls[0].body, false);
      assert.equal(result.reasoning, "provider's default reasoning");
    },
  );
});

test("Given a provider that keeps refusing When a request is sent Then the retries are bounded", async () => {
  const refusal = JSON.stringify({ error: { message: "Invalid value for reasoning_effort" } });
  await withStubbedFetch(
    () => new Response(refusal, { status: 400 }),
    async (calls) => {
      const result = await testProviderConnection(remoteSettings("https://stubborn.example.test/v1"));
      assert.equal(result.ok, false);
      // none, low, minimal, then no field at all; the field-less request's
      // rejection is not a reasoning complaint the loop can act on anymore.
      assert.ok(calls.length <= 5);
      assert.equal("reasoning_effort" in calls.at(-1).body, false);
    },
  );
});

test("Given the AI time limit runs out mid-pass When sorting Then finished batches are kept and the rest are not sent", async () => {
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    const prompt = JSON.parse(init.body).messages[0].content;
    const tabLines = [...prompt.matchAll(/^(\d+)\. /gm)];
    // The first batch answers, then the provider "takes" a minute.
    clock += 60_000;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(Object.fromEntries(tabLines.map((m) => [m[1], "Reading"]))) } }],
    }), { status: 200 });
  };
  try {
    const tabs = Array.from({ length: 80 }, (_, idx) => ({ hostname: `s${idx}.example.test`, title: `T${idx}`, url: "" }));
    const plan = await runPass2RemoteFresh(tabs, remoteSettings("https://slow.example.test/v1", { timeLimitSeconds: "10" }));
    assert.equal(calls, 1);
    assert.equal(plan.newGroups.length, 1);
    assert.equal(plan.newGroups[0].tabs.length, 35);
    assert.equal(plan.skipped.length, 45);
  } finally {
    Date.now = realNow;
    globalThis.fetch = originalFetch;
  }
});

test("Given a transient server error When a request is sent Then it is retried once", async () => {
  const serverError = JSON.stringify({ error: { message: "The server had an error while processing your request. Sorry about that!", type: "server_error" } });
  await withStubbedFetch(
    (n) => (n === 1 ? new Response(serverError, { status: 500 }) : new Response(okBody(), { status: 200 })),
    async (calls) => {
      const result = await testProviderConnection(remoteSettings("https://flaky.example.test/v1"));
      assert.equal(result.ok, true);
      assert.equal(calls.length, 2);
    },
  );
});

test("Given a persistent server error When a request is sent Then it fails after one retry", async () => {
  const serverError = JSON.stringify({ error: { message: "The server had an error", type: "server_error" } });
  await withStubbedFetch(
    () => new Response(serverError, { status: 500 }),
    async (calls) => {
      const result = await testProviderConnection(remoteSettings("https://down.example.test/v1"));
      assert.equal(result.ok, false);
      assert.equal(calls.length, 2);
      assert.match(result.error, /HTTP 500/);
    },
  );
});
