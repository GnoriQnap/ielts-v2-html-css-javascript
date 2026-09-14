import test from "node:test";
import assert from "node:assert/strict";
import {
  createVocabularyRepository,
  VOCABULARY_STORAGE_KEY
} from "../js/core/vocabulary-repository.js";
import { validateVocabularyData } from "../js/core/vocabulary-validator.js";
import { createQuestion } from "../js/core/question-engine.js";
import { createWordbookEntries } from "../js/core/wordbook-service.js";
import { createDefaultAppState } from "../js/core/storage.js";
import { addVocabularyWord } from "../js/core/vocabulary-word-service.js";

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
    { group_id: 1, category: "重要", words: ["critical"] },
    { group_id: 2, category: "紧急", words: ["critical"] },
    { group_id: 3, category: "研究", words: ["study"] },
    { group_id: 4, category: "支持", words: ["support"] },
    { group_id: 5, category: "反对", words: ["oppose"] },
    { group_id: 6, category: "改变", words: ["change"] }
  ]
};

test("repository loads the fallback as the current vocabulary without sharing mutable references", () => {
  const repository = createVocabularyRepository({
    storage: new MemoryStorage(),
    fallbackVocabulary
  });

  const loaded = repository.load();
  loaded.vocabulary_list[0].category = "已修改";

  assert.equal(repository.getCurrentVocabulary().vocabulary_list[0].category, "重要");
  assert.notEqual(repository.getCurrentVocabulary(), loaded);
});

test("repository saves a dedicated vocabulary cache and reloads it", () => {
  const storage = new MemoryStorage();
  const repository = createVocabularyRepository({
    storage,
    fallbackVocabulary,
    now: () => new Date("2026-07-17T08:00:00.000Z")
  });
  const updatedVocabulary = structuredClone(fallbackVocabulary);
  updatedVocabulary.vocabulary_list[0].category = "关键";

  repository.saveMaintenanceVocabulary(updatedVocabulary);
  const cache = JSON.parse(storage.getItem(VOCABULARY_STORAGE_KEY));
  const reloaded = createVocabularyRepository({ storage, fallbackVocabulary }).load();

  assert.equal(cache.schemaVersion, 1);
  assert.equal(cache.savedAt, "2026-07-17T08:00:00.000Z");
  assert.equal(reloaded.vocabulary_list[0].category, "关键");
});

test("legacy incompatible vocabulary remains readable without being silently migrated or rewritten", () => {
  const storage = new MemoryStorage();
  const legacyVocabulary = structuredClone(fallbackVocabulary);
  legacyVocabulary.vocabulary_list[0].category = "旧存档分类";
  storage.setItem("legacy-user-state", JSON.stringify({
    vocabulary: legacyVocabulary,
    learning: { byWordKey: {} }
  }));

  const repository = createVocabularyRepository({
    storage,
    fallbackVocabulary,
    legacyStateKey: "legacy-user-state",
    now: () => new Date("2026-07-17T09:00:00.000Z")
  });

  assert.equal(repository.load().vocabulary_list[0].category, "旧存档分类");
  assert.equal(storage.getItem(VOCABULARY_STORAGE_KEY), null);
  assert.deepEqual(JSON.parse(storage.getItem("legacy-user-state")), {
    vocabulary: legacyVocabulary,
    learning: { byWordKey: {} }
  });
  assert.equal(repository.getOfficialCompatibility().status, "legacy-incompatible");
});

test("damaged or invalid cache falls back safely", () => {
  const storage = new MemoryStorage();
  storage.setItem(VOCABULARY_STORAGE_KEY, "{damaged json");
  const repository = createVocabularyRepository({ storage, fallbackVocabulary });

  assert.deepEqual(repository.load(), fallbackVocabulary);
  assert.throws(
    () => repository.save({ vocabulary_list: "invalid" }),
    /vocabulary_list/
  );
});

test("validator, question engine, and wordbook consume the repository vocabulary consistently", () => {
  const repository = createVocabularyRepository({
    storage: new MemoryStorage(),
    fallbackVocabulary
  });
  const report = validateVocabularyData(repository.load());
  const question = createQuestion(report.index, {
    wordKey: "critical",
    random: () => 0
  });
  const entries = createWordbookEntries(
    report.index,
    createDefaultAppState().learning
  );
  const critical = entries.find((entry) => entry.wordKey === "critical");

  assert.equal(report.isValid, true);
  assert.deepEqual(new Set(question.correctGroupIds), new Set([1, 2]));
  assert.equal(question.options.length, 6);
  assert.deepEqual(critical.categories.map(({ groupId }) => groupId), [1, 2]);
});

test("a word without stored details returns the complete empty details structure", () => {
  const repository = createVocabularyRepository({
    storage: new MemoryStorage(),
    fallbackVocabulary
  });
  repository.load();

  assert.deepEqual(repository.getWordDetails("critical"), {
    phonetics: { uk: "", us: "" },
    meanings: [],
    collocations: [],
    examples: [],
    notes: "",
    source: "",
    updatedAt: ""
  });
});

test("setWordDetails saves normalized details and survives repository reload", () => {
  const storage = new MemoryStorage();
  const repository = createVocabularyRepository({ storage, fallbackVocabulary });
  repository.load();
  const added = addVocabularyWord(repository.getCurrentVocabulary(), "sampleterm", [1]);
  repository.save(added.vocabulary);
  const details = {
    phonetics: { uk: "/ˈkrɪtɪkəl/", us: "/ˈkrɪtɪkəl/" },
    meanings: [{ partOfSpeech: "adjective", definitionZh: "关键的" }],
    collocations: ["critical issue"],
    examples: [{ en: "This is critical.", zh: "这很关键。" }],
    notes: "IELTS 高频词",
    source: "teacher",
    updatedAt: "2026-07-22T10:00:00.000Z"
  };

  repository.setWordDetails("sampleterm", details);
  const reloaded = createVocabularyRepository({ storage, fallbackVocabulary });
  reloaded.load();

  assert.deepEqual(reloaded.getWordDetails("sampleterm"), details);
  assert.deepEqual(
    reloaded.getCurrentVocabulary().word_details.sampleterm,
    details
  );
});

test("word details inputs and outputs are deep copies", () => {
  const repository = createVocabularyRepository({
    storage: new MemoryStorage(),
    fallbackVocabulary
  });
  repository.load();
  const added = addVocabularyWord(repository.getCurrentVocabulary(), "sampleterm", [1]);
  repository.save(added.vocabulary);
  const input = {
    phonetics: { uk: "/test/" },
    meanings: [{ definitionZh: "测试" }],
    collocations: ["test case"],
    examples: [{ en: "A test." }]
  };

  const saved = repository.setWordDetails("sampleterm", input);
  input.phonetics.uk = "/changed/";
  input.meanings[0].definitionZh = "已修改";
  saved.collocations.push("changed");
  const firstRead = repository.getWordDetails("sampleterm");
  firstRead.examples[0].en = "Changed.";

  assert.deepEqual(repository.getWordDetails("sampleterm"), {
    phonetics: { uk: "/test/", us: "" },
    meanings: [{ partOfSpeech: "", definitionZh: "测试" }],
    collocations: ["test case"],
    examples: [{ en: "A test.", zh: "" }],
    notes: "",
    source: "",
    updatedAt: ""
  });
});

test("runtime vocabulary replacement rebuilds validation without writing the Guest cache", () => {
  const storage = new MemoryStorage();
  const repository = createVocabularyRepository({ storage, fallbackVocabulary });
  repository.load();
  const candidate = addVocabularyWord(repository.getCurrentVocabulary(), "runtime-only", [1]).vocabulary;
  const cacheBefore = storage.getItem(VOCABULARY_STORAGE_KEY);

  repository.replaceRuntimeVocabulary(candidate);

  assert.equal(repository.getCurrentValidation().index.displayByWordKey.has("runtime-only"), true);
  assert.equal(storage.getItem(VOCABULARY_STORAGE_KEY), cacheBefore);
});
