import test from "node:test";
import assert from "node:assert/strict";
import {
  commitVocabularyDetailsImport,
  prepareVocabularyDetailsImportData,
  prepareVocabularyDetailsImportFile,
  prepareVocabularyDetailsImportText,
  VOCABULARY_DETAILS_IMPORT_ERROR_CODES
} from "../js/core/vocabulary-details-import-service.js";
import { createVocabularyRepository } from "../js/core/vocabulary-repository.js";
import { createDefaultAppState } from "../js/core/storage.js";
import { createVocabularyDetailsViewModel } from "../js/ui/vocabulary-details-view.js";

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

const fallbackVocabulary = {
  vocabulary_list: [
    { group_id: 1, category: "观点", words: ["idea"] },
    { group_id: 2, category: "研究", words: ["study"] },
    { group_id: 3, category: "支持", words: ["support"] },
    { group_id: 4, category: "反对", words: ["oppose"] },
    { group_id: 5, category: "改变", words: ["change"] },
    { group_id: 6, category: "重要", words: ["critical"] }
  ]
};

function createLoadedRepository() {
  const repository = createVocabularyRepository({
    storage: new MemoryStorage(),
    fallbackVocabulary
  });
  repository.load();
  return repository;
}

function ideaDraft() {
  return {
    phonetics: {
      uk: "/aɪˈdɪə/",
      us: "/aɪˈdiːə/"
    },
    meanings: [{ partOfSpeech: "n.", definitionZh: "想法；观点" }],
    collocations: [{ phrase: "have an idea", meaningZh: "有一个想法" }],
    examples: [{
      en: "She came up with a new idea.",
      zh: "她提出了一个新想法。"
    }]
  };
}

test("a legal AI details JSON file is prepared before confirmation and then imported", async () => {
  const repository = createLoadedRepository();
  const beforeVocabulary = repository.getCurrentVocabulary();
  const text = JSON.stringify({ idea: ideaDraft() });
  const file = {
    name: "word-details.json",
    size: text.length,
    async text() { return text; }
  };

  const prepared = await prepareVocabularyDetailsImportFile(file, repository);

  assert.deepEqual(prepared.summary, {
    totalCount: 1,
    successCount: 1,
    failureCount: 0
  });
  assert.deepEqual(repository.getCurrentVocabulary(), beforeVocabulary);

  const result = commitVocabularyDetailsImport(repository, prepared);

  assert.deepEqual(result.importedWordKeys, ["idea"]);
  assert.deepEqual(repository.getWordDetails("idea"), {
    phonetics: { uk: "/aɪˈdɪə/", us: "/aɪˈdiːə/" },
    meanings: [{ partOfSpeech: "n.", definitionZh: "想法；观点" }],
    collocations: ["have an idea — 有一个想法"],
    examples: [{
      en: "She came up with a new idea.",
      zh: "她提出了一个新想法。"
    }],
    notes: "",
    source: "",
    updatedAt: ""
  });
  assert.deepEqual(
    repository.getCurrentVocabulary().vocabulary_list,
    beforeVocabulary.vocabulary_list
  );
});

test("an unknown wordKey is rejected without modifying the repository", () => {
  const repository = createLoadedRepository();
  const before = repository.getCurrentVocabulary();
  const prepared = prepareVocabularyDetailsImportData({ missing: ideaDraft() }, repository);

  assert.deepEqual(prepared.summary, {
    totalCount: 1,
    successCount: 0,
    failureCount: 1
  });
  assert.equal(
    prepared.failures[0].errors[0].code,
    VOCABULARY_DETAILS_IMPORT_ERROR_CODES.WORD_NOT_FOUND
  );
  assert.deepEqual(commitVocabularyDetailsImport(repository, prepared), {
    importedCount: 0,
    importedWordKeys: [],
    failureCount: 1,
    failures: prepared.failures
  });
  assert.deepEqual(repository.getCurrentVocabulary(), before);
});

test("wrong field types and missing required item fields are rejected", () => {
  const repository = createLoadedRepository();
  const prepared = prepareVocabularyDetailsImportText(JSON.stringify({
    idea: {
      phonetics: { uk: 42 }
    },
    study: {
      meanings: [{ partOfSpeech: "n." }],
      collocations: [{ phrase: "have an idea" }],
      examples: [{ en: "An idea." }]
    }
  }), repository);
  const codes = new Set(prepared.failures.flatMap((failure) => (
    failure.errors.map((error) => error.code)
  )));

  assert.equal(prepared.summary.successCount, 0);
  assert.equal(prepared.summary.failureCount, 2);
  assert.equal(codes.has(VOCABULARY_DETAILS_IMPORT_ERROR_CODES.INVALID_DETAILS), true);
  assert.equal(codes.has(VOCABULARY_DETAILS_IMPORT_ERROR_CODES.MISSING_FIELD), true);
});

test("valid words can be committed when other draft words fail", () => {
  const repository = createLoadedRepository();
  const prepared = prepareVocabularyDetailsImportData({
    idea: ideaDraft(),
    missing: ideaDraft()
  }, repository);

  assert.deepEqual(prepared.summary, {
    totalCount: 2,
    successCount: 1,
    failureCount: 1
  });
  const result = commitVocabularyDetailsImport(repository, prepared);

  assert.equal(result.importedCount, 1);
  assert.equal(result.failureCount, 1);
  assert.equal(repository.getWordDetails("idea").meanings[0].definitionZh, "想法；观点");
});

test("imported details are immediately readable by the Vocabulary Card view model", () => {
  const repository = createLoadedRepository();
  const prepared = prepareVocabularyDetailsImportData({ idea: ideaDraft() }, repository);
  commitVocabularyDetailsImport(repository, prepared);

  const model = createVocabularyDetailsViewModel({
    displayText: "idea",
    details: repository.getWordDetails("idea")
  });

  assert.equal(model.isEmpty, false);
  assert.equal(model.meanings[0].definitionZh, "想法；观点");
  assert.deepEqual(model.collocations, ["have an idea — 有一个想法"]);
  assert.equal(model.examples[0].en, "She came up with a new idea.");
});

test("details import cannot change learning, review queue, or round history", () => {
  const repository = createLoadedRepository();
  const appState = createDefaultAppState();
  appState.learning.byWordKey.idea = {
    status: "review",
    correctCount: 2,
    errorCount: 1,
    answerCount: 3,
    lastAnsweredAt: "2026-07-22T08:00:00.000Z",
    reviewSince: "2026-07-22T08:00:00.000Z",
    enteredRoundIds: [],
    roundsEntered: 0
  };
  appState.practice.reviewQueue = [{
    wordKey: "idea",
    scope: "free",
    roundId: null,
    scheduledAtAttempt: 1,
    dueAfterAttempt: 7,
    delay: 6
  }];
  appState.rounds.lastCompletedSummary = { roundId: "round-history" };
  const before = structuredClone(appState);

  commitVocabularyDetailsImport(
    repository,
    prepareVocabularyDetailsImportData({ idea: ideaDraft() }, repository)
  );

  assert.deepEqual(appState, before);
});

test("a save failure rolls back details already written in the same batch", () => {
  const baseRepository = createLoadedRepository();
  const before = baseRepository.getCurrentVocabulary();
  let writeCount = 0;
  const failingRepository = {
    getCurrentVocabulary: () => baseRepository.getCurrentVocabulary(),
    save: (vocabulary) => baseRepository.save(vocabulary),
    setWordDetails(wordKey, details) {
      writeCount += 1;
      if (writeCount === 2) {
        throw new Error("storage failed");
      }
      return baseRepository.setWordDetails(wordKey, details);
    }
  };
  const prepared = prepareVocabularyDetailsImportData({
    idea: ideaDraft(),
    study: ideaDraft()
  }, failingRepository);

  assert.throws(
    () => commitVocabularyDetailsImport(failingRepository, prepared),
    (error) => error.code === VOCABULARY_DETAILS_IMPORT_ERROR_CODES.SAVE_ERROR
  );
  assert.deepEqual(baseRepository.getCurrentVocabulary(), before);
});
