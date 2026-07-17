import test from "node:test";
import assert from "node:assert/strict";
import {
  addCategory,
  createCategoryList,
  deleteCategory,
  renameCategory
} from "../js/core/vocabulary-category-service.js";
import { createVocabularyIndex } from "../js/core/vocabulary-index.js";
import { createQuestion } from "../js/core/question-engine.js";
import {
  createWordbookCategoryTree,
  createWordbookEntries
} from "../js/core/wordbook-service.js";

const vocabulary = {
  vocabulary_list: [
    { group_id: 2, category: "表明观点", words: ["idea", "thought"] },
    { group_id: 5, category: "支持", words: ["support"] }
  ],
  word_details: { idea: { definition: "想法" } }
};

test("category list reports names and unique word counts", () => {
  assert.deepEqual(createCategoryList(vocabulary), [
    { groupId: 2, category: "表明观点", wordCount: 2 },
    { groupId: 5, category: "支持", wordCount: 1 }
  ]);
});

test("category counts use valid unique word keys", () => {
  const duplicated = {
    vocabulary_list: [{
      group_id: 1,
      category: "分类",
      words: ["Report", " report ", "", null]
    }]
  };

  assert.equal(createCategoryList(duplicated)[0].wordCount, 1);
});

test("adding a category trims its name and generates the next unique group id", () => {
  const result = addCategory(vocabulary, "  新分类  ");

  assert.deepEqual(result.group, { group_id: 6, category: "新分类", words: [] });
  assert.equal(result.vocabulary.vocabulary_list.length, 3);
  assert.equal(vocabulary.vocabulary_list.length, 2);
  assert.deepEqual(result.vocabulary.word_details, vocabulary.word_details);
});

test("a newly added category appears in the wordbook category tree", () => {
  const added = addCategory(vocabulary, "新分类");
  const index = createVocabularyIndex(added.vocabulary.vocabulary_list);
  const tree = createWordbookCategoryTree(index, { byWordKey: {} });

  assert.deepEqual(tree.find(({ groupId }) => groupId === 6), {
    groupId: 6,
    category: "新分类",
    words: []
  });
});

test("empty and duplicate category names are rejected", () => {
  assert.throws(() => addCategory(vocabulary, "  "), /不能为空/);
  assert.throws(() => addCategory(vocabulary, "表明观点"), /不能重复/);
});

test("renaming a category preserves group identity, words, and word keys", () => {
  const beforeIndex = createVocabularyIndex(vocabulary.vocabulary_list);
  const result = renameCategory(vocabulary, 2, "表达观点");
  const afterIndex = createVocabularyIndex(result.vocabulary.vocabulary_list);

  assert.equal(result.group.group_id, 2);
  assert.deepEqual(result.group.words, ["idea", "thought"]);
  assert.equal(afterIndex.groupById.get(2).category, "表达观点");
  assert.deepEqual(afterIndex.allWordKeys, beforeIndex.allWordKeys);
  assert.deepEqual(
    [...afterIndex.groupIdsByWordKey.get("idea")],
    [...beforeIndex.groupIdsByWordKey.get("idea")]
  );
});

test("renaming rejects missing groups, empty names, and another category name", () => {
  assert.throws(() => renameCategory(vocabulary, 99, "其他"), /没有找到/);
  assert.throws(() => renameCategory(vocabulary, 2, ""), /不能为空/);
  assert.throws(() => renameCategory(vocabulary, 2, "支持"), /不能重复/);
});

test("renamed categories flow through questions and wordbook without changing learning state", () => {
  const completeVocabulary = {
    vocabulary_list: [
      ...vocabulary.vocabulary_list,
      { group_id: 6, category: "研究", words: ["study"] },
      { group_id: 7, category: "改变", words: ["change"] },
      { group_id: 8, category: "反对", words: ["oppose"] },
      { group_id: 9, category: "保护", words: ["protect"] }
    ]
  };
  const learning = {
    byWordKey: {
      idea: { status: "review", correctCount: 2, errorCount: 1, answerCount: 3 }
    }
  };
  const learningSnapshot = structuredClone(learning);
  const renamed = renameCategory(completeVocabulary, 2, "表达观点");
  const index = createVocabularyIndex(renamed.vocabulary.vocabulary_list);
  const question = createQuestion(index, { wordKey: "idea", random: () => 0 });
  const idea = createWordbookEntries(index, learning)
    .find((entry) => entry.wordKey === "idea");

  assert.equal(
    question.options.find(({ groupId }) => groupId === 2).category,
    "表达观点"
  );
  assert.equal(idea.categories[0].category, "表达观点");
  assert.deepEqual(learning, learningSnapshot);
});

test("deleting an empty category succeeds", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "空分类", words: [] },
      { group_id: 2, category: "保留", words: ["keep"] }
    ]
  };

  const result = deleteCategory(source, 1);

  assert.equal(result.removedRelationCount, 0);
  assert.deepEqual(result.vocabulary.vocabulary_list, [source.vocabulary_list[1]]);
  assert.equal(source.vocabulary_list.length, 2);
});

test("deleting a category made only of multi-category words succeeds", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "待删除", words: ["hello", "shared"] },
      { group_id: 2, category: "问候", words: ["hello"] },
      { group_id: 3, category: "共享", words: ["shared"] }
    ]
  };

  const result = deleteCategory(source, 1);

  assert.equal(result.removedRelationCount, 2);
  assert.equal(result.vocabulary.vocabulary_list.some(({ group_id }) => group_id === 1), false);
});

test("deleting a category containing a single-category word is rejected", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "独有", words: ["only-here", "shared"] },
      { group_id: 2, category: "其他", words: ["shared"] }
    ]
  };

  assert.throws(
    () => deleteCategory(source, 1),
    /该分类包含只能属于此分类的词条。请先删除这些词条或将它们加入其他分类。/
  );
});

test("multi-category words remain after one category is deleted", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "待删除", words: ["hello"] },
      { group_id: 2, category: "保留", words: ["hello", "stay"] }
    ]
  };

  const result = deleteCategory(source, 1);
  const index = createVocabularyIndex(result.vocabulary.vocabulary_list);

  assert.equal(index.displayByWordKey.get("hello"), "hello");
  assert.deepEqual([...index.groupIdsByWordKey.get("hello")], [2]);
});

test("deleting a category does not change learning state", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "待删除", words: ["hello"] },
      { group_id: 2, category: "保留", words: ["hello"] }
    ]
  };
  const learning = {
    byWordKey: {
      hello: { status: "review", correctCount: 2, errorCount: 3, answerCount: 5 }
    }
  };
  const snapshot = structuredClone(learning);

  deleteCategory(source, 1);

  assert.deepEqual(learning, snapshot);
});

test("a category used by the active question is protected before other checks", () => {
  const source = {
    vocabulary_list: [
      { group_id: 1, category: "当前题分类", words: ["only-here"] },
      { group_id: 2, category: "其他", words: ["other"] }
    ]
  };

  assert.throws(
    () => deleteCategory(source, 1, { protectedGroupIds: [1] }),
    /当前题正在使用该分类，暂时无法删除。/
  );
});
