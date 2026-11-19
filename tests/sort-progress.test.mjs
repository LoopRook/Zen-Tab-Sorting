import test from "node:test";
import assert from "node:assert/strict";

import { clearSortProgress, progressText, setSortProgress } from "../modules/sort-progress.mjs";
import { collectProviderTabMap } from "../modules/remote-assignment-retry.mjs";

test("Given counts When formatting progress Then a percentage and an exact count are produced", () => {
  assert.deepEqual(progressText(35, 80), { short: "43%", long: "Sorting with AI: 35 of 80 tab(s) answered" });
  assert.deepEqual(progressText(0, 80).short, "0%");
  assert.deepEqual(progressText(99, 80).short, "100%");
});

test("Given no browser window When reporting progress Then nothing throws", () => {
  setSortProgress(1, 2);
  clearSortProgress();
});

test("Given batched AI requests When collecting answers Then progress is reported after each batch", async () => {
  const seen = [];
  const tabs = Array.from({ length: 10 }, (_, i) => ({ title: `T${i}` }));
  await collectProviderTabMap({
    tabs,
    initialBatchSize: 4,
    label: "test",
    buildPrompt: (batch) => batch,
    fetchJson: async (batch) => Object.fromEntries(batch.map((_, i) => [String(i), "G"])),
    onProgress: (done, total) => seen.push(`${done}/${total}`),
  });
  assert.deepEqual(seen, ["0/10", "4/10", "8/10", "10/10"]);
});
