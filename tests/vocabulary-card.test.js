import test from "node:test";
import assert from "node:assert/strict";
import { createVocabularyCard } from "../js/ui/vocabulary-card.js";
import { createDefaultWordDetails } from "../js/core/vocabulary-details.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = "";
    this.textContent = "";
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
  }

  append(...children) {
    this.children.push(...children);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  click() {
    this.listeners.get("click")?.({ currentTarget: this });
  }
}

const fakeDocument = {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
};

test("vocabulary card opens with word-first scrollable content and footer", () => {
  const card = createVocabularyCard({
    displayText: "sustain",
    details: createDefaultWordDetails(),
    documentRef: fakeDocument
  });

  assert.equal(card.className, "vocabulary-card");
  assert.deepEqual(card.children.map((child) => child.tagName), ["main", "footer"]);
  assert.deepEqual(collectText(card), [
    "sustain",
    "暂未添加单词详情",
    "关闭"
  ]);
});

test("the single footer action closes and can restore the calling page", () => {
  let closeCount = 0;
  const card = createVocabularyCard({
    displayText: "idea",
    details: createDefaultWordDetails(),
    onClose: () => { closeCount += 1; },
    documentRef: fakeDocument
  });
  const closeActions = findByDataset(card, "vocabularyCardClose");

  assert.equal(closeActions.length, 1);
  closeActions[0].click();
  assert.equal(closeCount, 1);
});

test("practice, wordbook, and manager inputs reuse the same vocabulary card", () => {
  for (const entryPoint of ["Practice", "Wordbook", "Vocabulary Manager"]) {
    const card = createVocabularyCard({
      displayText: entryPoint,
      details: createDefaultWordDetails(),
      documentRef: fakeDocument
    });
    assert.equal(findByClass(card, "vocabulary-details-view").length, 1);
    assert.equal(collectText(card).includes(entryPoint), true);
  }
});

test("card reuses the viewer for multiple meanings and examples", () => {
  const card = createVocabularyCard({
    displayText: "present",
    details: {
      ...createDefaultWordDetails(),
      meanings: [
        { partOfSpeech: "noun", definitionZh: "礼物" },
        { partOfSpeech: "verb", definitionZh: "展示" }
      ],
      examples: [
        { en: "This is a present.", zh: "这是一份礼物。" },
        { en: "They present the results.", zh: "他们展示结果。" }
      ]
    },
    documentRef: fakeDocument
  });

  assert.equal(findByClass(card, "vocabulary-details-meaning").length, 2);
  assert.equal(findByClass(card, "vocabulary-details-example").length, 2);
});

test("legacy words with empty details show only the concise empty message", () => {
  const card = createVocabularyCard({
    displayText: "idea",
    details: undefined,
    documentRef: fakeDocument
  });
  const detailsView = findByClass(card, "vocabulary-details-view")[0];

  assert.deepEqual(collectText(detailsView), ["idea", "暂未添加单词详情"]);
});

function collectText(element) {
  const ownText = element.textContent ? [element.textContent] : [];
  return ownText.concat(element.children.flatMap(collectText));
}

function findByClass(element, className) {
  const ownMatch = element.className.split(" ").includes(className) ? [element] : [];
  return ownMatch.concat(element.children.flatMap((child) => findByClass(child, className)));
}

function findByDataset(element, key) {
  const ownMatch = element.dataset[key] ? [element] : [];
  return ownMatch.concat(element.children.flatMap((child) => findByDataset(child, key)));
}
