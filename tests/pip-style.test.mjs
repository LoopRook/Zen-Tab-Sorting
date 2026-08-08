import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG, normalizePipSize, pipRadiusFor, pipSizePrefFor, pipOpenSizeFor, pipMetrics } from "../modules/config.mjs";

test("Given no stored pip size When normalized Then the original default size is used", () => {
  assert.equal(normalizePipSize(""), CONFIG.PIP_SIZE_DEFAULT);
  assert.equal(normalizePipSize(undefined), CONFIG.PIP_SIZE_DEFAULT);
  assert.equal(normalizePipSize("not a number"), CONFIG.PIP_SIZE_DEFAULT);
});

test("Given a valid pip size When normalized Then it is returned as a number", () => {
  assert.equal(normalizePipSize("12"), 12);
  assert.equal(normalizePipSize("  10  "), 10);
});

test("Given an out-of-range pip size When normalized Then it is clamped to the bounds", () => {
  assert.equal(normalizePipSize("1"), CONFIG.PIP_SIZE_MIN);
  assert.equal(normalizePipSize("999"), CONFIG.PIP_SIZE_MAX);
  assert.equal(normalizePipSize("-5"), CONFIG.PIP_SIZE_MIN);
});

test("Given the circle shape When resolving radius Then it is fully rounded at any size", () => {
  assert.equal(pipRadiusFor("circle", 8), "50%");
  assert.equal(pipRadiusFor("circle", 20), "50%");
});

test("Given the square shape When resolving radius Then the corner radius scales with the size", () => {
  assert.equal(pipRadiusFor("square", 8), "2px");
  assert.equal(pipRadiusFor("square", 16), "4px");
});

test("Given each shape When resolving its size pref Then the two shapes use separate prefs", () => {
  assert.equal(pipSizePrefFor("circle"), CONFIG.PIP_SIZE_CIRCLE_PREF);
  assert.equal(pipSizePrefFor("square"), CONFIG.PIP_SIZE_SQUARE_PREF);
  assert.notEqual(pipSizePrefFor("circle"), pipSizePrefFor("square"));
});

test("Given an unknown shape When resolving its size pref Then it falls back to the circle pref", () => {
  assert.equal(pipSizePrefFor(""), CONFIG.PIP_SIZE_CIRCLE_PREF);
  assert.equal(pipSizePrefFor(undefined), CONFIG.PIP_SIZE_CIRCLE_PREF);
});

test("Given the smaller open behavior When sizing the marker Then it shrinks but stays visible", () => {
  assert.equal(pipOpenSizeFor("smaller", 8), 5);
  assert.equal(pipOpenSizeFor("smaller", 20), 12);
  // Floor: the smallest allowed closed size must not shrink into nothing.
  assert.ok(pipOpenSizeFor("smaller", CONFIG.PIP_SIZE_MIN) >= CONFIG.PIP_OPEN_MIN);
});

test("Given the same-size open behavior When sizing the marker Then it matches the closed size", () => {
  assert.equal(pipOpenSizeFor("same", 8), 8);
  assert.equal(pipOpenSizeFor("same", 24), 24);
});

test("Given the hidden open behavior When sizing the marker Then it is zero so nothing is drawn", () => {
  assert.equal(pipOpenSizeFor("hidden", 8), 0);
  assert.equal(pipOpenSizeFor("hidden", 24), 0);
});

test("Given an unknown open behavior When sizing the marker Then it defaults to shrinking", () => {
  assert.equal(pipOpenSizeFor("", 8), pipOpenSizeFor("smaller", 8));
});

test("Given the None shape When resolving metrics Then the marker is hidden in both states", () => {
  const m = pipMetrics("none", 8, "smaller");
  assert.equal(m.display, "none");
  assert.equal(m.openDisplay, "none");
  assert.equal(m.size, 0);
  assert.equal(m.openSize, 0);
  // Label keeps the plain indent it would have without a marker.
  assert.equal(m.pad, CONFIG.PIP_LABEL_PAD_BARE);
  assert.equal(m.openPad, CONFIG.PIP_LABEL_PAD_BARE);
});

test("Given a circle marker When resolving metrics Then both states are drawn and padded for the size", () => {
  const m = pipMetrics("circle", 8, "smaller");
  assert.equal(m.display, "block");
  assert.equal(m.size, 8);
  assert.equal(m.radius, "50%");
  assert.equal(m.pad, `${8 + CONFIG.PIP_LABEL_GAP}px`);
  assert.equal(m.openSize, 5);
  assert.equal(m.openDisplay, "block");
});

test("Given a square marker When resolving metrics Then each state gets a radius scaled to its own size", () => {
  const m = pipMetrics("square", 16, "smaller");
  assert.equal(m.radius, "4px");
  assert.equal(m.openSize, 10);
  assert.equal(m.openRadius, "2.5px");
});

test("Given the hidden open behavior When resolving metrics Then only the open state is undrawn", () => {
  const m = pipMetrics("circle", 8, "hidden");
  assert.equal(m.display, "block");
  assert.equal(m.openDisplay, "none");
  assert.equal(m.openPad, CONFIG.PIP_LABEL_PAD_BARE);
});
