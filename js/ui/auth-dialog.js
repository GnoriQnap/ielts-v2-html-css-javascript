import {
  createEmailConfirmationRedirectUrl,
  createPendingSignupEmailStore
} from "../core/auth-confirmation.js?v=10.2a";
import {
  AUTH_STATUSES,
  validateAuthCredentials
} from "../core/auth-service.js?v=10.2a";

export const AUTH_DIALOG_MODES = Object.freeze({
  SIGN_IN: "sign-in",
  SIGN_UP: "sign-up"
});

export const AUTH_DIALOG_VIEWS = Object.freeze({
  AUTH: "auth",
  CONFIRMATION_PENDING: "confirmation-pending",
  CONFIRMATION_SUCCESS: "confirmation-success",
  CONFIRMATION_FAILURE: "confirmation-failure"
});

export function createAuthDialogController({
  service,
  elements,
  body,
  backgroundElements = [],
  documentRef = globalThis.document,
  locationRef = globalThis.location,
  pendingEmailStore = createPendingSignupEmailStore(),
  schedule = globalThis.setTimeout?.bind(globalThis),
  cancelSchedule = globalThis.clearTimeout?.bind(globalThis)
}) {
  requireValue(service, "Auth service");
  requireValue(elements, "Auth dialog elements");
  requireValue(body, "页面 body");

  let mode = AUTH_DIALOG_MODES.SIGN_IN;
  let view = AUTH_DIALOG_VIEWS.AUTH;
  let isOpen = false;
  let isSubmitting = false;
  let initialized = false;
  let returnFocusElement = null;
  let unsubscribeState = null;
  let confirmationTimer = null;
  let pendingEmail = pendingEmailStore.load();
  const addedInertElements = new Set();

  function initialize() {
    if (initialized) return;
    initialized = true;
    elements.trigger.addEventListener("click", open);
    elements.close.addEventListener("click", close);
    elements.modeToggle.addEventListener("click", toggleMode);
    elements.form.addEventListener("submit", handleSubmit);
    elements.signOut.addEventListener("click", handleSignOut);
    elements.pendingReturnLogin.addEventListener("click", returnToLogin);
    elements.confirmationReturnLogin.addEventListener("click", returnToLogin);
    elements.confirmationReturnSignup.addEventListener("click", returnToSignup);
    documentRef?.addEventListener?.("keydown", handleKeydown);
    unsubscribeState = service.subscribe(renderAuthState);
  }

  function open() {
    returnFocusElement = documentRef?.activeElement ?? elements.trigger;
    elements.overlay.hidden = false;
    elements.overlay.setAttribute("aria-hidden", "false");
    elements.overlay.classList.add("is-open");
    body.classList.add("account-dialog-open");
    setBackgroundInert(true);
    isOpen = true;
    renderAuthState(service.getState());
    focusInitialControl();
  }

  function close() {
    const focusTarget = returnFocusElement;
    cancelConfirmationTimer();
    elements.overlay.hidden = true;
    elements.overlay.setAttribute("aria-hidden", "true");
    elements.overlay.classList.remove("is-open");
    body.classList.remove("account-dialog-open");
    setBackgroundInert(false);
    isOpen = false;
    isSubmitting = false;
    returnFocusElement = null;
    view = AUTH_DIALOG_VIEWS.AUTH;
    setMode(AUTH_DIALOG_MODES.SIGN_IN);
    if (focusTarget?.isConnected) {
      try { focusTarget.focus(); } catch { /* Scroll-lock cleanup must still succeed. */ }
    }
  }

  function destroy() {
    close();
    unsubscribeState?.();
    unsubscribeState = null;
    documentRef?.removeEventListener?.("keydown", handleKeydown);
  }

  function setMode(nextMode) {
    view = AUTH_DIALOG_VIEWS.AUTH;
    mode = nextMode === AUTH_DIALOG_MODES.SIGN_UP
      ? AUTH_DIALOG_MODES.SIGN_UP
      : AUTH_DIALOG_MODES.SIGN_IN;
    elements.confirmRow.hidden = mode !== AUTH_DIALOG_MODES.SIGN_UP;
    elements.confirmPassword.required = mode === AUTH_DIALOG_MODES.SIGN_UP;
    elements.password.setAttribute(
      "autocomplete",
      mode === AUTH_DIALOG_MODES.SIGN_UP ? "new-password" : "current-password"
    );
    elements.submit.textContent = mode === AUTH_DIALOG_MODES.SIGN_UP ? "创建账号" : "登录";
    elements.modeToggle.textContent = mode === AUTH_DIALOG_MODES.SIGN_UP
      ? "已有账号？登录"
      : "还没有账号？注册";
    elements.feedback.textContent = "";
    clearPasswords();
    renderAuthState(service.getState());
    if (isOpen) elements.email.focus();
  }

  function toggleMode() {
    setMode(mode === AUTH_DIALOG_MODES.SIGN_IN
      ? AUTH_DIALOG_MODES.SIGN_UP
      : AUTH_DIALOG_MODES.SIGN_IN);
  }

  async function handleSubmit(event) {
    event?.preventDefault?.();
    if (isSubmitting) return;

    const credentials = validateAuthCredentials({
      email: elements.email.value,
      password: elements.password.value,
      confirmPassword: elements.confirmPassword.value,
      mode
    });
    if (!credentials.valid) {
      elements.feedback.textContent = credentials.message;
      focusField(credentials.field);
      return;
    }

    isSubmitting = true;
    setFormDisabled(true);
    elements.feedback.textContent = "";
    let result;
    if (mode === AUTH_DIALOG_MODES.SIGN_UP) {
      try {
        result = await service.signUp({
          ...credentials,
          emailRedirectTo: createEmailConfirmationRedirectUrl(locationRef)
        });
      } catch {
        result = { ok: false, code: "service-unavailable" };
      }
    } else {
      result = await service.signIn(credentials);
    }
    isSubmitting = false;
    setFormDisabled(false);
    clearPasswords();

    if (!result.ok) {
      elements.feedback.textContent = authErrorMessage(result.code);
      return;
    }
    if (result.status === "confirmation-required") {
      pendingEmail = result.email || credentials.email;
      pendingEmailStore.save(pendingEmail);
      view = AUTH_DIALOG_VIEWS.CONFIRMATION_PENDING;
      renderAuthState(result.state);
      elements.pendingReturnLogin.focus();
      return;
    }
    renderAuthState(result.state);
  }

  async function handleEmailConfirmationCallback(callback) {
    if (!callback?.isCallback) return { handled: false };
    cancelConfirmationTimer();
    pendingEmail = pendingEmailStore.load();

    const currentState = service.getState();
    const confirmedEmail = currentState.user?.email ?? pendingEmail;
    const emailMismatch = pendingEmail && confirmedEmail &&
      pendingEmail.toLocaleLowerCase() !== confirmedEmail.toLocaleLowerCase();
    if (
      callback.hasError ||
      !callback.hasConfirmationEvidence ||
      currentState.status !== AUTH_STATUSES.AUTHENTICATED ||
      emailMismatch
    ) {
      showConfirmationFailure();
      return { handled: true, success: false };
    }

    const signOutResult = await service.signOut();
    if (!signOutResult.ok) {
      showConfirmationFailure("邮箱已确认，但暂时无法进入重新登录流程，请刷新后重试。");
      return { handled: true, success: false };
    }

    pendingEmailStore.clear();
    showConfirmationSuccess(confirmedEmail);
    return { handled: true, success: true };
  }

  function showConfirmationSuccess(email) {
    pendingEmail = email || pendingEmail;
    view = AUTH_DIALOG_VIEWS.CONFIRMATION_SUCCESS;
    elements.confirmationMessage.textContent = "账号已创建，现在可以登录。";
    open();
    if (typeof schedule === "function") {
      confirmationTimer = schedule(() => {
        confirmationTimer = null;
        returnToLogin({ keepSuccessMessage: true });
      }, 1400);
    }
  }

  function showConfirmationFailure(message = "确认链接可能已失效，请重新注册或重新发送确认邮件。") {
    view = AUTH_DIALOG_VIEWS.CONFIRMATION_FAILURE;
    elements.confirmationMessage.textContent = message;
    open();
  }

  async function handleSignOut() {
    if (isSubmitting) return;
    isSubmitting = true;
    elements.signOut.disabled = true;
    elements.feedback.textContent = "";
    const result = await service.signOut();
    isSubmitting = false;
    elements.signOut.disabled = false;
    if (!result.ok) {
      elements.feedback.textContent = authErrorMessage(result.code);
      return;
    }
    setMode(AUTH_DIALOG_MODES.SIGN_IN);
    close();
  }

  function returnToLogin(options = {}) {
    cancelConfirmationTimer();
    const email = pendingEmail || pendingEmailStore.load();
    setMode(AUTH_DIALOG_MODES.SIGN_IN);
    elements.email.value = email;
    clearPasswords();
    if (options.keepSuccessMessage) {
      elements.feedback.textContent = "邮箱确认成功。账号已创建，现在可以登录。";
    }
    if (isOpen) elements.password.focus();
  }

  function returnToSignup() {
    cancelConfirmationTimer();
    const email = pendingEmail || pendingEmailStore.load();
    setMode(AUTH_DIALOG_MODES.SIGN_UP);
    elements.email.value = email;
  }

  function renderAuthState(state) {
    const isAuthenticated = state.status === AUTH_STATUSES.AUTHENTICATED;
    const isUnavailable = state.status === AUTH_STATUSES.UNAVAILABLE;
    const isAuthView = view === AUTH_DIALOG_VIEWS.AUTH;
    elements.trigger.textContent = isAuthenticated ? "账户" : "登录";
    elements.trigger.dataset.authStatus = state.status;
    elements.form.hidden = !isAuthView || isAuthenticated;
    elements.accountPanel.hidden = !isAuthView || !isAuthenticated;
    elements.pendingPanel.hidden = view !== AUTH_DIALOG_VIEWS.CONFIRMATION_PENDING;
    elements.confirmationPanel.hidden = ![
      AUTH_DIALOG_VIEWS.CONFIRMATION_SUCCESS,
      AUTH_DIALOG_VIEWS.CONFIRMATION_FAILURE
    ].includes(view);
    elements.modeToggle.hidden = !isAuthView || isAuthenticated;
    elements.accountEmail.textContent = isAuthenticated ? state.user?.email ?? "" : "";
    elements.pendingEmail.textContent = view === AUTH_DIALOG_VIEWS.CONFIRMATION_PENDING ? pendingEmail : "";
    elements.confirmationReturnLogin.hidden = view === AUTH_DIALOG_VIEWS.CONFIRMATION_SUCCESS;
    elements.confirmationReturnSignup.hidden = view === AUTH_DIALOG_VIEWS.CONFIRMATION_SUCCESS;
    elements.title.textContent = getDialogTitle(isAuthenticated);
    setFormDisabled(isUnavailable || isSubmitting);
    if (isAuthView && isUnavailable) {
      elements.feedback.textContent = "暂时无法连接账号服务，请稍后重试。";
    } else if (isAuthView && state.status !== AUTH_STATUSES.LOADING && !isSubmitting) {
      elements.feedback.textContent = "";
    }
  }

  function getDialogTitle(isAuthenticated) {
    if (view === AUTH_DIALOG_VIEWS.CONFIRMATION_PENDING) return "请确认邮箱";
    if (view === AUTH_DIALOG_VIEWS.CONFIRMATION_SUCCESS) return "邮箱确认成功";
    if (view === AUTH_DIALOG_VIEWS.CONFIRMATION_FAILURE) return "邮箱确认失败";
    if (isAuthenticated) return "账户";
    return mode === AUTH_DIALOG_MODES.SIGN_UP ? "创建账号" : "登录";
  }

  function setFormDisabled(disabled) {
    elements.email.disabled = disabled;
    elements.password.disabled = disabled;
    elements.confirmPassword.disabled = disabled;
    elements.submit.disabled = disabled;
  }

  function focusInitialControl() {
    if (view === AUTH_DIALOG_VIEWS.CONFIRMATION_PENDING) return elements.pendingReturnLogin.focus();
    if (view === AUTH_DIALOG_VIEWS.CONFIRMATION_FAILURE) return elements.confirmationReturnLogin.focus();
    if (view === AUTH_DIALOG_VIEWS.CONFIRMATION_SUCCESS) return elements.close.focus();
    const state = service.getState();
    if (state.status === AUTH_STATUSES.AUTHENTICATED) elements.signOut.focus();
    else if (state.status !== AUTH_STATUSES.UNAVAILABLE) elements.email.focus();
    else elements.close.focus();
  }

  function focusField(field) {
    ({
      email: elements.email,
      password: elements.password,
      "confirm-password": elements.confirmPassword
    })[field]?.focus();
  }

  function clearPasswords() {
    elements.password.value = "";
    elements.confirmPassword.value = "";
  }

  function cancelConfirmationTimer() {
    if (confirmationTimer !== null && typeof cancelSchedule === "function") {
      cancelSchedule(confirmationTimer);
    }
    confirmationTimer = null;
  }

  function setBackgroundInert(inert) {
    if (inert) {
      for (const element of backgroundElements) {
        if (element && !element.hasAttribute?.("inert")) {
          element.setAttribute?.("inert", "");
          addedInertElements.add(element);
        }
      }
      return;
    }
    for (const element of addedInertElements) element.removeAttribute?.("inert");
    addedInertElements.clear();
  }

  function handleKeydown(event) {
    if (isOpen && event.key === "Escape") {
      event.preventDefault?.();
      close();
    }
  }

  function authErrorMessage(code) {
    return {
      "invalid-credentials": "邮箱或密码错误。",
      "sign-up-failed": "创建账号失败，请检查邮箱和密码后重试。",
      "sign-out-failed": "退出登录失败，请稍后重试。",
      "service-unavailable": "暂时无法连接账号服务，请稍后重试。"
    }[code] ?? "暂时无法连接账号服务，请稍后重试。";
  }

  initialize();

  return Object.freeze({
    close,
    destroy,
    getMode: () => mode,
    getView: () => view,
    handleEmailConfirmationCallback,
    isOpen: () => isOpen,
    open,
    setMode
  });
}

function requireValue(value, label) {
  if (!value) throw new TypeError(`${label} 不存在。`);
}
