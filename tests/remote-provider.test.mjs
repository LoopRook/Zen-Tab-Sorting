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
      assert.equal(calls[0].body.max_completion_tokens, 64);
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
      assert.equal(calls[0].body.max_tokens, 64);
      assert.equal(calls[0].body.temperature, 0.2);
      assert.equal(calls[1].body.max_completion_tokens, 64);
      assert.equal("temperature" in calls[1].body, false);

      // The detected shape is cached, so the second call does not pay for the
      // rejected request again.
      const second = await testProviderConnection(settings);
      assert.equal(second.ok, true);
      assert.equal(calls.length, 3);
      assert.equal(calls[2].body.max_completion_tokens, 64);
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
