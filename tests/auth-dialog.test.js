import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AUTH_CALLBACK_CLASSIFICATIONS } from "../js/core/auth-confirmation.js";
import { AUTH_SESSION_KINDS, AUTH_STATUSES } from "../js/core/auth-service.js";
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
  assert.match(html, /id="account-forgot-password"[^>]*>忘记密码？</);
  assert.match(html, /id="account-resend-confirmation"/);
  assert.match(html, /id="account-pending-resend"/);
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

test("dialog restores focus outside before marking its overlay aria-hidden", () => {
  const fixture = createFixture();
  fixture.trigger.focus();
  fixture.controller.open();
  assert.equal(fixture.documentRef.activeElement, fixture.email);

  fixture.controller.close();

  assert.equal(fixture.documentRef.activeElement, fixture.trigger);
  assert.equal(fixture.overlay.activeElementWhenAriaHidden, fixture.trigger);
  assert.equal(fixture.overlay.attributes.get("aria-hidden"), "true");
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

test("new-browser confirmation uses the authenticated session email without pending local state", async () => {
  const fixture = createFixture(authenticatedState("new-browser@example.com"));
  fixture.password.value = "must-clear";
  const result = await fixture.controller.handleEmailConfirmationCallback({
    isCallback: true,
    hasConfirmationEvidence: true,
    hasError: false
  });

  assert.deepEqual(result, { handled: true, success: true });
  assert.equal(fixture.service.calls.signOut, 1);
  fixture.scheduled[0]();
  assert.equal(fixture.email.value, "new-browser@example.com");
  assert.equal(fixture.password.value, "");
  assert.equal(fixture.service.getState().status, AUTH_STATUSES.GUEST);
});

test("confirmation signout failure stays blocking and retries only signout before releasing ownership", async () => {
  const releasedStates = [];
  const fixture = createFixture(authenticatedState("retry@example.com"), {
    signOutFailures: 1,
    onConfirmationSignOutResolved(state) { releasedStates.push(state); }
  });
  const result = await fixture.controller.handleEmailConfirmationCallback({
    isCallback: true,
    hasConfirmationEvidence: true,
    hasError: false
  });

  assert.deepEqual(result, {
    handled: true,
    success: false,
    reason: "sign-out-failed"
  });
  assert.equal(fixture.controller.getView(), AUTH_DIALOG_VIEWS.CONFIRMATION_FAILURE);
  assert.equal(fixture.close.disabled, true);
  assert.equal(fixture.confirmationReturnLogin.textContent, "重试安全退出");
  assert.equal(fixture.confirmationReturnSignup.hidden, true);

  fixture.controller.close();
  assert.equal(fixture.controller.isOpen(), true);
  await fixture.confirmationReturnLogin.click();

  assert.equal(fixture.service.calls.signOut, 2);
  assert.equal(fixture.controller.getView(), AUTH_DIALOG_VIEWS.CONFIRMATION_SUCCESS);
  assert.equal(fixture.close.disabled, false);
  assert.equal(releasedStates.length, 1);
  assert.equal(releasedStates[0].status, AUTH_STATUSES.GUEST);
  assert.equal(fixture.pendingStore.cleared, 1);
});

test("gated email-mismatch failure signs out safely before returning to login", async () => {
  const releasedStates = [];
  const fixture = createFixture(authenticatedState("callback@example.com"), {
    pendingEmail: "different@example.com",
    signOutFailures: 1,
    onConfirmationSignOutResolved(state) { releasedStates.push(state); }
  });
  const result = await fixture.controller.handleEmailConfirmationCallback({
    isCallback: true,
    hasConfirmationEvidence: true,
    hasError: false
  });

  assert.deepEqual(result, { handled: true, success: false });
  assert.equal(fixture.service.calls.signOut, 0);
  assert.equal(fixture.controller.getView(), AUTH_DIALOG_VIEWS.CONFIRMATION_FAILURE);
  assert.equal(fixture.confirmationReturnLogin.textContent, "安全退出并返回登录");
  assert.equal(fixture.confirmationReturnSignup.hidden, false);

  await fixture.confirmationReturnLogin.click();
  assert.equal(fixture.service.calls.signOut, 1);
  assert.equal(fixture.controller.getView(), AUTH_DIALOG_VIEWS.CONFIRMATION_FAILURE);
  assert.equal(fixture.controller.isOpen(), true);
  assert.equal(fixture.close.disabled, true);
  assert.equal(releasedStates.length, 0);

  await fixture.confirmationReturnLogin.click();
  assert.equal(fixture.service.calls.signOut, 2);
  assert.equal(releasedStates.length, 1);
  assert.equal(releasedStates[0].status, AUTH_STATUSES.GUEST);
  assert.equal(fixture.controller.getMode(), AUTH_DIALOG_MODES.SIGN_IN);
  assert.equal(fixture.controller.getView(), AUTH_DIALOG_VIEWS.AUTH);
  assert.equal(fixture.title.textContent, "登录");
  assert.equal(fixture.password.value, "");
  assert.equal(fixture.scheduled.length, 0);
  assert.equal(fixture.feedback.textContent.includes("邮箱确认成功"), false);
});

test("gated confirmation failure signs out before returning to signup", async () => {
  const releasedStates = [];
  const fixture = createFixture(authenticatedState("callback@example.com"), {
    pendingEmail: "different@example.com",
    onConfirmationSignOutResolved(state) { releasedStates.push(state); }
  });
  await fixture.controller.handleEmailConfirmationCallback({
    isCallback: true,
    hasConfirmationEvidence: true,
    hasError: false
  });

  await fixture.confirmationReturnSignup.click();
  assert.equal(fixture.service.calls.signOut, 1);
  assert.equal(releasedStates.length, 1);
  assert.equal(releasedStates[0].status, AUTH_STATUSES.GUEST);
  assert.equal(fixture.controller.getMode(), AUTH_DIALOG_MODES.SIGN_UP);
  assert.equal(fixture.controller.getView(), AUTH_DIALOG_VIEWS.AUTH);
  assert.equal(fixture.password.value, "");
  assert.equal(fixture.scheduled.length, 0);
});

test("gated confirmation failure close and Escape require safe signout", async () => {
  const closed = createFixture(authenticatedState("callback@example.com"), {
    pendingEmail: "different@example.com"
  });
  await closed.controller.handleEmailConfirmationCallback({
    isCallback: true,
    hasConfirmationEvidence: true,
    hasError: false
  });
  await closed.controller.close();
  assert.equal(closed.service.calls.signOut, 1);
  assert.equal(closed.service.getState().status, AUTH_STATUSES.GUEST);
  assertClosed(closed);
  assert.notEqual(closed.overlay.activeElementWhenAriaHidden, closed.close);

  const escaped = createFixture(authenticatedState("callback@example.com"), {
    pendingEmail: "different@example.com",
    signOutFailures: 1
  });
  await escaped.controller.handleEmailConfirmationCallback({
    isCallback: true,
    hasConfirmationEvidence: true,
    hasError: false
  });
  await escaped.documentRef.dispatch("keydown", { key: "Escape", preventDefault() {} });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(escaped.service.calls.signOut, 1);
  assert.equal(escaped.controller.isOpen(), true);
  assert.equal(escaped.controller.getView(), AUTH_DIALOG_VIEWS.CONFIRMATION_FAILURE);

  await escaped.confirmationReturnLogin.click();
  assert.equal(escaped.service.calls.signOut, 2);
  assertClosed(escaped);
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

test("recovery request is email-only and presents enumeration-safe outcomes", async () => {
  const fixture = createFixture();
  fixture.controller.open();
  await fixture.forgotPassword.click();
  assert.equal(fixture.controller.getMode(), AUTH_DIALOG_MODES.RECOVERY_REQUEST);
  assert.equal(fixture.passwordRow.hidden, true);
  assert.equal(fixture.confirmRow.hidden, true);

  fixture.email.value = "bad";
  await fixture.form.dispatch("submit", { preventDefault() {} });
  assert.equal(fixture.service.calls.requestPasswordRecovery, 0);
  assert.match(fixture.feedback.textContent, /有效的邮箱/);

  fixture.email.value = "recover@example.com";
  fixture.password.value = "must-not-be-used";
  await fixture.form.dispatch("submit", { preventDefault() {} });
  assert.equal(fixture.service.calls.requestPasswordRecovery, 1);
  assert.deepEqual(fixture.service.calls.lastRecoveryRequest, {
    email: "recover@example.com",
    redirectTo: "http://localhost:8000/?auth=recovery"
  });
  assert.match(fixture.feedback.textContent, /如果该邮箱/);
  assert.equal(JSON.stringify(fixture.service.calls.lastRecoveryRequest).includes("must-not-be-used"), false);
});

test("recovery request distinguishes rate limit and generic service failure without raw errors", async () => {
  const limited = createFixture(guestState(), {
    recoveryRequestResult: { ok: false, code: "rate-limited" }
  });
  limited.controller.setMode(AUTH_DIALOG_MODES.RECOVERY_REQUEST);
  limited.email.value = "recover@example.com";
  await limited.form.dispatch("submit", { preventDefault() {} });
  assert.match(limited.feedback.textContent, /操作过于频繁/);

  const unavailable = createFixture(guestState(), {
    recoveryRequestResult: { ok: false, code: "recovery-request-failed", raw: "private" }
  });
  unavailable.controller.setMode(AUTH_DIALOG_MODES.RECOVERY_REQUEST);
  unavailable.email.value = "recover@example.com";
  await unavailable.form.dispatch("submit", { preventDefault() {} });
  assert.equal(unavailable.feedback.textContent.includes("private"), false);
  assert.match(unavailable.feedback.textContent, /暂时无法发送/);
});

test("ordinary authenticated state plus forged recovery intent cannot open password update", () => {
  const fixture = createFixture(authenticatedState("ordinary@example.com"));
  const result = fixture.controller.handlePasswordRecoveryCallback({
    classification: AUTH_CALLBACK_CLASSIFICATIONS.PASSWORD_RECOVERY
  });
  assert.deepEqual(result, { handled: true, success: false });
  assert.equal(fixture.controller.getView(), AUTH_DIALOG_VIEWS.RECOVERY_FAILURE);
  assert.equal(fixture.controller.isRecoveryBlocking(), false);
  assert.equal(fixture.passwordRow.hidden, false);
  assert.equal(fixture.form.hidden, true);
});

test("SDK-confirmed recovery opens a blocking password-update form", () => {
  const fixture = createFixture(recoveryState());
  const result = fixture.controller.handlePasswordRecoveryCallback({
    classification: AUTH_CALLBACK_CLASSIFICATIONS.PASSWORD_RECOVERY
  });
  assert.deepEqual(result, { handled: true, success: true });
  assert.equal(fixture.controller.getMode(), AUTH_DIALOG_MODES.RECOVERY_UPDATE);
  assert.equal(fixture.controller.isRecoveryBlocking(), true);
  assert.equal(fixture.overlay.hidden, false);
  assert.equal(fixture.emailRow.hidden, true);
  assert.equal(fixture.passwordRow.hidden, false);
  assert.equal(fixture.confirmRow.hidden, false);
  assert.equal(fixture.background.hasAttribute("inert"), true);
});

test("recovery password mismatch stays local and successful update signs out before login", async () => {
  const fixture = createFixture(recoveryState());
  fixture.controller.handlePasswordRecoveryCallback({
    classification: AUTH_CALLBACK_CLASSIFICATIONS.PASSWORD_RECOVERY
  });
  fixture.password.value = "new-secret";
  fixture.confirmPassword.value = "different";
  await fixture.form.dispatch("submit", { preventDefault() {} });
  assert.equal(fixture.service.calls.updateRecoveryPassword, 0);
  assert.equal(fixture.service.calls.signOut, 0);

  fixture.password.value = "new-secret";
  fixture.confirmPassword.value = "new-secret";
  await fixture.form.dispatch("submit", { preventDefault() {} });
  assert.equal(fixture.service.calls.updateRecoveryPassword, 1);
  assert.equal(fixture.service.calls.lastPassword, "new-secret");
  assert.equal(fixture.service.calls.signOut, 1);
  assert.equal(fixture.controller.getMode(), AUTH_DIALOG_MODES.SIGN_IN);
  assert.equal(fixture.service.getState().status, AUTH_STATUSES.GUEST);
  assert.equal(fixture.email.value, "recover@example.com");
  assert.equal(fixture.password.value, "");
  assert.equal(fixture.confirmPassword.value, "");
  assert.equal(fixture.controller.isOpen(), true);
  assert.match(fixture.feedback.textContent, /使用新密码重新登录/);
});

test("password-updated signout failure remains blocking and retry does not update twice", async () => {
  const fixture = createFixture(recoveryState(), { signOutFailures: 1 });
  fixture.controller.handlePasswordRecoveryCallback({
    classification: AUTH_CALLBACK_CLASSIFICATIONS.PASSWORD_RECOVERY
  });
  fixture.password.value = "new-secret";
  fixture.confirmPassword.value = "new-secret";
  await fixture.form.dispatch("submit", { preventDefault() {} });
  assert.equal(fixture.service.calls.updateRecoveryPassword, 1);
  assert.equal(fixture.service.calls.signOut, 1);
  assert.equal(fixture.controller.isRecoveryBlocking(), true);
  assert.equal(fixture.passwordRow.hidden, true);
  assert.match(fixture.feedback.textContent, /密码已更新.*安全退出/);

  await fixture.form.dispatch("submit", { preventDefault() {} });
  assert.equal(fixture.service.calls.updateRecoveryPassword, 1);
  assert.equal(fixture.service.calls.signOut, 2);
  assert.equal(fixture.controller.getMode(), AUTH_DIALOG_MODES.SIGN_IN);
});

test("recovery close and Escape sign out first and remain blocking when signout fails", async () => {
  const fixture = createFixture(recoveryState(), { signOutFailures: 1 });
  fixture.controller.handlePasswordRecoveryCallback({
    classification: AUTH_CALLBACK_CLASSIFICATIONS.PASSWORD_RECOVERY
  });
  await fixture.close.click();
  assert.equal(fixture.controller.isOpen(), true);
  assert.equal(fixture.controller.isRecoveryBlocking(), true);
  assert.equal(fixture.service.calls.signOut, 1);
  assert.match(fixture.feedback.textContent, /无法取消密码恢复/);

  await fixture.documentRef.dispatch("keydown", { key: "Escape", preventDefault() {} });
  await Promise.resolve();
  assert.equal(fixture.service.calls.signOut, 2);
  assertClosed(fixture);
});

test("recovery authorization does not transfer to another authenticated user", async () => {
  const fixture = createFixture(recoveryState());
  fixture.controller.handlePasswordRecoveryCallback({
    classification: AUTH_CALLBACK_CLASSIFICATIONS.PASSWORD_RECOVERY
  });
  fixture.service.setState({
    ...authenticatedState("other@example.com"),
    user: { id: "other-user", email: "other@example.com" }
  });
  fixture.password.value = "new-secret";
  fixture.confirmPassword.value = "new-secret";
  await fixture.form.dispatch("submit", { preventDefault() {} });
  assert.equal(fixture.service.calls.updateRecoveryPassword, 0);
  assert.equal(fixture.service.calls.signOut, 0);
  assert.equal(fixture.controller.getView(), AUTH_DIALOG_VIEWS.RECOVERY_FAILURE);
});

test("confirmation resend prefills pending email, uses email only, and returns generic success", async () => {
  const fixture = createFixture(guestState(), { pendingEmail: "pending@example.com" });
  fixture.controller.open();
  fixture.controller.setMode(AUTH_DIALOG_MODES.SIGN_UP);
  await fixture.resendConfirmation.click();
  assert.equal(fixture.controller.getMode(), AUTH_DIALOG_MODES.RESEND_CONFIRMATION);
  assert.equal(fixture.email.value, "pending@example.com");
  assert.equal(fixture.formSecondary.textContent, "返回注册");
  fixture.email.value = "edited@example.com";
  fixture.password.value = "must-not-be-used";
  await fixture.form.dispatch("submit", { preventDefault() {} });
  assert.deepEqual(fixture.service.calls.lastResend, {
    email: "edited@example.com",
    redirectTo: "http://localhost:8000/?auth=confirmed"
  });
  assert.equal(JSON.stringify(fixture.service.calls.lastResend).includes("must-not-be-used"), false);
  assert.match(fixture.feedback.textContent, /如果该邮箱仍需确认/);
  await fixture.formSecondary.click();
  assert.equal(fixture.controller.getMode(), AUTH_DIALOG_MODES.SIGN_UP);

  fixture.controller.setMode(AUTH_DIALOG_MODES.SIGN_IN);
  fixture.controller.setMode(AUTH_DIALOG_MODES.SIGN_UP);
  fixture.pendingResend.click();
  assert.equal(fixture.email.value, "pending@example.com");
});

test("confirmation resend shows stable rate-limit and service errors", async () => {
  const limited = createFixture(guestState(), {
    resendResult: { ok: false, code: "rate-limited" }
  });
  limited.controller.setMode(AUTH_DIALOG_MODES.RESEND_CONFIRMATION);
  limited.email.value = "pending@example.com";
  await limited.form.dispatch("submit", { preventDefault() {} });
  assert.match(limited.feedback.textContent, /操作过于频繁/);

  const unavailable = createFixture(guestState(), {
    resendResult: { ok: false, code: "confirmation-resend-failed", raw: "private" }
  });
  unavailable.controller.setMode(AUTH_DIALOG_MODES.RESEND_CONFIRMATION);
  unavailable.email.value = "pending@example.com";
  await unavailable.form.dispatch("submit", { preventDefault() {} });
  assert.match(unavailable.feedback.textContent, /暂时无法发送/);
  assert.equal(unavailable.feedback.textContent.includes("private"), false);
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
    emailRow: new FakeElement("div", documentRef),
    email: new FakeElement("input", documentRef),
    passwordRow: new FakeElement("div", documentRef),
    passwordLabel: new FakeElement("label", documentRef),
    password: new FakeElement("input", documentRef),
    confirmRow: new FakeElement("div", documentRef),
    confirmPassword: new FakeElement("input", documentRef),
    submit: new FakeElement("button", documentRef),
    formSecondary: new FakeElement("button", documentRef),
    forgotPassword: new FakeElement("button", documentRef),
    resendConfirmation: new FakeElement("button", documentRef),
    modeToggle: new FakeElement("button", documentRef),
    accountPanel: new FakeElement("section", documentRef),
    accountEmail: new FakeElement("strong", documentRef),
    signOut: new FakeElement("button", documentRef),
    pendingPanel: new FakeElement("section", documentRef),
    pendingEmail: new FakeElement("strong", documentRef),
    pendingResend: new FakeElement("button", documentRef),
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
    onConfirmationSignOutResolved: options.onConfirmationSignOutResolved,
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
  const calls = {
    signIn: 0,
    signUp: 0,
    signOut: 0,
    requestPasswordRecovery: 0,
    resendSignupConfirmation: 0,
    updateRecoveryPassword: 0,
    lastSignUp: null,
    lastRecoveryRequest: null,
    lastResend: null,
    lastPassword: null
  };
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
      if (options.signOutFailures > 0 && calls.signOut <= options.signOutFailures) {
        return { ok: false, code: "sign-out-failed" };
      }
      publish(guestState());
      return { ok: true, state };
    },
    async requestPasswordRecovery(email, redirectTo) {
      calls.requestPasswordRecovery += 1;
      calls.lastRecoveryRequest = { email, redirectTo };
      return options.recoveryRequestResult ?? { ok: true, status: "recovery-requested" };
    },
    async resendSignupConfirmation(email, redirectTo) {
      calls.resendSignupConfirmation += 1;
      calls.lastResend = { email, redirectTo };
      return options.resendResult ?? { ok: true, status: "confirmation-resent" };
    },
    async updateRecoveryPassword(password) {
      calls.updateRecoveryPassword += 1;
      calls.lastPassword = password;
      return options.passwordUpdateResult ?? { ok: true, status: "password-updated" };
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

function recoveryState(email = "recover@example.com") {
  return {
    ...authenticatedState(email),
    authEvent: "PASSWORD_RECOVERY",
    sessionKind: AUTH_SESSION_KINDS.PASSWORD_RECOVERY
  };
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
  setAttribute(name, value) {
    if (name === "aria-hidden" && value === "true") {
      this.activeElementWhenAriaHidden = this.documentRef.activeElement;
    }
    this.attributes.set(name, value);
  }
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
