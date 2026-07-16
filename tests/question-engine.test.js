import test from "node:test";
import assert from "node:assert/strict";
import { vocabularyData } from "../js/data/vocabulary.js";
import { createVocabularyIndex } from "../js/core/vocabulary-index.js";
import {
  createQuestion,
  getEligibleWordKeys,
  isAnswerCorrect,
  selectRandomWordKey
} from "../js/core/question-engine.js";

const index = createVocabularyIndex(vocabularyData.vocabulary_list);

test("single-category word produces one correct group id", () => {
  const wordKey = index.allWordKeys.find((key) => index.groupIdsByWordKey.get(key).size === 1);
  const question = createQuestion(index, { wordKey });

  assert.equal(question.type, "single");
  assert.equal(question.correctGroupIds.length, 1);
});

test("multi-category word produces every correct group id", () => {
  const question = createQuestion(index, { wordKey: "habitual" });

  assert.equal(question.type, "multiple");
  assert.deepEqual(new Set(question.correctGroupIds), new Set([25, 34, 52]));
});

test("createQuestion returns six options by default", () => {
  const question = createQuestion(index, { wordKey: "critical" });
  const optionGroupIds = question.options.map((option) => option.groupId);

  assert.equal(optionGroupIds.length, 6);
  assert.equal(new Set(optionGroupIds).size, 6);
  assert.ok(question.correctGroupIds.every((groupId) => optionGroupIds.includes(groupId)));
});

test("optionCount controls the number of generated options", () => {
  assert.equal(createQuestion(index, { wordKey: "critical", optionCount: 6 }).options.length, 6);
  assert.equal(createQuestion(index, { wordKey: "critical", optionCount: 7 }).options.length, 7);
});

test("single-choice answer is judged by group id", () => {
  assert.equal(isAnswerCorrect([7], [7]), true);
  assert.equal(isAnswerCorrect([8], [7]), false);
});

test("complete multi-choice set is correct", () => {
  assert.equal(isAnswerCorrect([7, 33], [7, 33]), true);
});

test("missing one correct multi-choice group is incorrect", () => {
  assert.equal(isAnswerCorrect([7], [7, 33]), false);
});

test("selecting an extra incorrect group is incorrect", () => {
  assert.equal(isAnswerCorrect([7, 33, 20], [7, 33]), false);
});

test("correct multi-choice set is order independent", () => {
  assert.equal(isAnswerCorrect([33, 7], [7, 33]), true);
});

test("all 57 multi-category words produce legal questions", () => {
  const multiCategoryWordKeys = index.allWordKeys.filter(
    (wordKey) => index.groupIdsByWordKey.get(wordKey).size > 1
  );

  assert.equal(multiCategoryWordKeys.length, 57);
  for (const wordKey of multiCategoryWordKeys) {
    const question = createQuestion(index, { wordKey });
    const optionGroupIds = question.options.map((option) => option.groupId);
    assert.equal(question.type, "multiple", wordKey);
    assert.equal(optionGroupIds.length, 6, wordKey);
    assert.equal(new Set(optionGroupIds).size, 6, wordKey);
    assert.ok(question.correctGroupIds.every((groupId) => optionGroupIds.includes(groupId)), wordKey);
  }
});

test("one thousand generated questions always have six legal options", () => {
  for (let count = 0; count < 1000; count += 1) {
    const question = createQuestion(index);
    const optionGroupIds = question.options.map((option) => option.groupId);
    assert.equal(optionGroupIds.length, 6);
    assert.equal(new Set(optionGroupIds).size, 6);
    assert.ok(question.correctGroupIds.every((groupId) => optionGroupIds.includes(groupId)));
  }
});

test("random selection only returns eligible word keys and supports immediate-repeat exclusion", () => {
  const eligibleWordKeys = getEligibleWordKeys(index);
  const firstWordKey = selectRandomWordKey(index, { random: () => 0 });
  const nextWordKey = selectRandomWordKey(index, { random: () => 0, excludeWordKey: firstWordKey });

  assert.ok(eligibleWordKeys.includes(firstWordKey));
  assert.ok(eligibleWordKeys.includes(nextWordKey));
  assert.notEqual(nextWordKey, firstWordKey);
});
