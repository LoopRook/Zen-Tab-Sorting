// Zen Tab Sorting — provider request batching.
//
// Remote/provider LLMs should not receive a 300-tab prompt in one shot. Keep
// chunks bounded, then merge chunk-local JSON maps back onto original tabs.

export const PROVIDER_TAB_BATCH_SIZE = 75;

export const chunkTabsForProvider = (tabs, batchSize = PROVIDER_TAB_BATCH_SIZE) => {
  if (!Array.isArray(tabs) || tabs.length === 0) return [];
  const width = Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : PROVIDER_TAB_BATCH_SIZE;
  const chunks = [];
  for (let start = 0; start < tabs.length; start += width) {
    chunks.push({
      start,
      tabs: tabs.slice(start, start + width),
    });
  }
  return chunks;
};
