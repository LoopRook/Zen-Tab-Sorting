import test from "node:test";
import assert from "node:assert/strict";

import { poolEmbedding } from "../modules/ai.mjs";

test("Given a pooled Tensor from the ML engine When pooling Then its data becomes the vector", () => {
  const tensor = { dims: [1, 3], type: "float32", data: new Float32Array([0.5, -0.25, 1]) };
  assert.deepEqual(poolEmbedding(tensor), [0.5, -0.25, 1]);
});

test("Given the batched array shapes When pooling Then they still work", () => {
  assert.deepEqual(poolEmbedding([[1, 2, 3]]), [1, 2, 3]);
  assert.deepEqual(poolEmbedding([[[1, 2], [3, 4]]]), [2, 3]);
  assert.deepEqual(poolEmbedding([{ embedding: [[2, 4], [4, 8]] }]), [3, 6]);
});

test("Given nothing usable When pooling Then null is returned", () => {
  assert.equal(poolEmbedding(null), null);
  assert.equal(poolEmbedding({ data: [] }), null);
  assert.equal(poolEmbedding({ nope: true }), null);
});
