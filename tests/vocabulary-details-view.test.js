import test from "node:test";
import assert from "node:assert/strict";
import {
  createVocabularyDetailsView,
  createVocabularyDetailsViewModel
} from "../js/ui/vocabulary-details-view.js";
import { createDefaultWordDetails } from "../js/core/vocabulary-details.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = "";
    this.textContent = "";
    this.children = [];
  }

  append(...children) {
    this.children.push(...children);
  }
}

const fakeDocument = {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
};

const completeDetails = {
  phonetics: { uk: "/aɪˈdɪə/", us: "/aɪˈdiːə/" },
  meanings: [{ partOfSpeech: "noun", definitionZh: "想法" }],
  collocations: ["good idea"],
  examples: [{ en: "That is a good idea.", zh: "那是个好主意。" }],
  notes: "IELTS 高频词",
  source: "teacher",
  updatedAt: "2026-07-22T10:00:00.000Z"
};

test("viewer renders one concise empty state for a word without details", () => {
  const view = createVocabularyDetailsView({
    displayText: "idea",
    details: createDefaultWordDetails(),
    documentRef: fakeDocument
  });

  assert.deepEqual(collectText(view), ["idea", "暂未添加单词详情"]);
  assert.equal(view.children.some((child) => child.tagName === "section"), false);
});

test("viewer model includes every complete details section in display order", () => {
  const model = createVocabularyDetailsViewModel({ displayText: "idea", details: completeDetails });

  assert.equal(model.displayText, "idea");
  assert.equal(model.phoneticUs, "/aɪˈdiːə/");
  assert.equal(model.meanings[0].definitionZh, "想法");
  assert.deepEqual(model.collocations, ["good idea"]);
  assert.equal(model.examples[0].zh, "那是个好主意。");
  assert.equal(model.notes, "IELTS 高频词");
  assert.equal(model.source, "teacher");
  assert.equal(model.isEmpty, false);
});

test("viewer uses final labels and strips collocation separators", () => {
  const view = createVocabularyDetailsView({
    displayText: "point",
    details: {
      ...createDefaultWordDetails(),
      phonetics: { uk: "/ignored/", us: "/pɔɪnt/" },
      meanings: [{ partOfSpeech: "n.", definitionZh: "观点；要点" }],
      collocations: ["make a point —— 提出观点"],
      examples: [{ en: "I take your point.", zh: "我明白你的意思。" }]
    },
    documentRef: fakeDocument
  });
  const text = collectText(view);
  for (const forbidden of ["英式音标", "美式音标", "中文释义", "常用搭配", "/ignored/"]) {
    assert.equal(text.includes(forbidden), false);
  }
  assert.equal(text.includes("搭配"), true);
  assert.equal(text.includes("例句"), true);
  assert.equal(text.includes("/pɔɪnt/"), true);
  assert.equal(text.includes("make a point\u00A0\u00A0提出观点"), true);
});

test("viewer formats both imported single and doubled dash collocation separators", () => {
  const model = createVocabularyDetailsViewModel({
    displayText: "point",
    details: {
      ...createDefaultWordDetails(),
      collocations: [
        "point of view — 观点",
        "make a point —— 提出观点",
        "well-known phrase"
      ]
    }
  });

  assert.deepEqual(model.collocations, [
    "point of view\u00A0\u00A0观点",
    "make a point\u00A0\u00A0提出观点",
    "well-known phrase"
  ]);
});

test("viewer treats hidden metadata-only details as empty", () => {
  const view = createVocabularyDetailsView({
    displayText: "idea",
    details: {
      ...createDefaultWordDetails(),
      notes: "internal note",
      source: "internal source"
    },
    documentRef: fakeDocument
  });

  assert.deepEqual(collectText(view), ["idea", "暂未添加单词详情"]);
});

test("viewer preserves multiple meanings", () => {
  const model = createVocabularyDetailsViewModel({
    displayText: "present",
    details: {
      ...createDefaultWordDetails(),
      meanings: [
        { partOfSpeech: "noun", definitionZh: "礼物" },
        { partOfSpeech: "verb", definitionZh: "展示" }
      ]
    }
  });

  assert.deepEqual(model.meanings, [
    { partOfSpeech: "noun", definitionZh: "礼物" },
    { partOfSpeech: "verb", definitionZh: "展示" }
  ]);
});

test("viewer preserves multiple examples with separate English and Chinese text", () => {
  const model = createVocabularyDetailsViewModel({
    displayText: "sustain",
    details: {
      ...createDefaultWordDetails(),
      examples: [
        { en: "We must sustain progress.", zh: "我们必须保持进步。" },
        { en: "The bridge can sustain the weight.", zh: "这座桥能承受重量。" }
      ]
    }
  });

  assert.equal(model.examples.length, 2);
  assert.equal(model.examples[0].en, "We must sustain progress.");
  assert.equal(model.examples[1].zh, "这座桥能承受重量。");
});

test("viewer preserves multiple collocations and renders them as separate items", () => {
  const view = createVocabularyDetailsView({
    displayText: "critical",
    details: {
      ...createDefaultWordDetails(),
      collocations: ["critical issue", "critical thinking", "critical role"]
    },
    documentRef: fakeDocument
  });
  const collocations = findByClass(view, "vocabulary-details-collocation");

  assert.deepEqual(collocations.map((item) => item.textContent), [
    "critical issue",
    "critical thinking",
    "critical role"
  ]);
});

function collectText(element) {
  const ownText = element.textContent ? [element.textContent] : [];
  return ownText.concat(element.children.flatMap(collectText));
}

function findByClass(element, className) {
  const ownMatch = element.className.split(" ").includes(className) ? [element] : [];
  return ownMatch.concat(element.children.flatMap((child) => findByClass(child, className)));
}
