import test from "node:test";
import assert from "node:assert/strict";

import {
  isSavedCollapsed,
  MAX_COLLAPSED_ENTRIES,
  migrateLegacyEntries,
  parseCollapsedEntries,
  serializeCollapsedEntries,
  updateCollapsedEntries,
} from "../modules/collapsed-state.mjs";

test("Given the old label list When parsing Then each label reads as a collapsed label-only entry", () => {
  assert.deepEqual(parseCollapsedEntries('["Dev","Research"]'), [
    { id: null, label: "Dev", collapsed: true },
    { id: null, label: "Research", collapsed: true },
  ]);
  assert.deepEqual(parseCollapsedEntries(""), []);
  assert.deepEqual(parseCollapsedEntries("{nope"), []);
  assert.deepEqual(parseCollapsedEntries('{"a":1}'), []);
});

test("Given mixed entries When round-tripping Then ids, labels and states survive", () => {
  const entries = [
    { id: null, label: "Legacy", collapsed: true },
    { id: "g1", label: "Dev", collapsed: true },
    { id: "g2", label: "Dev", collapsed: false },
  ];
  assert.deepEqual(parseCollapsedEntries(serializeCollapsedEntries(entries)), entries);
});

test("Given two groups with the same name When only one is collapsed Then only that one comes back collapsed", () => {
  let entries = [];
  entries = updateCollapsedEntries(entries, { id: "a", label: "Research" }, true);
  assert.equal(isSavedCollapsed(entries, { id: "a", label: "Research" }), true);
  assert.equal(isSavedCollapsed(entries, { id: "b", label: "Research" }), false);
});

test("Given a group already in the recorded state When updating Then nothing is written", () => {
  const entries = [{ id: "a", label: "Dev", collapsed: true }];
  assert.equal(updateCollapsedEntries(entries, { id: "a", label: "Dev" }, true), null);
  // Expanding a group nobody recorded needs no entry either.
  assert.equal(updateCollapsedEntries(entries, { id: "z", label: "Other" }, false), null);
});

test("Given a legacy label entry When a same-named group is expanded Then it is recorded open and stays open", () => {
  const entries = parseCollapsedEntries('["Research"]');
  const next = updateCollapsedEntries(entries, { id: "b", label: "Research" }, false);
  assert.equal(isSavedCollapsed(next, { id: "b", label: "Research" }), false);
  // The legacy entry still covers the not-yet-migrated sibling.
  assert.equal(isSavedCollapsed(next, { id: "a", label: "Research" }), true);
});

test("Given legacy entries and restored groups When migrating Then matched labels become id entries", () => {
  const entries = parseCollapsedEntries('["Research","Elsewhere"]');
  const next = migrateLegacyEntries(entries, [
    { id: "a", label: "Research", collapsed: true },
    { id: "b", label: "Research", collapsed: false },
    { id: "c", label: "Dev", collapsed: true },
  ]);
  assert.deepEqual(next, [
    { id: null, label: "Elsewhere", collapsed: true },
    { id: "a", label: "Research", collapsed: true },
    { id: "b", label: "Research", collapsed: false },
  ]);
  assert.equal(migrateLegacyEntries(next.filter((e) => e.id), []), null);
});

test("Given a group without an id When recording Then a label entry is used", () => {
  const next = updateCollapsedEntries([], { id: "", label: "Loose" }, true);
  assert.deepEqual(next, [{ id: null, label: "Loose", collapsed: true }]);
  assert.equal(isSavedCollapsed(next, { id: "", label: "Loose" }), true);
});

test("Given more entries than the cap When serializing Then the oldest are dropped", () => {
  const many = Array.from({ length: MAX_COLLAPSED_ENTRIES + 5 }, (_, i) => ({ id: `g${i}`, label: "x", collapsed: true }));
  const parsed = parseCollapsedEntries(serializeCollapsedEntries(many));
  assert.equal(parsed.length, MAX_COLLAPSED_ENTRIES);
  assert.equal(parsed[0].id, "g5");
});

test("Given an id-less group under a legacy label When it is expanded Then it stays expanded after a round trip", () => {
  const entries = [{ id: null, label: "Research", collapsed: true }, { id: null, label: "Research", collapsed: true }];
  const next = updateCollapsedEntries(entries, { id: "", label: "Research" }, false);
  const reread = parseCollapsedEntries(serializeCollapsedEntries(next));
  assert.equal(isSavedCollapsed(reread, { id: "", label: "Research" }), false);
});

test("Given a collapsed group When it is expanded and nothing else applies Then its entry is removed", () => {
  const entries = [{ id: "a", label: "Dev", collapsed: true }];
  assert.deepEqual(updateCollapsedEntries(entries, { id: "a", label: "Dev" }, false), []);
});
