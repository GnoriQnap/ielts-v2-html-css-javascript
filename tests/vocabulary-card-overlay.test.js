import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createVocabularyCardOverlayController } from "../js/ui/vocabulary-card-overlay.js";
import { createVocabularyCard } from "../js/ui/vocabulary-card.js";
import { createDefaultWordDetails } from "../js/core/vocabulary-details.js";

test("HTML, JavaScript, and CSS share one vocabulary card overlay contract", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../js/app.js", import.meta.url), "utf8"),
    readFile(new URL("../css/base.css", import.meta.url), "utf8")
  ]);

  assert.equal((html.match(/id="vocabulary-card-overlay"/g) ?? []).length, 1);
  assert.equal((html.match(/id="vocabulary-card-host"/g) ?? []).length, 1);
  assert.match(html, /class="vocabulary-card-overlay"[\s\S]*hidden[\s\S]*aria-hidden="true"/);
  assert.match(html, /base\.css\?v=8\.4c2/);
  assert.match(app, /querySelector\("#vocabulary-card-overlay"\)/);
  assert.match(app, /querySelector\("#vocabulary-card-host"\)/);
  assert.match(css, /\.vocabulary-card-overlay\s*\{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;/);
  assert.match(css, /\.vocabulary-card-overlay\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(css, /width:\s*min\(88vw,\s*430px\)/);
  assert.match(css, /height:\s*min\(74dvh,\s*calc\(88vw \+ 96px\),\s*520px\)/);
  assert.match(css, /place-items:\s*center/);
  assert.match(css, /backdrop-filter:\s*blur\(4px\)/);
});

test("opening and closing synchronizes hidden, aria, classes, inert, and focus", () => {
  const fixture = createFixture();
  const card = createCard(fixture.documentRef, fixture.controller.close);

  fixture.controller.open(card, { returnFocusElement: fixture.trigger });
  assert.equal(fixture.overlay.hidden, false);
  assert.equal(fixture.overlay.attributes.get("aria-hidden"), "false");
  assert.equal(fixture.overlay.classList.contains("is-open"), true);
  assert.equal(fixture.body.classList.contains("vocabulary-card-open"), true);
  assert.equal(fixture.background.hasAttribute("inert"), true);
  assert.equal(findByDataset(card, "vocabularyCardClose")[0].focused, true);

  fixture.controller.close();
  assertClosed(fixture);
  assert.equal(fixture.trigger.focused, true);
});

test("the footer close action releases the overlay", () => {
  const fixture = createFixture();
  const card = createCard(fixture.documentRef, fixture.controller.close);
  fixture.controller.open(card, { returnFocusElement: fixture.trigger });

  const closeActions = findByDataset(card, "vocabularyCardClose");
  assert.equal(closeActions.length, 1);
  closeActions[0].click();
  assertClosed(fixture);
});

test("Escape closes the card and releases scroll lock", () => {
  const fixture = createFixture();
  fixture.controller.open(createCard(fixture.documentRef, fixture.controller.close));

  fixture.documentRef.dispatch("keydown", { key: "Escape", preventDefault() {} });
  assertClosed(fixture);
});

test("repeated open and close never leaves scroll lock or duplicate content", () => {
  const fixture = createFixture();
  for (let index = 0; index < 3; index += 1) {
    fixture.controller.open(createCard(fixture.documentRef, fixture.controller.close));
    assert.equal(fixture.host.children.length, 1);
    fixture.controller.close();
    assertClosed(fixture);
  }
});

test("mount failure rolls back every visible and scroll-lock state", () => {
  const fixture = createFixture();
  fixture.host.failNextReplace = true;

  assert.throws(
    () => fixture.controller.open(createCard(fixture.documentRef, fixture.controller.close)),
    /mount failed/
  );
  assertClosed(fixture);
});

test("old words with empty details can open and close through the same overlay", () => {
  const fixture = createFixture();
  const card = createVocabularyCard({
    displayText: "idea",
    details: createDefaultWordDetails(),
    onClose: fixture.controller.close,
    documentRef: fixture.documentRef
  });

  fixture.controller.open(card);
  assert.equal(collectText(card).includes("暂未添加单词详情"), true);
  fixture.controller.close();
  assertClosed(fixture);
});

function createFixture() {
  const documentRef = new FakeDocument();
  const overlay = new FakeElement("div");
  const host = new FakeElement("div");
  const body = new FakeElement("body");
  const background = new FakeElement("main");
  const trigger = new FakeElement("button");
  const controller = createVocabularyCardOverlayController({
    overlay,
    host,
    body,
    backgroundElements: [background],
    documentRef
  });
  return { documentRef, overlay, host, body, background, trigger, controller };
}

function createCard(documentRef, onClose) {
  return createVocabularyCard({
    displayText: "idea",
    details: createDefaultWordDetails(),
    onClose,
    documentRef
  });
}

function assertClosed(fixture) {
  assert.equal(fixture.overlay.hidden, true);
  assert.equal(fixture.overlay.attributes.get("aria-hidden"), "true");
  assert.equal(fixture.overlay.classList.contains("is-open"), false);
  assert.equal(fixture.body.classList.contains("vocabulary-card-open"), false);
  assert.equal(fixture.background.hasAttribute("inert"), false);
  assert.equal(fixture.host.children.length, 0);
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = "";
    this.textContent = "";
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.hidden = true;
    this.isConnected = true;
    this.focused = false;
    this.failNextReplace = false;
  }

  append(...children) { this.children.push(...children); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  toggleAttribute(name, force) {
    if (force) this.attributes.set(name, "");
    else this.attributes.delete(name);
  }
  hasAttribute(name) { return this.attributes.has(name); }
  replaceChildren(...children) {
    if (this.failNextReplace) {
      this.failNextReplace = false;
      throw new Error("mount failed");
    }
    this.children = children;
  }
  querySelector(selector) {
    if (selector === "[data-vocabulary-card-close]") {
      return findByDataset(this, "vocabularyCardClose")[0] ?? null;
    }
    return null;
  }
  focus() { this.focused = true; }
  click() { this.listeners.get("click")?.({ currentTarget: this }); }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.activeElement = null;
  }
  createElement(tagName) { return new FakeElement(tagName); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  dispatch(type, event) { this.listeners.get(type)?.(event); }
}

function findByDataset(element, key) {
  const ownMatch = element.dataset[key] ? [element] : [];
  return ownMatch.concat(element.children.flatMap((child) => findByDataset(child, key)));
}

function collectText(element) {
  const ownText = element.textContent ? [element.textContent] : [];
  return ownText.concat(element.children.flatMap(collectText));
}
