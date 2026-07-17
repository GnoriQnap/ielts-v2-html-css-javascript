import test from "node:test";
import assert from "node:assert/strict";
import {
  addVocabularyWord,
  createWordManagementEntries,
  editVocabularyWord,
  filterWordManagementEntries
} from "../js/core/vocabulary-word-service.js";
import { createVocabularyIndex } from "../js/core/vocabulary-index.js";
import { createQuestion } from "../js/core/question-engine.js";
import { createDefaultAppState } from "../js/core/storage.js";
import { createVocabularyRepository } from "../js/core/vocabulary-repository.js";
import { createWordbookEntries } from "../js/core/wordbook-service.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

const vocabulary = {
  vocabulary_list: [
    { group_id: 1, category: "保持", words: ["sustain"] },
    { group_id: 2, category: "支持", words: ["support"] },
    { group_id: 3, category: "研究", words: ["study"] },
    { group_id: 4, category: "改变", words: ["change"] },
    { group_id: 5, category: "反对", words: ["oppose"] },
    { group_id: 6, category: "保护", words: ["protect"] }
  ]
};

test("adding a word preserves display text and creates one unique wordKey", () => {
  const result = addVocabularyWord(vocabulary, "  Maintain  ", [1]);

  assert.deepEqual(result.word, {
    wordKey: "maintain",
    displayText: "Maintain",
    groupIds: [1]
  });
  assert.deepEqual(result.vocabulary.vocabulary_list[0].words, ["sustain", "Maintain"]);
  assert.deepEqual(vocabulary.vocabulary_list[0].words, ["sustain"]);
});

test("empty, duplicate, missing, and unknown category input is rejected", () => {
  assert.throws(() => addVocabularyWord(vocabulary, " ", [1]), /不能为空/);
  assert.throws(() => addVocabularyWord(vocabulary, " SUSTAIN ", [1]), /已存在/);
  assert.throws(() => addVocabularyWord(vocabulary, "maintain", []), /至少选择/);
  assert.throws(() => addVocabularyWord(vocabulary, "maintain", [99]), /分类不存在/);
});

test("one new word can belong to multiple categories", () => {
  const result = addVocabularyWord(vocabulary, "maintain", [2, 1, 2]);
  const index = createVocabularyIndex(result.vocabulary.vocabulary_list);

  assert.deepEqual(result.word.groupIds, [1, 2]);
  assert.deepEqual([...index.groupIdsByWordKey.get("maintain")], [1, 2]);
  assert.equal(index.groupById.get(1).words.includes("maintain"), true);
  assert.equal(index.groupById.get(2).words.includes("maintain"), true);
});

test("new words appear in management search and default to new without changing user state", () => {
  const state = createDefaultAppState();
  state.learning.byWordKey.sustain = {
    status: "remembered",
    correctCount: 3,
    errorCount: 1,
    answerCount: 4
  };
  const stateSnapshot = structuredClone(state);
  const result = addVocabularyWord(vocabulary, "maintain", [1, 2]);
  const index = createVocabularyIndex(result.vocabulary.vocabulary_list);
  const entries = createWordManagementEntries(index, state.learning);
  const matches = filterWordManagementEntries(entries, "MAIN");

  assert.equal(matches.length, 1);
  assert.equal(matches[0].wordKey, "maintain");
  assert.equal(matches[0].status, "new");
  assert.deepEqual(matches[0].categories.map(({ groupId }) => groupId), [1, 2]);
  assert.deepEqual(state, stateSnapshot);
  assert.deepEqual(state.practice.reviewQueue, []);
});

test("a repository-saved multi-category word survives reload and can generate a question", () => {
  const storage = new MemoryStorage();
  const repository = createVocabularyRepository({ storage, fallbackVocabulary: vocabulary });
  repository.load();
  const result = addVocabularyWord(repository.getCurrentVocabulary(), "maintain", [1, 2]);
  repository.save(result.vocabulary);

  const reloaded = createVocabularyRepository({ storage, fallbackVocabulary: vocabulary }).load();
  const index = createVocabularyIndex(reloaded.vocabulary_list);
  const question = createQuestion(index, { wordKey: "maintain", random: () => 0 });

  assert.equal(index.displayByWordKey.get("maintain"), "maintain");
  assert.deepEqual(new Set(question.correctGroupIds), new Set([1, 2]));
  assert.equal(question.options.length, 6);
});

test("editing category memberships updates the wordbook index without changing word identity", () => {
  const result = editVocabularyWord(vocabulary, "sustain", "sustain", [2, 3]);
  const index = createVocabularyIndex(result.vocabulary.vocabulary_list);
  const entries = createWordManagementEntries(index, { byWordKey: {} });
  const wordbookEntries = createWordbookEntries(index, { byWordKey: {} });
  const sustain = entries.find((entry) => entry.wordKey === "sustain");
  const wordbookSustain = wordbookEntries.find((entry) => entry.wordKey === "sustain");
  const question = createQuestion(index, { wordKey: "sustain", random: () => 0 });

  assert.deepEqual(result.word.groupIds, [2, 3]);
  assert.deepEqual([...index.groupIdsByWordKey.get("sustain")], [2, 3]);
  assert.deepEqual(sustain.categories.map(({ category }) => category), ["支持", "研究"]);
  assert.deepEqual(wordbookSustain.categories.map(({ category }) => category), ["支持", "研究"]);
  assert.deepEqual(new Set(question.correctGroupIds), new Set([2, 3]));
  assert.equal(index.groupById.get(1).words.includes("sustain"), false);
});

test("editing display text preserves wordKey and remains searchable", () => {
  const result = editVocabularyWord(vocabulary, "sustain", "Sustain", [1]);
  const index = createVocabularyIndex(result.vocabulary.vocabulary_list);
  const entries = createWordManagementEntries(index, { byWordKey: {} });

  assert.equal(result.word.wordKey, "sustain");
  assert.equal(index.displayByWordKey.get("sustain"), "Sustain");
  assert.deepEqual(filterWordManagementEntries(entries, "SUSTAIN").map((entry) => entry.wordKey), ["sustain"]);
});

test("editing rejects identity changes, empty categories, and missing words", () => {
  assert.throws(
    () => editVocabularyWord(vocabulary, "sustain", "maintain", [1]),
    /当前版本不支持修改词条唯一标识/
  );
  assert.throws(() => editVocabularyWord(vocabulary, "sustain", "sustain", []), /至少选择/);
  assert.throws(() => editVocabularyWord(vocabulary, "sustain", "sustain", [99]), /分类不存在/);
  assert.throws(() => editVocabularyWord(vocabulary, "missing", "missing", [1]), /不存在/);
});

test("editing a word leaves learning, review queue, and the active question unchanged", () => {
  const state = createDefaultAppState();
  state.learning.byWordKey.sustain = {
    status: "review",
    correctCount: 2,
    errorCount: 3,
    answerCount: 5
  };
  state.practice.reviewQueue = [{
    wordKey: "sustain",
    scope: "free",
    roundId: null,
    scheduledAtAttempt: 1,
    dueAfterAttempt: 7,
    delay: 6
  }];
  state.practice.activeQuestion = {
    wordKey: "sustain",
    optionGroupIds: [1, 2, 3, 4, 5, 6],
    correctGroupIds: [1],
    selectedGroupIds: [1],
    phase: "answering",
    result: null
  };
  const stateSnapshot = structuredClone(state);

  editVocabularyWord(vocabulary, "sustain", "Sustain", [1, 2]);

  assert.deepEqual(state, stateSnapshot);
});

test("an edited word survives repository reload", () => {
  const storage = new MemoryStorage();
  const repository = createVocabularyRepository({ storage, fallbackVocabulary: vocabulary });
  repository.load();
  const result = editVocabularyWord(repository.getCurrentVocabulary(), "sustain", "Sustain", [1, 2]);
  repository.save(result.vocabulary);

  const reloaded = createVocabularyRepository({ storage, fallbackVocabulary: vocabulary }).load();
  const index = createVocabularyIndex(reloaded.vocabulary_list);

  assert.equal(index.displayByWordKey.get("sustain"), "Sustain");
  assert.deepEqual([...index.groupIdsByWordKey.get("sustain")], [1, 2]);
});
