const RETRY_BATCH_SIZES = [12, 4, 1];

export const collectProviderTabMap = async ({
  tabs,
  snippets = [],
  initialBatchSize,
  label,
  buildPrompt,
  fetchJson,
}) => {
  const parsedByIndex = new Map();
  const failures = [];
  let pending = tabs.map((_, index) => index);

  for (const batchSize of retryBatchSizes(initialBatchSize)) {
    if (pending.length === 0) break;
    const nextPending = [];
    for (const indices of chunkIndices(pending, batchSize)) {
      try {
        collectBatchAssignments({
          parsedByIndex,
          pending: nextPending,
          indices,
          parsed: await fetchJson(buildPrompt(
            indices.map((index) => tabs[index]),
            indices.map((index) => snippets[index]),
          )),
        });
      } catch (error) {
        if (batchSize === 1) failures.push(`${label} tab ${indices[0]}: ${error.message || error}`);
        else nextPending.push(...indices);
      }
    }
    pending = nextPending;
  }

  if (pending.length > 0) failures.push(`${label} missing assignments for ${pending.length} tab(s)`);
  return { parsedByIndex, failures, missing: pending };
};

const collectBatchAssignments = ({ parsedByIndex, pending, indices, parsed }) => {
  const assignedLocals = new Set();
  for (const [key, value] of Object.entries(parsed)) {
    const localIndex = Number.parseInt(key, 10);
    if (!Number.isFinite(localIndex) || localIndex < 0 || localIndex >= indices.length) continue;
    parsedByIndex.set(indices[localIndex], value);
    assignedLocals.add(localIndex);
  }
  for (let localIndex = 0; localIndex < indices.length; localIndex += 1) {
    if (!assignedLocals.has(localIndex)) pending.push(indices[localIndex]);
  }
};

const retryBatchSizes = (initialBatchSize) => {
  const normalizedInitial = Number.isFinite(initialBatchSize) && initialBatchSize > 0
    ? Math.floor(initialBatchSize)
    : RETRY_BATCH_SIZES[0];
  return [...new Set([normalizedInitial, ...RETRY_BATCH_SIZES].filter((size) => size <= normalizedInitial))];
};

const chunkIndices = (indices, batchSize) => {
  const chunks = [];
  for (let start = 0; start < indices.length; start += batchSize) {
    chunks.push(indices.slice(start, start + batchSize));
  }
  return chunks;
};
