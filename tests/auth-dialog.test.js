import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AUTH_STATUSES } from "../js/core/auth-service.js";
import {
  AUTH_DIALOG_MODES,
  AUTH_DIALOG_VIEWS,
  createAuthDialogController
} from "../js/ui/auth-dialog.js";

test("account HTML provides a guest entry and safe email/password fields", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="account-nav"[^>]*>登录</);
  assert.match(html, /id="account-email"[^>]*type="email"/);
  assert.match(html, /id="account-password"[^>]*type="password"/);
  assert.match(html, /id="account-confirm-password"[^>]*type="password"/);
  assert.match(html, /id="account-confirmation-pending"/);
  assert.match(html, /请前往邮箱点击确认链接完成注册/);
  assert.match(html, /id="account-confirmation-result"/);
  assert.match(html, /id="account-dialog-close"[^>]*aria-label="关闭"[^>]*>×</);
  assert.doesNotMatch(html, /id="account-dialog-close"[^>]*>关闭</);
  assert.equal((html.match(/id="account-overlay"/g) ?? []).length, 1);
});

test("guest can repeatedly open and close without inert or scroll-lock residue", () => {
  const fixture = createFixture();
  for (let count = 0; count < 3; count += 1) {
    fixture.controller.open();
    assert.equal(fixture.overlay.hidden, false);
    assert.equal(fixture.body.classList.contains("account-dialog-open"), true);
    assert.equal(fixture.background.hasAttribute("inert"), true);
    fixture.controller.close();
    assertClosed(fixture);
    assert.equal(fixture.controller.getMode(), AUTH_DIALOG_MODES.SIGN_IN);
  }
});

test("account dialog preserves background inert owned by Learning", () => {
  const fixture = createFixture();
  fixture.background.setAttribute("inert", "");
  fixture.secondaryBackground.setAttribute("inert", "");

  fixture.controller.open();
  fixture.controller.close();

  assert.equal(fixture.background.hasAttribute("inert"), true);
  assert.equal(fixture.secondaryBackground.hasAttribute("inert"), true);
});

test("login and registration modes switch in the same dialog", () => {
  const fixture = createFixture();
  fixture.controller.open();
  fixture.modeToggle.click();
  assert.equal(fixture.controller.getMode(), AUTH_DIALOG_MODES.SIGN_UP);
  assert.equal(fixture.title.textContent, "创建账号");
  assert.equal(fixture.confirmRow.hidden, false);
  assert.equal(fixture.confirmPassword.required, true);
  fixture.modeToggle.click();
  assert.equal(fixture.controller.getMode(), AUTH_DIALOG_MODES.SIGN_IN);
  assert.equal(fixture.confirmRow.hidden, true);
});

test("password confirmation mismatch prevents registration submission", async () => {
  const fixture = createFixture();
  fixture.controller.setMode(AUTH_DIALOG_MODES.SIGN_UP);
  fixture.email.value = "user@example.com";
  fixture.password.value = "first-value";
  fixture.confirmPassword.value = "second-value";

  await fixture.form.dispatch("submit", { preventDefault() {} });
  assert.equal(fixture.service.calls.signUp, 0);
  assert.equal(fixture.feedback.textContent, "两次输入的密码不一致。");
});

test("successful sign in and sign up render the account state", async () => {
  const fixture = createFixture();
  fixture.controller.open();
  fixture.email.value = "member@example.com";
  fixture.password.value = "password";
  await fixture.form.dispatch("submit", { preventDefault() {} });
  assert.equal(fixture.service.calls.signIn, 1);
  assert.equal(fixture.trigger.textContent, "账户");
  assert.equal(fixture.accountPanel.hidden, false);
  assert.equal(fixture.accountEmail.textContent, "member@example.com");

  fixture.service.setState(guestState());
  fixture.controller.setMode(AUTH_DIALOG_MODES.SIGN_UP);
  fixture.email.value = "new@example.com";
  fixture.password.value = "password";
  fixture.confirmPassword.value = "password";
  await fixture.form.dispatch("submit", { preventDefault() {} });
  assert.equal(fixture.service.calls.signUp, 1);
  assert.equal(fixture.trigger.textContent, "账户");
});

test("signup with no session shows confirmation instructions and stores only the email", async () => {
  const fixture = createFixture(guestState(), { confirmationRequired: true });
  fixture.controller.open();
  fixture.controller.setMode(AUTH_DIALOG_MODES.SIGN_UP);
  fixture.email.value = "pending@example.com";
  fixture.password.value = "private-value";
  fixture.confirmPassword.value = "private-value";

  await fixture.form.dispatch("submit", { preventDefault() {} });

  assert.equal(fixture.controller.getView(), AUTH_DIALOG_VIEWS.CONFIRMATION_PENDING);
  assert.equal(fixture.title.textContent, "请确认邮箱");
  assert.equal(fixture.form.hidden, true);
  assert.equal(fixture.pendingPanel.hidden, false);
  assert.equal(fixture.pendingEmail.textContent, "pending@example.com");
  assert.equal(fixture.password.value, "");
  assert.equal(fixture.confirmPassword.value, "");
  assert.deepEqual(fixture.pendingStore.values, ["pending@example.com"]);
  assert.equal(fixture.pendingStore.values.includes("private-value"), false);
  assert.equal(
    fixture.service.calls.lastSignUp.emailRedirectTo,
    "http://localhost:8000/?auth=confirmed"
  );
});

test("valid confirmation requires Supabase auth, signs out, and prefills a blank login form", async () => {
  const fixture = createFixture(authenticatedState("pending@example.com"), {
    pendingEmail: "pending@example.com"
  });
  const result = await fixture.controller.handleEmailConfirmationCallback({
    isCallback: true,
    hasConfirmationEvidence: true,
    hasError: false
  });

  assert.deepEqual(result, { handled: true, success: true });
  assert.equal(fixture.service.calls.signOut, 1);
  assert.equal(fixture.controller.getView(), AUTH_DIALOG_VIEWS.CONFIRMATION_SUCCESS);
  assert.equal(fixture.title.textContent, "邮箱确认成功");
  assert.equal(fixture.confirmationPanel.hidden, false);
  assert.equal(fixture.pendingStore.cleared, 1);
  assert.equal(fixture.scheduled.length, 1);

  fixture.scheduled[0]();
  assert.equal(fixture.controller.getMode(), AUTH_DIALOG_MODES.SIGN_IN);
  assert.equal(fixture.email.value, "pending@example.com");
  assert.equal(fixture.password.value, "");
  assert.equal(fixture.form.hidden, false);
  assert.match(fixture.feedback.textContent, /邮箱确认成功/);
});

test("invalid confirmation callback shows failure actions without claiming success", async () => {
  const fixture = createFixture(guestState(), { pendingEmail: "pending@example.com" });
  const result = await fixture.controller.handleEmailConfirmationCallback({
    isCallback: true,
    hasConfirmationEvidence: false,
    hasError: true
  });

  assert.deepEqual(result, { handled: true, success: false });
  assert.equal(fixture.controller.getView(), AUTH_DIALOG_VIEWS.CONFIRMATION_FAILURE);
  assert.equal(fixture.title.textContent, "邮箱确认失败");
  assert.match(fixture.confirmationMessage.textContent, /确认链接可能已失效/);
  assert.equal(fixture.confirmationReturnLogin.hidden, false);
  assert.equal(fixture.confirmationReturnSignup.hidden, false);
  assert.equal(fixture.service.calls.signOut, 0);
});

test("restored session shows account and sign out returns to guest", async () => {
  const fixture = createFixture(authenticatedState("saved@example.com"));
  assert.equal(fixture.trigger.textContent, "账户");
  fixture.controller.open();
  await fixture.signOut.click();
  assert.equal(fixture.service.calls.signOut, 1);
  assert.equal(fixture.trigger.textContent, "登录");
  assertClosed(fixture);
});

test("unavailable account service keeps the dialog safe and informative", () => {
  const fixture = createFixture({ status: AUTH_STATUSES.UNAVAILABLE, user: null, reason: "service-unavailable" });
  fixture.controller.open();
  assert.equal(fixture.feedback.textContent, "暂时无法连接账号服务，请稍后重试。");
  assert.equal(fixture.submit.disabled, true);
  assert.equal(fixture.close.focused, true);
  fixture.controller.close();
  assertClosed(fixture);
});

test("Escape closes the account overlay and mobile CSS prevents overflow", async () => {
  const fixture = createFixture();
  fixture.controller.open();
  await fixture.documentRef.dispatch("keydown", { key: "Escape", preventDefault() {} });
  assertClosed(fixture);

  const css = await readFile(new URL("../css/base.css", import.meta.url), "utf8");
  assert.match(css, /\.account-card\s*\{[\s\S]*width:\s*min\(100%,\s*430px\)/);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.account-card\s*\{[\s\S]*width:\s*min\(100%,\s*368px\)/);
  assert.match(css, /\.account-form input\s*\{[\s\S]*width:\s*100%/);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.account-form input\s*\{\s*font-size:\s*16px;/);
});

function createFixture(initialState = guestState(), options = {}) {
  const documentRef = new FakeDocument();
  const body = new FakeElement("body", documentRef);
  const background = new FakeElement("main", documentRef);
  const secondaryBackground = new FakeElement("main", documentRef);
  const elements = {
    trigger: new FakeElement("button", documentRef),
    overlay: new FakeElement("div", documentRef),
    title: new FakeElement("h2", documentRef),
    close: new FakeElement("button", documentRef),
    form: new FakeElement("form", documentRef),
    email: new FakeElement("input", documentRef),
    password: new FakeElement("input", documentRef),
    confirmRow: new FakeElement("div", documentRef),
    confirmPassword: new FakeElement("input", documentRef),
    submit: new FakeElement("button", documentRef),
    modeToggle: new FakeElement("button", documentRef),
    accountPanel: new FakeElement("section", documentRef),
    accountEmail: new FakeElement("strong", documentRef),
    signOut: new FakeElement("button", documentRef),
    pendingPanel: new FakeElement("section", documentRef),
    pendingEmail: new FakeElement("strong", documentRef),
    pendingReturnLogin: new FakeElement("button", documentRef),
    confirmationPanel: new FakeElement("section", documentRef),
    confirmationMessage: new FakeElement("p", documentRef),
    confirmationReturnLogin: new FakeElement("button", documentRef),
    confirmationReturnSignup: new FakeElement("button", documentRef),
    feedback: new FakeElement("p", documentRef)
  };
  elements.overlay.hidden = true;
  const service = createFakeService(initialState, options);
  const pendingStore = createFakePendingEmailStore(options.pendingEmail);
  const scheduled = [];
  const controller = createAuthDialogController({
    service,
    elements,
    body,
    backgroundElements: [background, secondaryBackground],
    documentRef,
    locationRef: { origin: "http://localhost:8000", pathname: "/" },
    pendingEmailStore: pendingStore,
    schedule(callback) { scheduled.push(callback); return scheduled.length; },
    cancelSchedule() {}
  });
  return {
    ...elements,
    body,
    background,
    secondaryBackground,
    controller,
    documentRef,
    pendingStore,
    scheduled,
    service
  };
}

function createFakeService(initialState, options = {}) {
  let state = initialState;
  const listeners = new Set();
  const calls = { signIn: 0, signUp: 0, signOut: 0, lastSignUp: null };
  function publish(nextState) {
    state = nextState;
    for (const listener of listeners) listener(state);
  }
  return {
    calls,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    setState: publish,
    async signIn({ email }) {
      calls.signIn += 1;
      publish(authenticatedState(email));
      return { ok: true, state };
    },
    async signUp(input) {
      calls.signUp += 1;
      calls.lastSignUp = input;
      const { email } = input;
      if (options.confirmationRequired) {
        publish(guestState());
        return { ok: true, status: "confirmation-required", email, state };
      }
      publish(authenticatedState(email));
      return { ok: true, status: "authenticated", state };
    },
    async signOut() {
      calls.signOut += 1;
      publish(guestState());
      return { ok: true, state };
    }
  };
}

function createFakePendingEmailStore(initialValue = "") {
  let value = initialValue;
  return {
    values: [],
    cleared: 0,
    load() { return value; },
    save(email) { value = email; this.values.push(email); return true; },
    clear() { value = ""; this.cleared += 1; return true; }
  };
}

function guestState() {
  return { status: AUTH_STATUSES.GUEST, user: null, reason: null };
}

function authenticatedState(email) {
  return { status: AUTH_STATUSES.AUTHENTICATED, user: { id: "user-id", email }, reason: null };
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName, documentRef) {
    this.tagName = tagName;
    this.documentRef = documentRef;
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.required = false;
    this.value = "";
    this.textContent = "";
    this.isConnected = true;
    this.focused = false;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  async dispatch(type, event = {}) { return this.listeners.get(type)?.(event); }
  async click() { return this.dispatch("click", { currentTarget: this }); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  toggleAttribute(name, force) {
    if (force) this.attributes.set(name, "");
    else this.attributes.delete(name);
  }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  focus() {
    this.focused = true;
    this.documentRef.activeElement = this;
  }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.activeElement = null;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  async dispatch(type, event) { return this.listeners.get(type)?.(event); }
}

function assertClosed(fixture) {
  assert.equal(fixture.overlay.hidden, true);
  assert.equal(fixture.overlay.attributes.get("aria-hidden"), "true");
  assert.equal(fixture.body.classList.contains("account-dialog-open"), false);
  assert.equal(fixture.background.hasAttribute("inert"), false);
  assert.equal(fixture.secondaryBackground.hasAttribute("inert"), false);
}
