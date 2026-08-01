import test from "node:test";
import assert from "node:assert/strict";
import { vocabularyData } from "../js/data/vocabulary.js";
import { vocabularyDetails } from "../js/data/vocabulary-details.js";
import { defaultVocabularyData } from "../js/data/default-vocabulary.js";
import { normalizeWordKey } from "../js/core/normalization.js";
import {
  createVocabularyRepository,
  VOCABULARY_STORAGE_KEY
} from "../js/core/vocabulary-repository.js";
import { validateVocabularyData } from "../js/core/vocabulary-validator.js";
import { validateVocabularyDetails } from "../js/core/vocabulary-details.js";
import { buildVocabularyExport } from "../js/core/vocabulary-export-service.js";
import {
  commitVocabularyImport,
  prepareVocabularyImportText
} from "../js/core/vocabulary-import-service.js";
import { createVocabularyDetailsViewModel } from "../js/ui/vocabulary-details-view.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.writeCount = 0;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.writeCount += 1;
    this.values.set(key, String(value));
  }
}

const officialWordKeys = new Set(vocabularyData.vocabulary_list.flatMap((group) => (
  group.words.map(normalizeWordKey)
)));

test("formal details contain exactly one valid entry for every official wordKey", () => {
  const detailWordKeys = new Set(Object.keys(vocabularyDetails));

  assert.equal(detailWordKeys.size, 1119);
  assert.deepEqual(detailWordKeys, officialWordKeys);
  for (const [wordKey, details] of Object.entries(vocabularyDetails)) {
    assert.deepEqual(validateVocabularyDetails(details), [], wordKey);
  }
  const validation = validateVocabularyData(defaultVocabularyData);
  assert.equal(validation.isValid, true);
  assert.equal(validation.summary.uniqueWordCount, 1119);
});

test("first load and damaged-cache fallback expose all formal details", () => {
  const firstRepository = createVocabularyRepository({
    storage: new MemoryStorage(),
    fallbackVocabulary: defaultVocabularyData
  });
  const firstLoad = firstRepository.load();

  assert.equal(Object.keys(firstLoad.word_details).length, 1119);
  assert.equal(firstRepository.getWordDetails("idea").meanings.length > 0, true);

  const damagedStorage = new MemoryStorage();
  const invalidVocabulary = structuredClone(vocabularyData);
  invalidVocabulary.vocabulary_list[1].group_id = invalidVocabulary.vocabulary_list[0].group_id;
  damagedStorage.setItem(VOCABULARY_STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    savedAt: "2026-07-31T00:00:00.000Z",
    vocabulary: invalidVocabulary
  }));
  const fallbackRepository = createVocabularyRepository({
    storage: damagedStorage,
    fallbackVocabulary: defaultVocabularyData
  });

  assert.equal(Object.keys(fallbackRepository.load().word_details).length, 1119);
  assert.equal(fallbackRepository.getWordDetails("point").examples.length > 0, true);
});

test("old cache receives missing system details without changing user learning state", () => {
  const storage = new MemoryStorage();
  const oldVocabulary = structuredClone(vocabularyData);
  storage.setItem(VOCABULARY_STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    savedAt: "2026-07-20T00:00:00.000Z",
    vocabulary: oldVocabulary
  }));
  const learningState = JSON.stringify({
    schemaVersion: 1,
    learning: { byWordKey: { idea: { status: "review", errorCount: 2 } } },
    practice: {
      activeQuestion: { wordKey: "idea" },
      reviewQueue: [{ wordKey: "idea" }]
    },
    rounds: {
      current: { id: "round-existing", wordKeys: ["idea"] },
      lastCompletedSummary: { roundId: "round-history" }
    }
  });
  storage.setItem("ielts_synonym_trainer_state", learningState);
  const repository = createVocabularyRepository({
    storage,
    fallbackVocabulary: defaultVocabularyData,
    legacyStateKey: "ielts_synonym_trainer_state"
  });
  const loaded = repository.load();

  assert.equal(Object.keys(loaded.word_details).length, 1119);
  assert.equal(repository.getWordDetails("idea").phonetics.us.length > 0, true);
  assert.equal(storage.getItem("ielts_synonym_trainer_state"), learningState);
  assert.equal(
    Object.keys(JSON.parse(storage.getItem(VOCABULARY_STORAGE_KEY)).vocabulary.word_details).length,
    1119
  );
  const writesAfterUpgrade = storage.writeCount;
  const reloaded = createVocabularyRepository({
    storage,
    fallbackVocabulary: defaultVocabularyData,
    legacyStateKey: "ielts_synonym_trainer_state"
  });
  reloaded.load();
  assert.equal(storage.writeCount, writesAfterUpgrade);
});

test("current cache marker prevents repeated supplementation during normal detail reads", () => {
  const storage = new MemoryStorage();
  const initialRepository = createVocabularyRepository({
    storage,
    fallbackVocabulary: defaultVocabularyData
  });
  initialRepository.load();
  initialRepository.save(initialRepository.getCurrentVocabulary());
  const writesBeforeReload = storage.writeCount;
  let validationCount = 0;
  const repository = createVocabularyRepository({
    storage,
    fallbackVocabulary: defaultVocabularyData,
    validator(candidate) {
      validationCount += 1;
      return validateVocabularyData(candidate);
    }
  });

  repository.load();
  const validationsAfterLoad = validationCount;
  for (let index = 0; index < 50; index += 1) {
    const details = repository.getWordDetails(index % 2 === 0 ? "idea" : "point");
    details.meanings[0].definitionZh = "mutated copy";
  }

  assert.equal(validationsAfterLoad, 1);
  assert.equal(validationCount, validationsAfterLoad);
  assert.equal(storage.writeCount, writesBeforeReload);
  assert.notEqual(repository.getWordDetails("idea").meanings[0].definitionZh, "mutated copy");
  assert.notEqual(repository.getWordDetails("point").meanings[0].definitionZh, "mutated copy");
});

test("cache supplementation preserves non-empty system details and custom words", () => {
  const storage = new MemoryStorage();
  const cachedVocabulary = structuredClone(vocabularyData);
  cachedVocabulary.vocabulary_list[0].words.push("custom learner word");
  cachedVocabulary.word_details = {
    idea: {
      phonetics: { uk: "", us: "/custom/" },
      meanings: [{ partOfSpeech: "n.", definitionZh: "用户保存的释义" }],
      collocations: [],
      examples: [],
      notes: "",
      source: "user",
      updatedAt: ""
    },
    "custom learner word": {
      phonetics: { uk: "", us: "/custom-word/" },
      meanings: [{ partOfSpeech: "n.", definitionZh: "自定义词" }],
      collocations: [],
      examples: [],
      notes: "",
      source: "user",
      updatedAt: ""
    }
  };
  storage.setItem(VOCABULARY_STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    savedAt: "2026-07-30T00:00:00.000Z",
    vocabulary: cachedVocabulary
  }));
  const repository = createVocabularyRepository({
    storage,
    fallbackVocabulary: defaultVocabularyData
  });
  const loaded = repository.load();

  assert.equal(loaded.vocabulary_list[0].words.includes("custom learner word"), true);
  assert.equal(repository.getWordDetails("idea").meanings[0].definitionZh, "用户保存的释义");
  assert.equal(repository.getWordDetails("idea").phonetics.us, "/custom/");
  assert.equal(
    repository.getWordDetails("custom learner word").meanings[0].definitionZh,
    "自定义词"
  );
  assert.equal(repository.getWordDetails("point").meanings.length > 0, true);
});

test("formal details survive vocabulary export and complete import", () => {
  const sourceRepository = createVocabularyRepository({
    storage: new MemoryStorage(),
    fallbackVocabulary: defaultVocabularyData
  });
  sourceRepository.load();
  const exported = buildVocabularyExport(sourceRepository);
  const prepared = prepareVocabularyImportText(JSON.stringify(exported));
  const targetRepository = createVocabularyRepository({
    storage: new MemoryStorage(),
    fallbackVocabulary: defaultVocabularyData
  });
  targetRepository.load();

  const imported = commitVocabularyImport(targetRepository, prepared);

  assert.equal(Object.keys(imported.vocabulary.word_details).length, 1119);
  assert.deepEqual(imported.vocabulary.word_details, exported.word_details);
});

test("Vocabulary Card reads the integrated details for representative official words", () => {
  const repository = createVocabularyRepository({
    storage: new MemoryStorage(),
    fallbackVocabulary: defaultVocabularyData
  });
  repository.load();
  const wordKeys = [
    "idea",
    "thought(think)",
    "view",
    "concept",
    "point",
    "appear to",
    "alter(alternative, alternate)",
    "prefer (to)",
    "intensive (100m sprint)",
    "from one’s family",
    "since born"
  ];

  for (const wordKey of wordKeys) {
    const model = createVocabularyDetailsViewModel({
      displayText: wordKey,
      details: repository.getWordDetails(wordKey)
    });
    assert.equal(model.isEmpty, false, wordKey);
    assert.equal(model.phoneticUs.length > 0, true, wordKey);
    assert.equal(model.meanings.length > 0, true, wordKey);
    assert.equal(model.examples.length > 0, true, wordKey);
  }
});
