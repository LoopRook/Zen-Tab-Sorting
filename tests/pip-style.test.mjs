import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG, normalizePipSize, pipRadiusFor, pipSizePrefFor } from "../modules/config.mjs";

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
