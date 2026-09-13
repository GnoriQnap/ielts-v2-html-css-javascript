import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultVocabularyData } from "../js/data/default-vocabulary.js";
import { vocabularyData } from "../js/data/vocabulary.js";
import {
  isOfficialGroupId,
  isOfficialWordKey,
  OFFICIAL_VOCABULARY_ERROR_CODES,
  officialSystemGroupIds,
  officialSystemWordKeys
} from "../js/core/official-vocabulary-identity.js";
import {
  addCategory,
  deleteCategory,
  renameCategory
} from "../js/core/vocabulary-category-service.js";
import {
  addVocabularyWord,
  deleteCustomVocabularyWord,
  editVocabularyWord,
  removeVocabularyWordRelation
} from "../js/core/vocabulary-word-service.js";
import {
  createVocabularyRepository,
  VOCABULARY_STORAGE_KEY
} from "../js/core/vocabulary-repository.js";
import {
  commitVocabularyDetailsImport,
  prepareVocabularyDetailsImportData,
  VOCABULARY_DETAILS_IMPORT_ERROR_CODES
} from "../js/core/vocabulary-details-import-service.js";

const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const wordServiceSource = readFileSync(
  new URL("../js/core/vocabulary-word-service.js", import.meta.url),
  "utf8"
);
const categoryServiceSource = readFileSync(
  new URL("../js/core/vocabulary-category-service.js", import.meta.url),
  "utf8"
);

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

  removeItem(key) {
    this.values.delete(key);
  }
}

function details(definitionZh = "自定义释义") {
  return {
    phonetics: { uk: "", us: "/test/" },
    meanings: [{ partOfSpeech: "n.", definitionZh }],
    collocations: [],
    examples: [{ en: "A custom example.", zh: "一个自定义例句。" }],
    notes: "",
    source: "",
    updatedAt: ""
  };
}

function officialFixture() {
  const group = vocabularyData.vocabulary_list[0];
  const word = group.words[0];
  const wordKey = word.toLowerCase();
  const otherGroup = vocabularyData.vocabulary_list.find((candidate) => (
    !candidate.words.some((value) => value.toLowerCase() === wordKey)
  ));
  return { group, word, wordKey, otherGroup };
}

function createLoadedRepository(storage = new MemoryStorage()) {
  const repository = createVocabularyRepository({
    storage,
    fallbackVocabulary: defaultVocabularyData
  });
  repository.load();
  return repository;
}

function addCustomWordToRepository(repository, word = "custom-boundary-word") {
  const groupId = vocabularyData.vocabulary_list[0].group_id;
  const added = addVocabularyWord(repository.getCurrentVocabulary(), word, [groupId]);
  repository.saveUserVocabulary(added.vocabulary);
  return word.toLowerCase();
}

test("official ownership has one formal baseline source and no numeric range heuristic", () => {
  assert.equal(officialSystemWordKeys.length, 1119);
  assert.equal(officialSystemGroupIds.length, 98);
  assert.equal(isOfficialWordKey(vocabularyData.vocabulary_list[0].words[0]), true);
  assert.equal(isOfficialGroupId(vocabularyData.vocabulary_list[0].group_id), true);
  assert.doesNotMatch(wordServiceSource, /group_id\s*[<>]=?\s*98|groupId\s*[<>]=?\s*98/);
  assert.doesNotMatch(categoryServiceSource, /group_id\s*[<>]=?\s*98|groupId\s*[<>]=?\s*98/);
});

test("official category rename and delete are rejected by direct service calls", () => {
  const { group } = officialFixture();
  const snapshot = structuredClone(vocabularyData);
  assert.throws(
    () => renameCategory(vocabularyData, group.group_id, "系统分类改名"),
    (error) => error.code === OFFICIAL_VOCABULARY_ERROR_CODES.CATEGORY_READ_ONLY
  );
  assert.throws(
    () => deleteCategory(vocabularyData, group.group_id),
    (error) => error.code === OFFICIAL_VOCABULARY_ERROR_CODES.CATEGORY_READ_ONLY
  );
  assert.deepEqual(vocabularyData, snapshot);
});

test("custom categories retain create, rename, and safe delete behavior", () => {
  const created = addCategory(vocabularyData, "边界测试分类");
  const groupId = created.group.group_id;
  const renamed = renameCategory(created.vocabulary, groupId, "边界测试分类二");
  const deleted = deleteCategory(renamed.vocabulary, groupId);
  assert.equal(renamed.group.category, "边界测试分类二");
  assert.equal(deleted.vocabulary.vocabulary_list.some((group) => group.group_id === groupId), false);
});

test("official display, relations, custom-category membership, and whole deletion are immutable", () => {
  const { group, word, wordKey, otherGroup } = officialFixture();
  const customCategory = addCategory(vocabularyData, "系统词禁止加入");
  const currentGroupIds = vocabularyData.vocabulary_list
    .filter((item) => item.words.some((value) => value.toLowerCase() === wordKey))
    .map((item) => item.group_id);

  assert.throws(
    () => editVocabularyWord(vocabularyData, wordKey, word.toUpperCase(), currentGroupIds),
    (error) => error.code === OFFICIAL_VOCABULARY_ERROR_CODES.WORD_READ_ONLY
  );
  assert.throws(
    () => removeVocabularyWordRelation(vocabularyData, wordKey, group.group_id),
    (error) => error.code === OFFICIAL_VOCABULARY_ERROR_CODES.RELATION_READ_ONLY
  );
  assert.throws(
    () => editVocabularyWord(vocabularyData, wordKey, word, [...currentGroupIds, otherGroup.group_id]),
    (error) => error.code === OFFICIAL_VOCABULARY_ERROR_CODES.RELATION_READ_ONLY
  );
  assert.throws(
    () => editVocabularyWord(
      customCategory.vocabulary,
      wordKey,
      word,
      [...currentGroupIds, customCategory.group.group_id]
    ),
    (error) => error.code === OFFICIAL_VOCABULARY_ERROR_CODES.CUSTOM_CATEGORY_UNSUPPORTED
  );
  assert.throws(
    () => deleteCustomVocabularyWord(vocabularyData, wordKey),
    (error) => error.code === OFFICIAL_VOCABULARY_ERROR_CODES.WORD_READ_ONLY
  );
});

test("custom words retain display, system/custom membership, relation removal, and deletion", () => {
  const customCategory = addCategory(vocabularyData, "自定义边界分类");
  const customGroupId = customCategory.group.group_id;
  const systemGroupId = vocabularyData.vocabulary_list[0].group_id;
  const added = addVocabularyWord(
    customCategory.vocabulary,
    "custom-boundary-word",
    [systemGroupId, customGroupId]
  );
  const edited = editVocabularyWord(
    added.vocabulary,
    "custom-boundary-word",
    "Custom-Boundary-Word",
    [systemGroupId, customGroupId]
  );
  const removed = removeVocabularyWordRelation(
    edited.vocabulary,
    "custom-boundary-word",
    customGroupId
  );
  const deletion = deleteCustomVocabularyWord(removed.vocabulary, "custom-boundary-word");
  assert.equal(edited.word.displayText, "Custom-Boundary-Word");
  assert.deepEqual(removed.word.remainingGroupIds, [systemGroupId]);
  assert.equal(deletion.word.removedRelationCount, 1);
});

test("repository user details reject official words while custom details and hydration remain available", () => {
  const repository = createLoadedRepository();
  const { wordKey } = officialFixture();
  assert.equal(repository.getWordDetails(wordKey).meanings.length > 0, true);
  assert.throws(
    () => repository.setWordDetails(wordKey, details("非法覆盖")),
    (error) => error.code === OFFICIAL_VOCABULARY_ERROR_CODES.DETAILS_READ_ONLY
  );
  const customWordKey = addCustomWordToRepository(repository);
  repository.setWordDetails(customWordKey, details());
  assert.equal(repository.getWordDetails(customWordKey).meanings[0].definitionZh, "自定义释义");
});

test("details import rejects official items and deterministically commits valid custom items", () => {
  const repository = createLoadedRepository();
  const customWordKey = addCustomWordToRepository(repository);
  const { wordKey: officialWordKey } = officialFixture();
  const prepared = prepareVocabularyDetailsImportData({
    [officialWordKey]: details("非法系统写入"),
    [customWordKey]: details("合法自定义写入")
  }, repository);
  assert.deepEqual(prepared.summary, { totalCount: 2, successCount: 1, failureCount: 1 });
  assert.equal(
    prepared.failures[0].errors[0].code,
    VOCABULARY_DETAILS_IMPORT_ERROR_CODES.OFFICIAL_WORD_READ_ONLY
  );
  const result = commitVocabularyDetailsImport(repository, prepared);
  assert.deepEqual(result.importedWordKeys, [customWordKey]);
  assert.equal(repository.getWordDetails(customWordKey).meanings[0].definitionZh, "合法自定义写入");
});

test("repository user save is a final defense while maintenance save stays explicit", () => {
  const repository = createLoadedRepository();
  const { group, wordKey } = officialFixture();
  const mutated = repository.getCurrentVocabulary();
  mutated.vocabulary_list.find((item) => item.group_id === group.group_id).category = "非法名称";
  assert.throws(
    () => repository.saveUserVocabulary(mutated),
    (error) => error.code === OFFICIAL_VOCABULARY_ERROR_CODES.BASELINE_MUTATION
  );
  assert.equal(
    repository.getCurrentVocabulary().vocabulary_list.find((item) => item.group_id === group.group_id).category,
    group.category
  );
  const missingDetails = repository.getCurrentVocabulary();
  delete missingDetails.word_details[wordKey];
  assert.throws(
    () => repository.saveUserVocabulary(missingDetails),
    (error) => error.code === OFFICIAL_VOCABULARY_ERROR_CODES.BASELINE_MUTATION
  );
  assert.equal(typeof repository.saveMaintenanceVocabulary, "function");
});

test("legacy incompatible cache is detected and not silently rewritten", () => {
  const storage = new MemoryStorage();
  const legacy = structuredClone(defaultVocabularyData);
  legacy.vocabulary_list[0].category = "旧版不兼容名称";
  const rawCache = JSON.stringify({
    schemaVersion: 1,
    savedAt: "2026-09-13T00:00:00.000Z",
    defaultDetailsVersion: 1,
    vocabulary: legacy
  });
  storage.setItem(VOCABULARY_STORAGE_KEY, rawCache);
  const repository = createVocabularyRepository({ storage, fallbackVocabulary: defaultVocabularyData });
  repository.load();
  assert.equal(repository.getOfficialCompatibility().status, "legacy-incompatible");
  assert.equal(storage.getItem(VOCABULARY_STORAGE_KEY), rawCache);
});

test("Manager renders official entries read-only and retains custom mutation controls", () => {
  assert.match(appSource, /isOfficialGroupId\(item\.groupId\)[\s\S]*系统分类/);
  assert.match(
    appSource,
    /function createTreeCategoryActionsB3\(item\)[\s\S]*isOfficialGroupId\(item\.groupId\)[\s\S]*return actions/
  );
  assert.match(
    appSource,
    /function createTreeWordActionsB3\([\s\S]*查看单词释义[\s\S]*if \(!isOfficialWordKey\(wordKey\)\)[\s\S]*编辑[\s\S]*删除/
  );
  assert.match(appSource, /addWordToCategoryB3[\s\S]*editVocabularyWord/);
  assert.doesNotMatch(appSource, /const systemWordKeys = new Set/);
});
