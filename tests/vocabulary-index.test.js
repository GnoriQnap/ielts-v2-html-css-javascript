import test from "node:test";
import assert from "node:assert/strict";
import { createVocabularyIndex } from "../js/core/vocabulary-index.js";

test("index keeps the first display text and all category memberships", () => {
  const groups = [
    { group_id: 1, category: "分类一", words: ["  Sustain  ", "other"] },
    { group_id: 2, category: "分类二", words: ["sustain"] },
    { group_id: 3, category: "分类三", words: ["SUSTAIN"] }
  ];

  const index = createVocabularyIndex(groups);

  assert.equal(index.displayByWordKey.get("sustain"), "  Sustain  ");
  assert.deepEqual([...index.groupIdsByWordKey.get("sustain")], [1, 2, 3]);
  assert.deepEqual([...index.rawVariantsByWordKey.get("sustain")], ["  Sustain  ", "sustain", "SUSTAIN"]);
});

test("duplicates inside one category do not duplicate group membership", () => {
  const index = createVocabularyIndex([
    { group_id: 1, category: "分类一", words: ["report", "REPORT"] }
  ]);

  assert.deepEqual([...index.groupIdsByWordKey.get("report")], [1]);
  assert.deepEqual(index.allWordKeys, ["report"]);
});
