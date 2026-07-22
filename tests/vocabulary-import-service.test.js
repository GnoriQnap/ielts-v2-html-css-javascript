import test from "node:test";
import assert from "node:assert/strict";
import {
  assertVocabularyImportAllowed,
  commitVocabularyImport,
  MAX_VOCABULARY_IMPORT_BYTES,
  prepareVocabularyImportFile,
  prepareVocabularyImportText,
  resetVocabularyImportInput,
  VOCABULARY_IMPORT_ERROR_CODES
} from "../js/core/vocabulary-import-service.js";
import { buildVocabularyExport } from "../js/core/vocabulary-export-service.js";
import { createVocabularyRepository } from "../js/core/vocabulary-repository.js";
import { createDefaultAppState, normalizeAppState } from "../js/core/storage.js";
import { vocabularyData } from "../js/data/vocabulary.js";

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

function vocabularyWith(wordKey = "old-word", categoryPrefix = "旧分类") {
  return {
    vocabulary_list: Array.from({ length: 6 }, (_, index) => ({
      group_id: index + 1,
      category: `${categoryPrefix}${index + 1}`,
      words: index === 0 ? [wordKey] : [`option-${index + 1}`]
    }))
  };
}

function createLoadedRepository(source = vocabularyWith()) {
  const repository = createVocabularyRepository({
    storage: new MemoryStorage(),
    fallbackVocabulary: source
  });
  repository.load();
  return repository;
}

function stateContext(validation) {
  return {
    defaultState: createDefaultAppState(),
    validWordKeys: new Set(validation.index.allWordKeys),
    validGroupIds: new Set(validation.index.groupById.keys()),
    correctGroupIdsByWordKey: validation.index.groupIdsByWordKey
  };
}

test("a valid exported vocabulary can be prepared and imported again", () => {
  const sourceRepository = createLoadedRepository(vocabularyWith("exported-word", "导出分类"));
  const exported = buildVocabularyExport(sourceRepository);
  const prepared = prepareVocabularyImportText(JSON.stringify(exported));
  const targetRepository = createLoadedRepository();

  const result = commitVocabularyImport(targetRepository, prepared);

  assert.deepEqual(result.vocabulary, exported);
  assert.deepEqual(targetRepository.getCurrentVocabulary(), exported);
});

test("the official baseline vocabulary imports with 98 categories and 1119 unique words", () => {
  const prepared = prepareVocabularyImportText(JSON.stringify(vocabularyData));

  assert.deepEqual(prepared.summary, {
    categoryCount: 98,
    uniqueWordCount: 1119
  });
});

test("legacy JSON without word details imports normally", () => {
  const imported = vocabularyWith("legacy-word", "旧文件分类");
  const repository = createLoadedRepository();
  const result = commitVocabularyImport(
    repository,
    prepareVocabularyImportText(JSON.stringify(imported))
  );

  assert.deepEqual(result.vocabulary, imported);
  assert.equal("word_details" in result.vocabulary, false);
});

test("legacy word annotations remain importable without rewriting their stored shape", () => {
  const imported = vocabularyWith("legacy-detailed-word", "旧注释分类");
  imported.word_details = {
    "legacy-detailed-word": {
      phonetic: "/legacy/",
      definition: "旧释义",
      collocations: ["legacy phrase"],
      examples: ["A legacy example."]
    }
  };
  const repository = createLoadedRepository();
  const result = commitVocabularyImport(
    repository,
    prepareVocabularyImportText(JSON.stringify(imported))
  );

  assert.deepEqual(result.vocabulary.word_details, imported.word_details);
  assert.deepEqual(repository.getWordDetails("legacy-detailed-word"), {
    phonetics: { uk: "/legacy/", us: "" },
    meanings: [{ partOfSpeech: "", definitionZh: "旧释义" }],
    collocations: ["legacy phrase"],
    examples: [{ en: "A legacy example.", zh: "" }],
    notes: "",
    source: "",
    updatedAt: ""
  });
});

test("JSON with vocabulary details preserves every details field", () => {
  const imported = vocabularyWith("detailed-word", "详情分类");
  imported.word_details = {
    "detailed-word": {
      phonetics: { uk: "/ˈdiːteɪld/", us: "/dɪˈteɪld/" },
      meanings: [{ partOfSpeech: "adjective", definitionZh: "详细的" }],
      collocations: ["detailed report"],
      examples: [{ en: "Write a detailed report.", zh: "写一份详细报告。" }],
      notes: "test note",
      source: "teacher",
      updatedAt: "2026-07-22T10:00:00.000Z"
    }
  };
  const repository = createLoadedRepository();
  const result = commitVocabularyImport(
    repository,
    prepareVocabularyImportText(JSON.stringify(imported))
  );

  assert.deepEqual(result.vocabulary.word_details, imported.word_details);
  assert.deepEqual(repository.getWordDetails("detailed-word"), imported.word_details["detailed-word"]);
});

test("a successful import fully replaces repository data and exposes the rebuilt index", () => {
  const repository = createLoadedRepository();
  const imported = vocabularyWith("new-word", "新分类");
  const result = commitVocabularyImport(
    repository,
    prepareVocabularyImportText(JSON.stringify(imported))
  );

  assert.deepEqual(repository.getCurrentVocabulary(), imported);
  assert.equal(result.validation.index.allWordKeys.includes("new-word"), true);
  assert.equal(result.validation.index.allWordKeys.includes("old-word"), false);
  assert.equal(result.validation.index.groupById.get(1).category, "新分类1");
});

test("JSON syntax errors do not modify repository data", () => {
  const repository = createLoadedRepository();
  const before = repository.getCurrentVocabulary();

  assert.throws(
    () => prepareVocabularyImportText("{broken"),
    (error) => error.code === VOCABULARY_IMPORT_ERROR_CODES.JSON_ERROR
  );
  assert.deepEqual(repository.getCurrentVocabulary(), before);
});

test("validator failures do not modify repository data", () => {
  const repository = createLoadedRepository();
  const before = repository.getCurrentVocabulary();

  assert.throws(
    () => prepareVocabularyImportText(JSON.stringify({
      vocabulary_list: [{ group_id: 1, category: "不足", words: ["only"] }]
    })),
    (error) => error.code === VOCABULARY_IMPORT_ERROR_CODES.INVALID_DATA
  );
  assert.deepEqual(repository.getCurrentVocabulary(), before);
});

test("a repository save failure leaves the original vocabulary intact", () => {
  const before = vocabularyWith();
  const repository = {
    getCurrentVocabulary() {
      return structuredClone(before);
    },
    save() {
      throw new Error("quota exceeded");
    }
  };
  const prepared = prepareVocabularyImportText(JSON.stringify(vocabularyWith("new-word")));

  assert.throws(
    () => commitVocabularyImport(repository, prepared),
    (error) => error.code === VOCABULARY_IMPORT_ERROR_CODES.SAVE_ERROR
  );
  assert.deepEqual(repository.getCurrentVocabulary(), before);
});

test("a related state save failure rolls repository data back", () => {
  const repository = createLoadedRepository();
  const before = repository.getCurrentVocabulary();
  const prepared = prepareVocabularyImportText(JSON.stringify(vocabularyWith("new-word")));

  assert.throws(
    () => commitVocabularyImport(repository, prepared, {
      relatedState: {},
      saveRelatedState() {
        throw new Error("state write failed");
      }
    }),
    (error) => error.code === VOCABULARY_IMPORT_ERROR_CODES.SAVE_ERROR
  );
  assert.deepEqual(repository.getCurrentVocabulary(), before);
});

test("an active question referencing a missing imported word blocks import", () => {
  const prepared = prepareVocabularyImportText(JSON.stringify(vocabularyWith("new-word")));

  assert.throws(
    () => assertVocabularyImportAllowed(prepared, {
      activeQuestion: { wordKey: "old-word" }
    }),
    (error) => error.code === VOCABULARY_IMPORT_ERROR_CODES.ACTIVE_STATE
  );
});

test("an active round referencing a missing imported word blocks import", () => {
  const prepared = prepareVocabularyImportText(JSON.stringify(vocabularyWith("new-word")));

  assert.throws(
    () => assertVocabularyImportAllowed(prepared, {
      activeRound: { wordKeys: ["new-word", "old-word"] }
    }),
    (error) => error.code === VOCABULARY_IMPORT_ERROR_CODES.ACTIVE_STATE
  );
});

test("state normalization preserves completed history and removes missing learning and review entries", () => {
  const repository = createLoadedRepository();
  const prepared = prepareVocabularyImportText(JSON.stringify(vocabularyWith("new-word")));
  const state = createDefaultAppState();
  state.learning.byWordKey["old-word"] = {
    status: "review",
    correctCount: 1,
    errorCount: 2,
    answerCount: 3,
    lastAnsweredAt: "2026-07-22T08:00:00.000Z",
    reviewSince: "2026-07-22T08:00:00.000Z",
    enteredRoundIds: [],
    roundsEntered: 0
  };
  state.practice.reviewQueue = [{
    wordKey: "old-word",
    scope: "free",
    roundId: null,
    scheduledAtAttempt: 1,
    dueAfterAttempt: 7,
    delay: 6
  }];
  state.rounds.lastCompletedSummary = {
    roundId: "round-history",
    completedAt: "2026-07-22T09:00:00.000Z",
    totalWords: 20,
    masteredCount: 20,
    firstAttemptCorrectCount: 18
  };

  state.practice.roundPreparation = true;
  state.practice.roundPreparationSize = 20;
  const normalized = normalizeAppState(state, stateContext(prepared.validation));
  const result = commitVocabularyImport(repository, prepared, {
    relatedState: normalized,
    saveRelatedState(candidate) { return structuredClone(candidate); }
  });

  assert.equal(result.relatedState.learning.byWordKey["old-word"], undefined);
  assert.deepEqual(result.relatedState.practice.reviewQueue, []);
  assert.equal(result.relatedState.practice.roundPreparation, false);
  assert.equal(result.relatedState.rounds.lastCompletedSummary.roundId, "round-history");
});

test("the file input can be reset and the same file can be prepared repeatedly", async () => {
  const text = JSON.stringify(vocabularyWith("same-file-word"));
  const file = {
    name: "vocabulary.json",
    size: text.length,
    async text() { return text; }
  };
  const input = { value: "/fake/path/vocabulary.json" };

  const first = await prepareVocabularyImportFile(file);
  resetVocabularyImportInput(input);
  const second = await prepareVocabularyImportFile(file);

  assert.equal(input.value, "");
  assert.deepEqual(first.vocabulary, second.vocabulary);
});

test("files larger than five megabytes are rejected before reading", async () => {
  let wasRead = false;
  const file = {
    name: "too-large.json",
    size: MAX_VOCABULARY_IMPORT_BYTES + 1,
    async text() {
      wasRead = true;
      return "{}";
    }
  };

  await assert.rejects(
    prepareVocabularyImportFile(file),
    (error) => error.code === VOCABULARY_IMPORT_ERROR_CODES.FILE_TOO_LARGE
  );
  assert.equal(wasRead, false);
});

test("unreadable files, empty files, and non-JSON filenames return safe public errors", async () => {
  await assert.rejects(
    prepareVocabularyImportFile({
      name: "broken.json",
      size: 10,
      async text() { throw new Error("private stack"); }
    }),
    (error) => error.code === VOCABULARY_IMPORT_ERROR_CODES.READ_ERROR && error.message === "无法读取文件"
  );
  await assert.rejects(
    prepareVocabularyImportFile({ name: "empty.json", size: 0, async text() { return "  "; } }),
    (error) => error.code === VOCABULARY_IMPORT_ERROR_CODES.INVALID_DATA
  );
  await assert.rejects(
    prepareVocabularyImportFile({ name: "vocabulary.txt", size: 2, async text() { return "{}"; } }),
    (error) => error.code === VOCABULARY_IMPORT_ERROR_CODES.INVALID_DATA
  );
});
