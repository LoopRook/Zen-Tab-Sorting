import test from "node:test";
import assert from "node:assert/strict";

import { fetchPageSnippets } from "../modules/tabs.mjs";

test("Given many tabs When fetching snippets Then only a few requests run at once and order is kept", async () => {
  let active = 0;
  let peak = 0;
  const fetchOne = async (url) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return `snippet:${url}`;
  };
  const urls = Array.from({ length: 20 }, (_, i) => `https://s${i}.example.test/`);
  const out = await fetchPageSnippets(urls, { concurrency: 6, fetchOne });
  assert.equal(peak, 6);
  assert.deepEqual(out, urls.map((u) => `snippet:${u}`));
});

test("Given non-web URLs When fetching snippets Then they get no request", async () => {
  const seen = [];
  const out = await fetchPageSnippets(["about:blank", "", "file:///x", "https://a.example.test/"], {
    fetchOne: async (url) => { seen.push(url); return "ok"; },
  });
  assert.deepEqual(seen, ["https://a.example.test/"]);
  assert.deepEqual(out, ["", "", "", "ok"]);
});

test("Given the overall budget runs out When fetching snippets Then the remaining tabs are skipped", async () => {
  let calls = 0;
  const fetchOne = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 30));
    return "s";
  };
  const urls = Array.from({ length: 10 }, (_, i) => `https://s${i}.example.test/`);
  const out = await fetchPageSnippets(urls, { concurrency: 1, budgetMs: 45, fetchOne });
  assert.ok(calls >= 1 && calls <= 3, `calls=${calls}`);
  assert.equal(out.filter(Boolean).length, calls);
});
