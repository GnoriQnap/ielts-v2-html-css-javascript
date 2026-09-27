import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCloudLearningSetupDialog } from "../js/ui/cloud-learning-setup-dialog.js";

test("setup markup uses explicit copy and only the two learning choices", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /设置账号学习进度/);
  assert.match(html, /此账号还没有云端学习进度。你可以将当前设备的学习进度保存到账号，或从零开始。/);
  assert.match(html, /id="cloud-learning-save-guest"[^>]*>保存到账号</);
  assert.match(html, /id="cloud-learning-start-fresh"[^>]*>从零开始</);
  assert.match(html, /无论选择哪一种，当前设备的游客学习记录都会保留。/);
  assert.match(html, /id="cloud-learning-setup-close"[^>]*aria-label="关闭"[^>]*>×</);
  assert.doesNotMatch(html, /id="cloud-learning-setup-close"[^>]*>稍后处理</);
});

test("close keeps pending migration, performs no cloud write, and account entry can reopen", () => {
  const fixture = createFixture();
  fixture.controller.update(pendingStatus());
  assert.equal(fixture.overlay.hidden, false);
  assert.equal(fixture.body.classList.contains("cloud-learning-setup-open"), true);
  assert.equal(fixture.background.hasAttribute("inert"), true);

  fixture.close.click();
  assert.equal(fixture.overlay.hidden, true);
  assert.equal(fixture.body.classList.contains("cloud-learning-setup-open"), false);
  assert.equal(fixture.background.hasAttribute("inert"), false);
  assert.equal(fixture.blockedLearningSurface.hasAttribute("inert"), true);
  assert.equal(fixture.calls.saveGuest, 0);
  assert.equal(fixture.calls.startFresh, 0);
  assert.equal(fixture.calls.createCloudLearningState, 0);
  assert.equal(fixture.calls.updateCloudLearningState, 0);
  assert.equal(fixture.status.source, "pending-migration");
  fixture.controller.update(pendingStatus());
  assert.equal(fixture.overlay.hidden, true);
  assert.equal(fixture.open.hidden, false);
  fixture.open.click();
  assert.equal(fixture.overlay.hidden, false);
  assert.equal(fixture.body.classList.contains("cloud-learning-setup-open"), true);
  assert.equal(fixture.calls.saveGuest, 0);
  assert.equal(fixture.calls.startFresh, 0);
  fixture.documentRef.dispatch("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(fixture.overlay.hidden, true);
  assert.equal(fixture.blockedLearningSurface.hasAttribute("inert"), true);
  assert.equal(fixture.status.source, "pending-migration");
});

test("empty pending state does not ask before automatic creation", () => {
  const fixture = createFixture();
  fixture.controller.update(pendingStatus({ meaningfulGuestProgress: false }));
  assert.equal(fixture.overlay.hidden, true);
  assert.equal(fixture.open.hidden, false);
});

test("save and fresh actions close only after runtime reaches cloud", async () => {
  const fixture = createFixture();
  fixture.controller.update(pendingStatus());
  await fixture.saveGuest.click();
  assert.equal(fixture.calls.saveGuest, 1);
  assert.equal(fixture.overlay.hidden, true);

  fixture.status = pendingStatus({ userId: "b" });
  fixture.controller.update(fixture.status);
  await fixture.startFresh.click();
  assert.equal(fixture.calls.startFresh, 1);
  assert.equal(fixture.overlay.hidden, true);
});

test("create failure stays retryable and displays only safe feedback", async () => {
  const fixture = createFixture({ fail: true });
  fixture.controller.update(pendingStatus());
  await fixture.saveGuest.click();

  assert.equal(fixture.overlay.hidden, false);
  assert.equal(fixture.feedback.textContent, "暂时无法建立云端学习进度，请稍后重试。");
  assert.equal(fixture.feedback.textContent.includes("raw"), false);
  assert.equal(fixture.saveGuest.disabled, false);
});

test("close and Escape are blocked while account creation is in flight", async () => {
  const fixture = createFixture({ deferred: true });
  fixture.controller.update(pendingStatus());
  const submission = fixture.saveGuest.click();

  assert.equal(fixture.close.disabled, true);
  await fixture.close.click();
  fixture.documentRef.dispatch("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(fixture.overlay.hidden, false);

  fixture.finishDeferred();
  await submission;
  assert.equal(fixture.overlay.hidden, true);
});

test("password recovery defers Learning setup and preserves future normal auto-open", () => {
  const fixture = createFixture({ deferAutoOpen: true });
  const guestBefore = structuredClone(fixture.guestSnapshot);
  fixture.controller.update(pendingStatus());

  assert.equal(fixture.overlay.hidden, true);
  assert.equal(fixture.controller.isOpen(), false);
  assert.equal(fixture.calls.saveGuest, 0);
  assert.equal(fixture.calls.startFresh, 0);
  assert.equal(fixture.calls.createCloudLearningState, 0);
  assert.equal(fixture.status.source, "pending-migration");
  assert.deepEqual(fixture.guestSnapshot, guestBefore);

  fixture.deferAutoOpen = false;
  fixture.controller.update(pendingStatus());
  assert.equal(fixture.overlay.hidden, false);
});

test("PASSWORD_RECOVERY priority closes open Learning setup without releasing Auth-owned inert", () => {
  const fixture = createFixture();
  fixture.authFocus.focus();
  fixture.controller.update(pendingStatus());
  assert.equal(fixture.overlay.hidden, false);

  fixture.deferAutoOpen = true;
  fixture.controller.update(pendingStatus());

  assert.equal(fixture.overlay.hidden, true);
  assert.equal(fixture.documentRef.activeElement, fixture.authFocus);
  assert.equal(fixture.background.hasAttribute("inert"), false);
  assert.equal(fixture.blockedLearningSurface.hasAttribute("inert"), true);
  assert.equal(fixture.calls.saveGuest, 0);
  assert.equal(fixture.calls.startFresh, 0);
  assert.equal(fixture.status.source, "pending-migration");

  fixture.deferAutoOpen = false;
  fixture.controller.update(pendingStatus());
  assert.equal(fixture.overlay.hidden, false);
});

test("mobile setup actions stack without changing desktop card width", async () => {
  const css = await readFile(new URL("../css/base.css", import.meta.url), "utf8");
  assert.match(css, /\.cloud-learning-setup-card\s*\{\s*width:\s*min\(100%,\s*480px\)/);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.cloud-learning-setup-card\s*\{[^}]*width:\s*min\(100%,\s*368px\)/);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.cloud-learning-setup-actions\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /\.account-dialog-header h2\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.account-dialog-close\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px/);
});

function createFixture({ fail = false, deferred = false, deferAutoOpen = false } = {}) {
  const documentRef = new FakeDocument();
  const elements = {
    open: new FakeElement(documentRef),
    overlay: new FakeElement(documentRef),
    close: new FakeElement(documentRef),
    saveGuest: new FakeElement(documentRef),
    startFresh: new FakeElement(documentRef),
    feedback: new FakeElement(documentRef)
  };
  elements.open.hidden = true;
  elements.overlay.hidden = true;
  const body = new FakeElement(documentRef);
  const background = new FakeElement(documentRef);
  const authFocus = new FakeElement(documentRef);
  const blockedLearningSurface = new FakeElement(documentRef);
  blockedLearningSurface.setAttribute("inert", "");
  const calls = {
    saveGuest: 0,
    startFresh: 0,
    createCloudLearningState: 0,
    updateCloudLearningState: 0
  };
  let resolveDeferred;
  const deferredGate = deferred
    ? new Promise((resolve) => { resolveDeferred = resolve; })
    : null;
  const fixture = {
    ...elements,
    body,
    background,
    authFocus,
    blockedLearningSurface,
    documentRef,
    calls,
    deferAutoOpen,
    guestSnapshot: { learning: { byWordKey: { guest: { status: "review" } } } },
    finishDeferred: () => resolveDeferred?.(),
    status: pendingStatus()
  };
  const runtimeActions = {
    getStatus: () => fixture.status,
    async saveGuestProgressToAccount() {
      calls.saveGuest += 1;
      calls.createCloudLearningState += 1;
      if (deferredGate) await deferredGate;
      if (fail) return { ok: false, status: "error" };
      fixture.status = cloudStatus();
      return { ok: true, status: "created" };
    },
    async startCloudLearningFromZero() {
      calls.startFresh += 1;
      calls.createCloudLearningState += 1;
      if (fail) return { ok: false, status: "error" };
      fixture.status = cloudStatus();
      return { ok: true, status: "created" };
    }
  };
  fixture.controller = createCloudLearningSetupDialog({
    runtimeActions,
    elements,
    body,
    backgroundElements: [background, blockedLearningSurface],
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
    meaningfulGuestProgress: true,
    migrationInProgress: false,
    ...overrides
  };
}

function cloudStatus() {
  return {
    source: "authenticated-cloud",
    syncStatus: "connected",
    userId: "a",
    meaningfulGuestProgress: false,
    migrationInProgress: false
  };
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.listeners = new Map();
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  dispatch(type, event) { return this.listeners.get(type)?.(event); }
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
  async click() { return this.listeners.get("click")?.({ preventDefault() {} }); }
  focus() { this.documentRef.activeElement = this; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}
