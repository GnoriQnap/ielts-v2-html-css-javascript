import test from "node:test";
import assert from "node:assert/strict";
import { vocabularyData } from "../js/data/vocabulary.js";
import { validateVocabularyData } from "../js/core/vocabulary-validator.js";

test("provided vocabulary matches the accepted phase 0 baseline", () => {
  const report = validateVocabularyData(vocabularyData);

  assert.equal(report.isValid, true);
  assert.deepEqual(report.summary, {
    groupCount: 98,
    validGroupCount: 98,
    rawWordCount: 1178,
    uniqueWordCount: 1119,
    multiCategoryWordCount: 57,
    maxCategoriesPerWord: 3
  });
  assert.equal(report.errors.length, 0);
  assert.equal(report.warnings.length, 1);
  assert.deepEqual(report.details.duplicateWordsWithinGroups, [{
    groupId: 1,
    category: "表明观点",
    wordKey: "report",
    displayText: "report",
    firstWordIndex: 7,
    duplicateWordIndex: 44
  }]);
});

test("validator reports invalid root data safely", () => {
  const report = validateVocabularyData({});
  assert.equal(report.isValid, false);
  assert.equal(report.errors[0].code, "INVALID_VOCABULARY_LIST");
  assert.equal(report.summary.uniqueWordCount, 0);
});

test("validator blocks a word with more than six correct categories", () => {
  const data = {
    vocabulary_list: Array.from({ length: 7 }, (_, index) => ({
      group_id: index + 1,
      category: `分类${index + 1}`,
      words: ["shared"]
    }))
  };

  const report = validateVocabularyData(data);
  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((item) => item.code === "TOO_MANY_CORRECT_GROUPS"));
});

test("validator blocks vocabularies with fewer than six categories", () => {
  const report = validateVocabularyData({
    vocabulary_list: [{ group_id: 1, category: "分类一", words: ["word"] }]
  });

  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((item) => item.code === "INSUFFICIENT_GROUPS"));
});

test("validator accepts vocabularies without word details", () => {
  const data = structuredClone(vocabularyData);
  delete data.word_details;

  assert.equal(validateVocabularyData(data).isValid, true);
});

test("validator accepts complete and partial legal word details", () => {
  const data = structuredClone(vocabularyData);
  data.word_details = {
    idea: {
      phonetics: { uk: "/aɪˈdɪə/", us: "/aɪˈdiːə/" },
      meanings: [{ partOfSpeech: "noun", definitionZh: "想法" }],
      collocations: ["good idea"],
      examples: [{ en: "That is a good idea.", zh: "那是个好主意。" }],
      notes: "",
      source: "teacher",
      updatedAt: "2026-07-22T10:00:00.000Z"
    },
    concept: {
      meanings: [{ definitionZh: "概念" }],
      examples: [{ en: "A useful concept." }]
    }
  };

  assert.equal(validateVocabularyData(data).isValid, true);
});

test("validator rejects illegal word details field types and orphan identities", () => {
  const data = structuredClone(vocabularyData);
  data.word_details = {
    idea: {
      phonetics: "invalid",
      meanings: [{ partOfSpeech: 1 }],
      collocations: ["valid", 2],
      examples: ["invalid"],
      notes: [],
      source: 3,
      updatedAt: "not-an-iso-date"
    },
    "missing-word": {}
  };
  const report = validateVocabularyData(data);

  assert.equal(report.isValid, false);
  assert.ok(report.errors.some((item) => item.code === "INVALID_DETAILS_PHONETICS"));
  assert.ok(report.errors.some((item) => item.code === "INVALID_DETAILS_ARRAY_ITEM"));
  assert.ok(report.errors.some((item) => item.code === "INVALID_DETAILS_STRING"));
  assert.ok(report.errors.some((item) => item.code === "INVALID_DETAILS_UPDATED_AT"));
  assert.ok(report.errors.some((item) => item.code === "ORPHAN_WORD_DETAILS"));
});
