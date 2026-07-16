import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCategoryName, normalizeWordKey } from "../js/core/normalization.js";

test("wordKey only normalizes Unicode, outer whitespace, and case", () => {
  assert.equal(normalizeWordKey("  Thought(Think)  "), "thought(think)");
  assert.equal(normalizeWordKey("word / phrase"), "word / phrase");
  assert.equal(normalizeWordKey("high-quality"), "high-quality");
  assert.equal(normalizeWordKey("two  spaces"), "two  spaces");
});

test("invalid word values become an empty key", () => {
  assert.equal(normalizeWordKey(null), "");
  assert.equal(normalizeWordKey(42), "");
  assert.equal(normalizeWordKey("   "), "");
});

test("category normalization preserves internal text", () => {
  assert.equal(normalizeCategoryName("  包括，包含（举例）  "), "包括，包含（举例）");
});
