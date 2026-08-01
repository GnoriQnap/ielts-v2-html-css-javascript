import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { defaultVocabularyData } from "../js/data/default-vocabulary.js";
import { createVocabularyIndex } from "../js/core/vocabulary-index.js";
import {
  createWordbookDataCache,
  filterWordbookEntries
} from "../js/core/wordbook-service.js";

const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

function sourceBetween(start, end) {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return appSource.slice(startIndex, endIndex);
}

test("official 1119-word Wordbook model is cached and keeps filter/search results correct", () => {
  const index = createVocabularyIndex(defaultVocabularyData.vocabulary_list);
  const learning = {
    byWordKey: {
      idea: { status: "review" },
      point: { status: "remembered" }
    }
  };
  const cache = createWordbookDataCache();
  const model = cache.get(index, learning);

  assert.equal(model.entries.length, 1119);
  assert.equal(model.categoryTree.length, 98);
  assert.equal(cache.get(index, learning), model);
  assert.deepEqual(
    filterWordbookEntries(model.entries, { filter: "review" }).map(({ wordKey }) => wordKey),
    ["idea"]
  );
  assert.deepEqual(
    filterWordbookEntries(model.entries, { filter: "remembered" }).map(({ wordKey }) => wordKey),
    ["point"]
  );
  assert.equal(filterWordbookEntries(model.entries, { query: "观点" }).length > 0, true);
  assert.equal(filterWordbookEntries(model.entries, { query: "" }).length, 1119);
});

test("Wordbook rendering does not load details, save vocabulary, validate, or rebuild the index", () => {
  const renderSource = sourceBetween("function renderWordbook()", "function getWordbookData()");
  const dataSource = sourceBetween("function getWordbookData()", "function renderWordbookCategoryTree(");

  assert.doesNotMatch(renderSource, /getWordDetails|vocabularyRepository|validateVocabulary|createVocabularyIndex|persistState/);
  assert.doesNotMatch(dataSource, /getWordDetails|vocabularyRepository|validateVocabulary|createVocabularyIndex|persistState/);
  assert.match(dataSource, /wordbookDataCache\.get\(report\.index, appState\.learning\)/);
});

test("Vocabulary Card opens one word without rebuilding or saving Wordbook data", () => {
  const openSource = sourceBetween("function openVocabularyDetails(wordKey)", "function closeWordDetail()");
  const closeSource = sourceBetween("function closeWordDetail()", "function persistState()");

  assert.match(openSource, /vocabularyRepository\.getWordDetails\(wordKey\)/);
  assert.doesNotMatch(openSource, /renderWordbook|createVocabularyIndex|validateVocabulary|\.save\(/);
  assert.doesNotMatch(closeSource, /renderWordbook|createVocabularyIndex|validateVocabulary|\.save\(/);
});

test("Wordbook uses one delegated list listener and category toggles update only their node", () => {
  assert.equal(
    appSource.match(/elements\.wordbookList\.addEventListener\("click", handleWordbookListClick\)/g)?.length,
    1
  );
  const clickSource = sourceBetween("function handleWordbookListClick(event)", "function openActiveQuestionDetails()");
  const categoryBranch = clickSource.slice(0, clickSource.indexOf("const statusAction"));

  assert.match(categoryBranch, /section\.append\(createWordbookCategoryWords\(group\)\)/);
  assert.doesNotMatch(categoryBranch, /renderWordbook\(\)/);
});
