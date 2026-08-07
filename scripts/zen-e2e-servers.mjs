import { createServer } from "node:http";

import { familyForPromptText, fixturePageForPath } from "./zen-e2e-fixtures.mjs";

const DEFAULT_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.5-flash";

export const startFixturePageServer = () => startServer((request, response) => {
  const page = fixturePageForPath(request.url || "");
  const label = page?.title || request.url?.replace(/\W+/g, " ").trim() || "Zen Tab Sorting fixture";
  const description = page?.description || label;
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end([
    `<!doctype html><title>${escapeHtml(label)}</title>`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Zen Tab Sorting E2E Fixture">`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<h1>${escapeHtml(label)}</h1>`,
  ].join(""));
});

export const startProviderServer = async (providerMode = "fake") => {
  const calls = [];
  const handler = providerMode === "real" ? realProviderHandler(calls, realProviderConfig()) : fakeProviderHandler(calls);
  const server = await startServer(handler);
  return { ...server, calls, mode: providerMode };
};

const startServer = (handler) => new Promise((resolvePromise) => {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolvePromise({
      port: address.port,
      close: () => new Promise((resolveClose) => server.close(resolveClose)),
    });
  });
});

const fakeProviderHandler = (calls) => async (request, response) => {
  const { body, rawBody } = await readJsonBody(request);
  const lines = promptLines(body);
  calls.push({ provider: "fake", tabCount: lines.length, requestBytes: Buffer.byteLength(rawBody) });
  const assignments = Object.fromEntries(lines.map((line) => [
    line.index,
    `${familyForPromptText(line.host, line.title)} AI`,
  ]));
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(assignments) } }] }));
};

const realProviderHandler = (calls, config) => async (request, response) => {
  const startedAt = Date.now();
  const { body, rawBody } = await readJsonBody(request);
  const lines = promptLines(body);
  const upstreamBody = JSON.stringify({ ...body, model: config.model });
  const upstream = await fetch(`${config.endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: upstreamBody,
  });
  const text = await upstream.text();
  calls.push({
    provider: "real",
    endpoint: redactEndpoint(config.endpoint),
    model: config.model,
    status: upstream.status,
    durationMs: Date.now() - startedAt,
    tabCount: lines.length,
    requestBytes: Buffer.byteLength(rawBody),
    responseBytes: Buffer.byteLength(text),
  });
  response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json" });
  response.end(text);
};

const readJsonBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return { body: JSON.parse(rawBody || "{}"), rawBody };
};

const promptLines = (body) => {
  const content = body.messages?.[0]?.content || "";
  return [...String(content).matchAll(/^(\d+)\. ([^\n]+?) — "([^"]*)"/gm)].map((match) => ({
    index: match[1],
    host: match[2],
    title: match[3],
  }));
};

const realProviderConfig = () => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required when --provider real");
  return {
    apiKey,
    endpoint: normalizeEndpoint(process.env.OPENROUTER_ENDPOINT || DEFAULT_OPENROUTER_ENDPOINT),
    model: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
  };
};

const normalizeEndpoint = (endpoint) => endpoint.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");

const redactEndpoint = (endpoint) => {
  const url = new URL(endpoint);
  return `${url.origin}${url.pathname}`;
};

const escapeHtml = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
