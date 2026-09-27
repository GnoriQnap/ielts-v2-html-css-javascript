import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCustomVocabularySetupDialog } from "../js/ui/custom-vocabulary-setup-dialog.js";

test("migration dialog has only the two explicit choices and no close escape", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const section = html.match(/id="custom-vocabulary-setup-overlay"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(section, /设置账号自定义词汇/);
  assert.match(section, /id="custom-vocabulary-save-guest"[^>]*>保存到账号</);
  assert.match(section, /id="custom-vocabulary-start-empty"[^>]*>从零开始</);
  assert.match(section, /从零开始不会删除这台设备上的访客词汇/);
  assert.doesNotMatch(section, /aria-label="关闭"|>×</);
});

test("meaningful migration blocks the page until a successful explicit choice", async () => {
  const fixture = createFixture();
  fixture.controller.update(pendingStatus());
  assert.equal(fixture.overlay.hidden, false);
  assert.equal(fixture.background.hasAttribute("inert"), true);
  assert.equal(fixture.open.hidden, false);
  await fixture.saveGuest.click();
  assert.deepEqual(fixture.calls, ["save-guest"]);
  assert.equal(fixture.overlay.hidden, true);
  assert.equal(fixture.background.hasAttribute("inert"), false);
});

test("legacy blocked migration hides upload and permits only account Start Empty", async () => {
  const fixture = createFixture();
  fixture.controller.update(pendingStatus({
    syncStatus: "guest-snapshot-unavailable",
    migrationKind: "guest-snapshot-unavailable"
  }));
  assert.equal(fixture.title.textContent, "无法直接同步本机词汇");
  assert.equal(fixture.saveGuest.hidden, true);
  assert.equal(fixture.startEmpty.textContent, "账号从零开始");
  await fixture.startEmpty.click();
  assert.deepEqual(fixture.calls, ["start-empty"]);
});

test("empty Guest stays invisible during auto-create but exposes a retry after failure", () => {
  const fixture = createFixture();
  fixture.controller.update(pendingStatus({ migrationKind: "empty-guest" }));
  assert.equal(fixture.overlay.hidden, true);
  assert.equal(fixture.open.hidden, true);
  fixture.controller.update(pendingStatus({ migrationKind: "empty-guest", syncStatus: "setup-error" }));
  assert.equal(fixture.overlay.hidden, false);
  assert.equal(fixture.saveGuest.hidden, true);
  assert.equal(fixture.startEmpty.textContent, "重试初始化");
});

test("password recovery defers pending setup without consuming its later auto-open", async () => {
  const fixture = createFixture({ deferAutoOpen: true });
  fixture.controller.update(pendingStatus());

  assert.equal(fixture.overlay.hidden, true);
  assert.equal(fixture.controller.isOpen(), false);
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.status.source, "pending-migration");

  fixture.deferAutoOpen = false;
  fixture.controller.update(pendingStatus());
  assert.equal(fixture.overlay.hidden, false);
  await fixture.saveGuest.click();
  assert.deepEqual(fixture.calls, ["save-guest"]);
});

test("PASSWORD_RECOVERY priority safely closes an already-open setup and preserves inert ownership", () => {
  const fixture = createFixture();
  fixture.authFocus.focus();
  fixture.controller.update(pendingStatus());
  assert.equal(fixture.overlay.hidden, false);
  assert.equal(fixture.background.hasAttribute("inert"), true);

  fixture.deferAutoOpen = true;
  fixture.controller.update(pendingStatus());

  assert.equal(fixture.overlay.hidden, true);
  assert.equal(fixture.documentRef.activeElement, fixture.authFocus);
  assert.equal(fixture.background.hasAttribute("inert"), false);
  assert.equal(fixture.authOwnedBackground.hasAttribute("inert"), true);
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.status.source, "pending-migration");

  fixture.deferAutoOpen = false;
  fixture.controller.update(pendingStatus());
  assert.equal(fixture.overlay.hidden, false);
});

test("mobile dialog reuses the stacked full-width setup layout", async () => {
  const css = await readFile(new URL("../css/base.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.cloud-learning-setup-actions\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /\.cloud-learning-setup-card\s*\{\s*width:\s*min\(100%,\s*480px\)/);
  assert.match(css, /body\.custom-vocabulary-setup-open\s*\{\s*overflow:\s*hidden/);
});

function createFixture({ deferAutoOpen = false } = {}) {
  const documentRef = new FakeDocument();
  const elements = {
    open: new FakeElement(documentRef),
    overlay: new FakeElement(documentRef),
    title: new FakeElement(documentRef),
    copy: new FakeElement(documentRef),
    saveGuest: new FakeElement(documentRef),
    startEmpty: new FakeElement(documentRef),
    note: new FakeElement(documentRef),
    feedback: new FakeElement(documentRef)
  };
  elements.open.hidden = true;
  elements.overlay.hidden = true;
  const body = new FakeElement(documentRef);
  const background = new FakeElement(documentRef);
  const authOwnedBackground = new FakeElement(documentRef);
  authOwnedBackground.setAttribute("inert", "");
  const authFocus = new FakeElement(documentRef);
  const fixture = {
    ...elements,
    body,
    background,
    authOwnedBackground,
    authFocus,
    documentRef,
    deferAutoOpen,
    calls: [],
    status: pendingStatus()
  };
  fixture.controller = createCustomVocabularySetupDialog({
    integrationActions: {
      async completeMigration(action) {
        fixture.calls.push(action);
        fixture.status = { source: "authenticated-cloud", syncStatus: "connected" };
        return { ok: true, status: "created" };
      }
    },
    runtimeActions: { getStatus: () => fixture.status },
    elements,
    body,
    backgroundElements: [background, authOwnedBackground],
    documentRef,
    shouldDeferAutoOpen: () => fixture.deferAutoOpen
  });
  return fixture;
}

function pendingStatus(overrides = {}) {
  return {
    source: "pending-migration",
    syncStatus: "pending-migration",
    userId: "a",
    migrationRequired: true,
    migrationKind: "meaningful-guest",
    operationInProgress: false,
    ...overrides
  };
}

class FakeDocument {
  constructor() { this.activeElement = null; }
}

class FakeElement {
  constructor(documentRef) {
    this.documentRef = documentRef;
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    this.textContent = "";
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList();
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  async click() { return this.listeners.get("click")?.(); }
  focus() { this.documentRef.activeElement = this; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
}
