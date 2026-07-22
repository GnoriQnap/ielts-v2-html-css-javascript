import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVocabularyExport,
  createVocabularyExportFilename,
  downloadVocabularyExport
} from "../js/core/vocabulary-export-service.js";
import { createVocabularyRepository } from "../js/core/vocabulary-repository.js";

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
    { group_id: 1, category: "重要的,关键的", words: ["critical"] },
    { group_id: 2, category: "短期的,紧急的", words: ["critical"] },
    { group_id: 3, category: "研究", words: ["study"] },
    { group_id: 4, category: "支持", words: ["support"] },
    { group_id: 5, category: "反对", words: ["oppose"] },
    { group_id: 6, category: "改变", words: ["change"] }
  ],
  word_details: {
    critical: {
      phonetics: { uk: "/ˈkrɪtɪkəl/", us: "/ˈkrɪtɪkəl/" },
      meanings: [{ partOfSpeech: "adjective", definitionZh: "关键的" }],
      collocations: ["critical issue"],
      examples: [{ en: "This is critical.", zh: "这很关键。" }],
      notes: "",
      source: "teacher",
      updatedAt: "2026-07-22T10:00:00.000Z"
    }
  }
};

function createLoadedRepository(source = vocabulary) {
  const repository = createVocabularyRepository({
    storage: new MemoryStorage(),
    fallbackVocabulary: source
  });
  repository.load();
  return repository;
}

test("export data comes from the repository current vocabulary", () => {
  const repository = createLoadedRepository();
  const current = repository.getCurrentVocabulary();
  current.vocabulary_list[0].category = "当前保存的分类";
  current.vocabulary_list[0].words.push("custom-word");
  repository.save(current);

  const exported = buildVocabularyExport(repository);

  assert.equal(exported.vocabulary_list[0].category, "当前保存的分类");
  assert.equal(exported.vocabulary_list[0].words.includes("custom-word"), true);
});

test("export contains only vocabulary data and no user learning state", () => {
  const exported = buildVocabularyExport(createLoadedRepository());

  assert.equal("learning" in exported, false);
  assert.equal("reviewQueue" in exported, false);
  assert.equal("practice" in exported, false);
  assert.equal("rounds" in exported, false);
  assert.equal("activeQuestion" in exported, false);
});

test("export data matches the complete current vocabulary including details", () => {
  const repository = createLoadedRepository();

  assert.deepEqual(buildVocabularyExport(repository), repository.getCurrentVocabulary());
});

test("building export data cannot mutate repository vocabulary", () => {
  const repository = createLoadedRepository();
  const before = repository.getCurrentVocabulary();
  const exported = buildVocabularyExport(repository);

  exported.vocabulary_list[0].category = "导出副本修改";
  exported.word_details.critical.meanings[0].definitionZh = "changed";

  assert.deepEqual(repository.getCurrentVocabulary(), before);
});

test("export filename uses the user's local calendar date", () => {
  assert.equal(
    createVocabularyExportFilename(new Date(2026, 6, 22, 23, 59, 59)),
    "ielts-vocabulary-2026-07-22.json"
  );
});

test("invalid repository vocabulary blocks export", () => {
  const invalidRepository = {
    getCurrentVocabulary() {
      return { vocabulary_list: [{ group_id: 1, category: "不足", words: ["only"] }] };
    }
  };

  assert.throws(() => buildVocabularyExport(invalidRepository), /不合法，无法导出/);
});

test("browser download uses formatted UTF-8 JSON and revokes its object URL", () => {
  const repository = createLoadedRepository();
  const events = [];
  const link = {
    hidden: false,
    click() { events.push("click"); },
    remove() { events.push("remove"); }
  };
  const documentRef = {
    createElement(tagName) {
      assert.equal(tagName, "a");
      return link;
    },
    body: {
      append(candidate) {
        assert.equal(candidate, link);
        events.push("append");
      }
    }
  };
  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options.type;
    }
  }
  let createdBlob = null;
  const urlApi = {
    createObjectURL(blob) {
      createdBlob = blob;
      events.push("create-url");
      return "blob:test";
    },
    revokeObjectURL(url) {
      assert.equal(url, "blob:test");
      events.push("revoke-url");
    }
  };

  const result = downloadVocabularyExport(repository, {
    date: new Date(2026, 6, 22),
    documentRef,
    urlApi,
    BlobCtor: FakeBlob
  });

  assert.equal(link.download, "ielts-vocabulary-2026-07-22.json");
  assert.equal(link.href, "blob:test");
  assert.equal(createdBlob.type, "application/json;charset=utf-8");
  assert.equal(createdBlob.parts[0].includes('"category": "重要的,关键的"'), true);
  assert.equal(createdBlob.parts[0].endsWith("\n"), true);
  assert.deepEqual(events, ["create-url", "append", "click", "remove", "revoke-url"]);
  assert.equal(result.json, createdBlob.parts[0]);
});
