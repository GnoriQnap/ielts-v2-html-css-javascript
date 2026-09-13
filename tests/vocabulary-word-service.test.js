import test from "node:test";
import assert from "node:assert/strict";
import {
  addVocabularyWord,
  createWordManagementEntries,
  deleteCustomVocabularyWord,
  detectWordIdentityChange,
  editVocabularyWord,
  filterWordManagementEntries,
  removeVocabularyWordRelation
} from "../js/core/vocabulary-word-service.js";
import { createCategoryList } from "../js/core/vocabulary-category-service.js";
import { createVocabularyIndex } from "../js/core/vocabulary-index.js";
import { createQuestion } from "../js/core/question-engine.js";
import { removeLearningRecord } from "../js/core/learning-service.js";
import { removeReviewItem } from "../js/core/review-scheduler.js";
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
    { group_id: 1, category: "保持", words: ["learnerword"] },
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
  assert.deepEqual(result.vocabulary.vocabulary_list[0].words, ["learnerword", "Maintain"]);
  assert.deepEqual(vocabulary.vocabulary_list[0].words, ["learnerword"]);
});

test("empty, duplicate, missing, and unknown category input is rejected", () => {
  assert.throws(() => addVocabularyWord(vocabulary, " ", [1]), /不能为空/);
  assert.throws(() => addVocabularyWord(vocabulary, " LEARNERWORD ", [1]), /已存在/);
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
  state.learning.byWordKey.learnerword = {
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
  const result = editVocabularyWord(vocabulary, "learnerword", "learnerword", [2, 3]);
  const index = createVocabularyIndex(result.vocabulary.vocabulary_list);
  const entries = createWordManagementEntries(index, { byWordKey: {} });
  const wordbookEntries = createWordbookEntries(index, { byWordKey: {} });
  const learnerword = entries.find((entry) => entry.wordKey === "learnerword");
  const wordbookLearnerword = wordbookEntries.find((entry) => entry.wordKey === "learnerword");
  const question = createQuestion(index, { wordKey: "learnerword", random: () => 0 });

  assert.deepEqual(result.word.groupIds, [2, 3]);
  assert.deepEqual([...index.groupIdsByWordKey.get("learnerword")], [2, 3]);
  assert.deepEqual(learnerword.categories.map(({ category }) => category), ["支持", "研究"]);
  assert.deepEqual(wordbookLearnerword.categories.map(({ category }) => category), ["支持", "研究"]);
  assert.deepEqual(new Set(question.correctGroupIds), new Set([2, 3]));
  assert.equal(index.groupById.get(1).words.includes("learnerword"), false);
});

test("editing display text preserves wordKey and remains searchable", () => {
  const result = editVocabularyWord(vocabulary, "learnerword", "Learnerword", [1]);
  const index = createVocabularyIndex(result.vocabulary.vocabulary_list);
  const entries = createWordManagementEntries(index, { byWordKey: {} });

  assert.equal(result.word.wordKey, "learnerword");
  assert.equal(index.displayByWordKey.get("learnerword"), "Learnerword");
  assert.deepEqual(filterWordManagementEntries(entries, "LEARNERWORD").map((entry) => entry.wordKey), ["learnerword"]);
});

test("editing rejects identity changes, empty categories, and missing words", () => {
  assert.throws(
    () => editVocabularyWord(vocabulary, "learnerword", "maintain", [1]),
    /当前版本不支持修改词条唯一标识/
  );
  assert.throws(() => editVocabularyWord(vocabulary, "learnerword", "learnerword", []), /至少选择/);
  assert.throws(() => editVocabularyWord(vocabulary, "learnerword", "learnerword", [99]), /分类不存在/);
  assert.throws(() => editVocabularyWord(vocabulary, "missing", "missing", [1]), /不存在/);
});

test("editing a word leaves learning, review queue, and the active question unchanged", () => {
  const state = createDefaultAppState();
  state.learning.byWordKey.learnerword = {
    status: "review",
    correctCount: 2,
    errorCount: 3,
    answerCount: 5
  };
  state.practice.reviewQueue = [{
    wordKey: "learnerword",
    scope: "free",
    roundId: null,
    scheduledAtAttempt: 1,
    dueAfterAttempt: 7,
    delay: 6
  }];
  state.practice.activeQuestion = {
    wordKey: "learnerword",
    optionGroupIds: [1, 2, 3, 4, 5, 6],
    correctGroupIds: [1],
    selectedGroupIds: [1],
    phase: "answering",
    result: null
  };
  const stateSnapshot = structuredClone(state);

  editVocabularyWord(vocabulary, "learnerword", "Learnerword", [1, 2]);

  assert.deepEqual(state, stateSnapshot);
});

test("an edited word survives repository reload", () => {
  const storage = new MemoryStorage();
  const repository = createVocabularyRepository({ storage, fallbackVocabulary: vocabulary });
  repository.load();
  const added = addVocabularyWord(repository.getCurrentVocabulary(), "sampleterm", [1]);
  repository.save(added.vocabulary);
  const result = editVocabularyWord(repository.getCurrentVocabulary(), "sampleterm", "Sampleterm", [1, 2]);
  repository.save(result.vocabulary);

  const reloaded = createVocabularyRepository({ storage, fallbackVocabulary: vocabulary }).load();
  const index = createVocabularyIndex(reloaded.vocabulary_list);

  assert.equal(index.displayByWordKey.get("sampleterm"), "Sampleterm");
  assert.deepEqual([...index.groupIdsByWordKey.get("sampleterm")], [1, 2]);
});

test("removing one relation from a multi-category word succeeds", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "保持", words: ["learnerword"] },
      { group_id: 2, category: "支持", words: ["learnerword", "support"] }
    ]
  };

  const result = removeVocabularyWordRelation(source, "learnerword", 1);

  assert.deepEqual(result.word, {
    wordKey: "learnerword",
    displayText: "learnerword",
    removedGroupId: 1,
    remainingGroupIds: [2]
  });
  assert.deepEqual(result.vocabulary.vocabulary_list[0].words, []);
  assert.deepEqual(source.vocabulary_list[0].words, ["learnerword"]);
});

test("removing the last category relation is rejected", () => {
  assert.throws(
    () => removeVocabularyWordRelation(vocabulary, "learnerword", 1),
    /该词条目前只有一个分类。如删除将导致词条从词库消失。当前版本请先将词条加入其他分类后再删除。/
  );
});

test("a word remains visible in its other category after relation removal", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "保持", words: ["learnerword"] },
      { group_id: 2, category: "支持", words: ["learnerword"] }
    ]
  };
  const result = removeVocabularyWordRelation(source, "learnerword", 1);
  const index = createVocabularyIndex(result.vocabulary.vocabulary_list);

  assert.equal(index.displayByWordKey.get("learnerword"), "learnerword");
  assert.deepEqual([...index.groupIdsByWordKey.get("learnerword")], [2]);
  assert.equal(index.groupById.get(2).words.includes("learnerword"), true);
});

test("relation removal leaves learning, review queue, and round history unchanged", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "保持", words: ["learnerword"] },
      { group_id: 2, category: "支持", words: ["learnerword"] }
    ]
  };
  const state = createDefaultAppState();
  state.learning.byWordKey.learnerword = {
    status: "review",
    correctCount: 2,
    errorCount: 3,
    answerCount: 5
  };
  state.practice.reviewQueue = [{
    wordKey: "learnerword",
    scope: "free",
    roundId: null,
    scheduledAtAttempt: 1,
    dueAfterAttempt: 7,
    delay: 6
  }];
  state.rounds.lastCompletedSummary = { roundId: "round-old", totalWords: 20 };
  const snapshot = structuredClone(state);

  removeVocabularyWordRelation(source, "learnerword", 1);

  assert.deepEqual(state, snapshot);
});

test("the active question word is protected before the last-relation check", () => {
  assert.throws(
    () => removeVocabularyWordRelation(vocabulary, "learnerword", 1, {
      protectedWordKeys: ["learnerword"]
    }),
    /当前题正在使用该词条，暂时无法修改。/
  );
});

test("relation removal updates the category word count", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "保持", words: ["learnerword", "keep"] },
      { group_id: 2, category: "支持", words: ["learnerword"] }
    ]
  };
  const before = createCategoryList(source).find(({ groupId }) => groupId === 1);
  const result = removeVocabularyWordRelation(source, "learnerword", 1);
  const after = createCategoryList(result.vocabulary).find(({ groupId }) => groupId === 1);

  assert.equal(before.wordCount, 2);
  assert.equal(after.wordCount, 1);
});

test("display text can change while its normalized wordKey stays the same", () => {
  const detection = detectWordIdentityChange("thought", "  Thought  ");
  const result = editVocabularyWord(vocabulary, "learnerword", "Learnerword", [1]);

  assert.deepEqual(detection, {
    changed: false,
    oldWordKey: "thought",
    newWordKey: "thought"
  });
  assert.equal(result.word.displayText, "Learnerword");
  assert.equal(result.word.wordKey, "learnerword");
});

test("display text that creates a different wordKey is detected", () => {
  assert.deepEqual(detectWordIdentityChange("idea", "ideal"), {
    changed: true,
    oldWordKey: "idea",
    newWordKey: "ideal"
  });
});

test("an identity-changing edit is blocked without changing the vocabulary", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "观点", words: ["idea"] }
    ]
  };
  const snapshot = structuredClone(source);

  assert.throws(
    () => editVocabularyWord(source, "idea", "ideal", [1]),
    /当前版本不支持修改词条唯一标识。/
  );
  assert.deepEqual(source, snapshot);
});

test("a blocked identity-changing edit leaves learning state unchanged", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "观点", words: ["idea"] }
    ]
  };
  const learning = {
    byWordKey: {
      idea: { status: "review", correctCount: 2, errorCount: 1, answerCount: 3 }
    }
  };
  const snapshot = structuredClone(learning);

  assert.throws(() => editVocabularyWord(source, "idea", "ideal", [1]));
  assert.deepEqual(learning, snapshot);
});

test("deleting a custom word removes every category relation and its details", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "保持", words: ["custom-word", "keep"] },
      { group_id: 2, category: "支持", words: ["custom-word"] }
    ],
    word_details: {
      "custom-word": { definition: "temporary" },
      keep: { definition: "keep" }
    }
  };
  const result = deleteCustomVocabularyWord(source, "CUSTOM-WORD", {
    systemWordKeys: new Set(["keep"])
  });
  const index = createVocabularyIndex(result.vocabulary.vocabulary_list);

  assert.equal(result.word.removedRelationCount, 2);
  assert.deepEqual(result.word.removedGroupIds, [1, 2]);
  assert.equal(index.displayByWordKey.has("custom-word"), false);
  assert.equal("custom-word" in result.vocabulary.word_details, false);
  assert.equal("keep" in result.vocabulary.word_details, true);
  assert.equal(source.vocabulary_list[0].words.includes("custom-word"), true);
});

test("system vocabulary words cannot be deleted", () => {
  const source = {
    vocabulary_list: [{ group_id: 1, category: "系统分类", words: ["idea"] }]
  };
  assert.throws(
    () => deleteCustomVocabularyWord(source, "idea"),
    /系统词库词条不能删除。/
  );
});

test("current question and active round references protect a custom word", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "自定义", words: ["custom-word"] }
    ]
  };

  assert.throws(
    () => deleteCustomVocabularyWord(source, "custom-word", {
      activeQuestionWordKey: "custom-word"
    }),
    /当前题正在使用该词条，暂时无法删除。/
  );
  assert.throws(
    () => deleteCustomVocabularyWord(source, "custom-word", {
      activeRoundWordKeys: ["custom-word"]
    }),
    /该词条正在当前轮次中使用，暂时无法删除。/
  );
});

test("custom word deletion cleanup removes learning and review data but preserves history", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "自定义", words: ["custom-word"] }
    ]
  };
  const state = createDefaultAppState();
  state.learning.byWordKey["custom-word"] = {
    status: "review",
    errorCount: 2,
    answerCount: 2
  };
  state.practice.reviewQueue = [{
    wordKey: "custom-word",
    scope: "free",
    roundId: null,
    scheduledAtAttempt: 1,
    dueAfterAttempt: 7,
    delay: 6
  }];
  state.rounds.lastCompletedSummary = { roundId: "history", totalWords: 20 };
  const historySnapshot = structuredClone(state.rounds.lastCompletedSummary);

  deleteCustomVocabularyWord(source, "custom-word");
  const learning = removeLearningRecord(state.learning, "custom-word");
  const reviewQueue = removeReviewItem(state.practice.reviewQueue, "custom-word");

  assert.equal("custom-word" in learning.byWordKey, false);
  assert.deepEqual(reviewQueue, []);
  assert.deepEqual(state.rounds.lastCompletedSummary, historySnapshot);
});

test("a repository-saved custom word deletion survives reload and index rebuild", () => {
  const storage = new MemoryStorage();
  const repository = createVocabularyRepository({ storage, fallbackVocabulary: vocabulary });
  repository.load();
  const added = addVocabularyWord(repository.getCurrentVocabulary(), "custom-word", [1, 2]);
  repository.save(added.vocabulary);
  const deletion = deleteCustomVocabularyWord(
    repository.getCurrentVocabulary(),
    "custom-word",
    { systemWordKeys: new Set(vocabulary.vocabulary_list.flatMap((group) => group.words)) }
  );
  repository.save(deletion.vocabulary);

  const reloaded = createVocabularyRepository({ storage, fallbackVocabulary: vocabulary }).load();
  const index = createVocabularyIndex(reloaded.vocabulary_list);

  assert.equal(index.displayByWordKey.has("custom-word"), false);
  assert.equal(index.allWordKeys.includes("custom-word"), false);
});
