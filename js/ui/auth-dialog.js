import {
  AUTH_CALLBACK_CLASSIFICATIONS,
  createEmailConfirmationRedirectUrl,
  createPasswordRecoveryRedirectUrl,
  createPendingSignupEmailStore
} from "../core/auth-confirmation.js?v=10.9d3";
import {
  AUTH_SESSION_KINDS,
  AUTH_STATUSES,
  validateAuthCredentials
} from "../core/auth-service.js?v=10.9d3";

export const AUTH_DIALOG_MODES = Object.freeze({
  SIGN_IN: "sign-in",
  SIGN_UP: "sign-up",
  RECOVERY_REQUEST: "recovery-request",
  RECOVERY_UPDATE: "recovery-update",
  RESEND_CONFIRMATION: "resend-confirmation"
});

export const AUTH_DIALOG_VIEWS = Object.freeze({
  AUTH: "auth",
  CONFIRMATION_PENDING: "confirmation-pending",
  CONFIRMATION_SUCCESS: "confirmation-success",
  CONFIRMATION_FAILURE: "confirmation-failure",
  RECOVERY_FAILURE: "recovery-failure"
});

export function createAuthDialogController({
  service,
  elements,
  body,
  backgroundElements = [],
  documentRef = globalThis.document,
  locationRef = globalThis.location,
  pendingEmailStore = createPendingSignupEmailStore(),
  onConfirmationSignOutResolved = () => {},
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
  let confirmationSignOutPending = false;
  let confirmationEmail = "";
  let confirmationGateOwned = false;
  let confirmationResolutionKind = "";
  let confirmationFailureDestination = "";
  let recoveryAuthorized = false;
  let recoveryPasswordUpdated = false;
  let recoveryEmail = "";
  let recoveryUserId = "";
  let resendReturnMode = AUTH_DIALOG_MODES.SIGN_IN;
  let operationGeneration = 0;
  const addedInertElements = new Set();

  function initialize() {
    if (initialized) return;
    initialized = true;
    elements.trigger.addEventListener("click", open);
    elements.close.addEventListener("click", requestClose);
    elements.modeToggle.addEventListener("click", toggleMode);
    elements.forgotPassword.addEventListener("click", () => setMode(AUTH_DIALOG_MODES.RECOVERY_REQUEST));
    elements.resendConfirmation.addEventListener("click", enterConfirmationResend);
    elements.formSecondary.addEventListener("click", handleFormSecondary);
    elements.form.addEventListener("submit", handleSubmit);
    elements.signOut.addEventListener("click", handleSignOut);
    elements.pendingResend.addEventListener("click", enterConfirmationResend);
    elements.pendingReturnLogin.addEventListener("click", returnToLogin);
    elements.confirmationReturnLogin.addEventListener("click", handleResultPrimary);
    elements.confirmationReturnSignup.addEventListener("click", handleResultSecondary);
    documentRef?.addEventListener?.("keydown", handleKeydown);
    unsubscribeState = service.subscribe(renderAuthState);
  }

  function open() {
    if (!isOpen) returnFocusElement = documentRef?.activeElement ?? elements.trigger;
    elements.overlay.hidden = false;
    elements.overlay.setAttribute("aria-hidden", "false");
    elements.overlay.classList.add("is-open");
    body.classList.add("account-dialog-open");
    setBackgroundInert(true);
    isOpen = true;
    renderAuthState(service.getState());
    focusInitialControl();
  }

  function requestClose() {
    if (confirmationGateOwned && confirmationResolutionKind === "failed") {
      if (confirmationSignOutPending) return undefined;
      return finishConfirmationSafeExit("close");
    }
    if (confirmationSignOutPending) return undefined;
    if (mode === AUTH_DIALOG_MODES.RECOVERY_UPDATE && recoveryAuthorized) {
      return cancelRecovery();
    }
    performClose();
    return undefined;
  }

  function performClose() {
    const focusTarget = returnFocusElement;
    const shouldRestoreFocus = isOpen && focusTarget?.isConnected;
    operationGeneration += 1;
    cancelConfirmationTimer();
    setBackgroundInert(false);
    if (shouldRestoreFocus) {
      try { focusTarget.focus(); } catch { /* Dialog cleanup must still succeed. */ }
    }
    elements.overlay.hidden = true;
    elements.overlay.setAttribute("aria-hidden", "true");
    elements.overlay.classList.remove("is-open");
    body.classList.remove("account-dialog-open");
    isOpen = false;
    isSubmitting = false;
    returnFocusElement = null;
    view = AUTH_DIALOG_VIEWS.AUTH;
    confirmationSignOutPending = false;
    confirmationEmail = "";
    confirmationGateOwned = false;
    confirmationResolutionKind = "";
    confirmationFailureDestination = "";
    recoveryAuthorized = false;
    recoveryPasswordUpdated = false;
    recoveryUserId = "";
    setMode(AUTH_DIALOG_MODES.SIGN_IN, { preserveGeneration: true });
  }

  function destroy() {
    performClose();
    unsubscribeState?.();
    unsubscribeState = null;
    documentRef?.removeEventListener?.("keydown", handleKeydown);
  }

  function setMode(nextMode, { preserveGeneration = false } = {}) {
    if (!preserveGeneration) operationGeneration += 1;
    view = AUTH_DIALOG_VIEWS.AUTH;
    mode = Object.values(AUTH_DIALOG_MODES).includes(nextMode)
      ? nextMode
      : AUTH_DIALOG_MODES.SIGN_IN;
    if (mode !== AUTH_DIALOG_MODES.RECOVERY_UPDATE) {
      recoveryAuthorized = false;
      recoveryPasswordUpdated = false;
      recoveryUserId = "";
    }
    elements.feedback.textContent = "";
    clearPasswords();
    renderAuthState(service.getState());
    if (isOpen) focusInitialControl();
  }

  function toggleMode() {
    setMode(mode === AUTH_DIALOG_MODES.SIGN_IN
      ? AUTH_DIALOG_MODES.SIGN_UP
      : AUTH_DIALOG_MODES.SIGN_IN);
  }

  function handleFormSecondary() {
    if (mode === AUTH_DIALOG_MODES.RECOVERY_UPDATE) {
      void cancelRecovery();
      return;
    }
    if (mode === AUTH_DIALOG_MODES.RESEND_CONFIRMATION && resendReturnMode === AUTH_DIALOG_MODES.SIGN_UP) {
      returnToSignup();
      return;
    }
    returnToLogin();
  }

  function enterConfirmationResend() {
    resendReturnMode = mode === AUTH_DIALOG_MODES.SIGN_UP ||
      view === AUTH_DIALOG_VIEWS.CONFIRMATION_PENDING
      ? AUTH_DIALOG_MODES.SIGN_UP
      : AUTH_DIALOG_MODES.SIGN_IN;
    setMode(AUTH_DIALOG_MODES.RESEND_CONFIRMATION);
    elements.email.value = pendingEmail || pendingEmailStore.load();
  }

  async function handleSubmit(event) {
    event?.preventDefault?.();
    if (isSubmitting) return;
    if (mode === AUTH_DIALOG_MODES.RECOVERY_REQUEST) return submitRecoveryRequest();
    if (mode === AUTH_DIALOG_MODES.RESEND_CONFIRMATION) return submitConfirmationResend();
    if (mode === AUTH_DIALOG_MODES.RECOVERY_UPDATE) return submitRecoveryUpdate();

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

    const generation = beginSubmission();
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
    if (!finishSubmission(generation)) return;
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

  async function submitRecoveryRequest() {
    const email = validateEmail(elements.email.value);
    if (!email.valid) {
      elements.feedback.textContent = email.message;
      elements.email.focus();
      return;
    }
    const generation = beginSubmission();
    let result;
    try {
      result = await service.requestPasswordRecovery(
        email.value,
        createPasswordRecoveryRedirectUrl(locationRef)
      );
    } catch {
      result = { ok: false, code: "service-unavailable" };
    }
    if (!finishSubmission(generation)) return;
    elements.feedback.textContent = result.ok
      ? "如果该邮箱可用于找回密码，我们已发送操作邮件，请检查收件箱。"
      : requestErrorMessage(result.code);
  }

  async function submitConfirmationResend() {
    const email = validateEmail(elements.email.value);
    if (!email.valid) {
      elements.feedback.textContent = email.message;
      elements.email.focus();
      return;
    }
    const generation = beginSubmission();
    let result;
    try {
      result = await service.resendSignupConfirmation(
        email.value,
        createEmailConfirmationRedirectUrl(locationRef)
      );
    } catch {
      result = { ok: false, code: "service-unavailable" };
    }
    if (!finishSubmission(generation)) return;
    elements.feedback.textContent = result.ok
      ? "如果该邮箱仍需确认，我们已重新发送确认邮件，请检查收件箱。"
      : requestErrorMessage(result.code);
  }

  async function submitRecoveryUpdate() {
    if (!hasActiveRecoveryOwnership(service.getState(), recoveryUserId) || !recoveryAuthorized) {
      showRecoveryFailure();
      return;
    }
    if (recoveryPasswordUpdated) return finishRecoverySignOut({ closeAfter: false });
    const password = elements.password.value;
    if (!password) {
      elements.feedback.textContent = "请输入新密码。";
      elements.password.focus();
      return;
    }
    if (password !== elements.confirmPassword.value) {
      elements.feedback.textContent = "两次输入的密码不一致。";
      elements.confirmPassword.focus();
      return;
    }

    const generation = beginSubmission();
    let result;
    try {
      result = await service.updateRecoveryPassword(password);
    } catch {
      result = { ok: false, code: "service-unavailable" };
    }
    clearPasswords();
    if (!finishSubmission(generation)) return;
    if (!hasActiveRecoveryOwnership(service.getState(), recoveryUserId)) {
      showRecoveryFailure("密码恢复会话已经变更，请重新申请恢复邮件。");
      return;
    }
    if (!result.ok) {
      elements.feedback.textContent = passwordUpdateErrorMessage(result.code);
      return;
    }
    recoveryPasswordUpdated = true;
    renderAuthState(service.getState());
    await finishRecoverySignOut({ closeAfter: false });
  }

  async function cancelRecovery() {
    if (isSubmitting) return;
    return finishRecoverySignOut({ closeAfter: true });
  }

  async function finishRecoverySignOut({ closeAfter }) {
    if (isSubmitting) return;
    if (!hasActiveRecoveryOwnership(service.getState(), recoveryUserId)) {
      showRecoveryFailure("密码恢复会话已经结束，请重新登录或申请新的恢复邮件。");
      return;
    }
    const knownEmail = recoveryEmail || service.getState().user?.email || "";
    const generation = beginSubmission();
    let result;
    try {
      result = await service.signOut();
    } catch {
      result = { ok: false, code: "service-unavailable" };
    }
    if (!finishSubmission(generation)) return;
    if (!result.ok) {
      recoveryAuthorized = true;
      renderAuthState(service.getState());
      elements.feedback.textContent = recoveryPasswordUpdated
        ? "密码已更新，但暂时无法安全退出账号。请重试退出登录。"
        : "暂时无法取消密码恢复，请重试退出登录。";
      return;
    }

    recoveryAuthorized = false;
    recoveryPasswordUpdated = false;
    recoveryUserId = "";
    setMode(AUTH_DIALOG_MODES.SIGN_IN);
    elements.email.value = knownEmail;
    clearPasswords();
    if (closeAfter) {
      performClose();
      return;
    }
    elements.feedback.textContent = "密码已更新。请使用新密码重新登录。";
    renderAuthState(result.state ?? service.getState());
    elements.password.focus();
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
      confirmationSignOutPending = false;
      confirmationEmail = confirmedEmail || "";
      confirmationGateOwned = Boolean(
        callback.hasConfirmationEvidence && !callback.hasError
      );
      confirmationResolutionKind = confirmationGateOwned ? "failed" : "";
      confirmationFailureDestination = "";
      showConfirmationFailure();
      return { handled: true, success: false };
    }

    const signOutResult = await service.signOut();
    if (!signOutResult.ok) {
      confirmationSignOutPending = true;
      confirmationEmail = confirmedEmail || "";
      confirmationGateOwned = true;
      confirmationResolutionKind = "confirmed";
      confirmationFailureDestination = "";
      showConfirmationFailure("邮箱已确认，但暂时无法安全退出账号。请重试安全退出。");
      return { handled: true, success: false, reason: "sign-out-failed" };
    }

    confirmationSignOutPending = false;
    confirmationEmail = "";
    confirmationGateOwned = false;
    confirmationResolutionKind = "";
    confirmationFailureDestination = "";
    pendingEmailStore.clear();
    showConfirmationSuccess(confirmedEmail);
    return { handled: true, success: true };
  }

  function handlePasswordRecoveryCallback(callback) {
    const state = service.getState();
    if (
      callback?.classification === AUTH_CALLBACK_CLASSIFICATIONS.PASSWORD_RECOVERY &&
      state.status === AUTH_STATUSES.AUTHENTICATED &&
      hasRuntimeRecoveryEvidence(state)
    ) {
      operationGeneration += 1;
      recoveryAuthorized = true;
      recoveryPasswordUpdated = false;
      recoveryEmail = state.user?.email ?? "";
      recoveryUserId = state.user?.id ?? "";
      view = AUTH_DIALOG_VIEWS.AUTH;
      mode = AUTH_DIALOG_MODES.RECOVERY_UPDATE;
      clearPasswords();
      elements.feedback.textContent = "";
      open();
      return { handled: true, success: true };
    }
    showRecoveryFailure();
    return { handled: true, success: false };
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

  function showRecoveryFailure(message = "密码恢复链接可能已失效。请重新申请恢复邮件，或返回登录。") {
    operationGeneration += 1;
    recoveryAuthorized = false;
    recoveryPasswordUpdated = false;
    recoveryUserId = "";
    view = AUTH_DIALOG_VIEWS.RECOVERY_FAILURE;
    elements.confirmationMessage.textContent = message;
    open();
  }

  async function handleSignOut() {
    if (isSubmitting) return;
    const generation = beginSubmission();
    const result = await service.signOut();
    if (!finishSubmission(generation)) return;
    if (!result.ok) {
      elements.feedback.textContent = authErrorMessage(result.code);
      return;
    }
    setMode(AUTH_DIALOG_MODES.SIGN_IN);
    performClose();
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

  async function handleResultPrimary() {
    if (view === AUTH_DIALOG_VIEWS.CONFIRMATION_FAILURE && confirmationGateOwned) {
      if (confirmationResolutionKind === "confirmed") {
        return retryConfirmationSignOut();
      }
      return finishConfirmationSafeExit(
        confirmationFailureDestination || "login"
      );
    }
    if (view !== AUTH_DIALOG_VIEWS.RECOVERY_FAILURE) return returnToLogin();
    if (service.getState().status === AUTH_STATUSES.AUTHENTICATED) {
      const generation = beginSubmission();
      const result = await service.signOut();
      if (!finishSubmission(generation)) return;
      if (!result.ok) {
        elements.feedback.textContent = "暂时无法退出当前账号，请稍后重试。";
        return;
      }
    }
    returnToLogin();
  }

  async function retryConfirmationSignOut() {
    if (isSubmitting || !confirmationSignOutPending) return;
    return finishConfirmationSafeExit("confirmed");
  }

  async function finishConfirmationSafeExit(destination) {
    if (isSubmitting || !confirmationGateOwned) return;
    const requestedDestination = confirmationFailureDestination || destination;
    confirmationFailureDestination = requestedDestination;
    const currentState = service.getState();
    if (currentState.status === AUTH_STATUSES.GUEST) {
      return completeConfirmationSafeExit(currentState, requestedDestination);
    }
    if (currentState.status !== AUTH_STATUSES.AUTHENTICATED) {
      elements.feedback.textContent = "账号状态尚未安全结束，请稍后重试。";
      renderAuthState(currentState);
      return;
    }

    const generation = beginSubmission();
    let result;
    try {
      result = await service.signOut();
    } catch {
      result = { ok: false, code: "service-unavailable" };
    }
    if (!finishSubmission(generation)) return;
    if (!result.ok) {
      confirmationSignOutPending = true;
      elements.feedback.textContent = "暂时仍无法安全退出账号，请稍后重试。";
      renderAuthState(service.getState());
      return;
    }

    const resolvedState = result.state ?? service.getState();
    if (resolvedState.status !== AUTH_STATUSES.GUEST) {
      confirmationSignOutPending = true;
      elements.feedback.textContent = "账号尚未安全退出，请稍后重试。";
      renderAuthState(resolvedState);
      return;
    }
    return completeConfirmationSafeExit(resolvedState, requestedDestination);
  }

  async function completeConfirmationSafeExit(guestState, destination) {
    const resolutionKind = confirmationResolutionKind;
    const confirmedEmail = confirmationEmail;
    await onConfirmationSignOutResolved(guestState);

    confirmationSignOutPending = false;
    confirmationEmail = "";
    confirmationGateOwned = false;
    confirmationResolutionKind = "";
    confirmationFailureDestination = "";

    if (resolutionKind === "confirmed") {
      pendingEmailStore.clear();
      showConfirmationSuccess(confirmedEmail);
      return;
    }
    if (confirmedEmail) pendingEmail = confirmedEmail;
    if (destination === "signup") {
      returnToSignup();
      return;
    }
    if (destination === "close") {
      performClose();
      return;
    }
    returnToLogin();
  }

  function handleResultSecondary() {
    if (confirmationGateOwned) {
      if (confirmationSignOutPending) return;
      return finishConfirmationSafeExit("signup");
    }
    if (view === AUTH_DIALOG_VIEWS.RECOVERY_FAILURE) {
      setMode(AUTH_DIALOG_MODES.RECOVERY_REQUEST);
      return;
    }
    returnToSignup();
  }

  function renderAuthState(state) {
    const isAuthenticated = state.status === AUTH_STATUSES.AUTHENTICATED;
    const isUnavailable = state.status === AUTH_STATUSES.UNAVAILABLE;
    const isAuthView = view === AUTH_DIALOG_VIEWS.AUTH;
    const specialForm = [
      AUTH_DIALOG_MODES.RECOVERY_REQUEST,
      AUTH_DIALOG_MODES.RECOVERY_UPDATE,
      AUTH_DIALOG_MODES.RESEND_CONFIRMATION
    ].includes(mode);
    const showForm = isAuthView && (specialForm || !isAuthenticated);
    elements.trigger.textContent = isAuthenticated ? "账户" : "登录";
    elements.trigger.dataset.authStatus = state.status;
    elements.form.hidden = !showForm;
    elements.accountPanel.hidden = !isAuthView || !isAuthenticated || specialForm;
    elements.pendingPanel.hidden = view !== AUTH_DIALOG_VIEWS.CONFIRMATION_PENDING;
    elements.confirmationPanel.hidden = ![
      AUTH_DIALOG_VIEWS.CONFIRMATION_SUCCESS,
      AUTH_DIALOG_VIEWS.CONFIRMATION_FAILURE,
      AUTH_DIALOG_VIEWS.RECOVERY_FAILURE
    ].includes(view);
    elements.modeToggle.hidden = !isAuthView || isAuthenticated || specialForm;
    elements.accountEmail.textContent = isAuthenticated ? state.user?.email ?? "" : "";
    elements.pendingEmail.textContent = view === AUTH_DIALOG_VIEWS.CONFIRMATION_PENDING ? pendingEmail : "";
    elements.confirmationReturnLogin.hidden = view === AUTH_DIALOG_VIEWS.CONFIRMATION_SUCCESS;
    elements.confirmationReturnSignup.hidden = view === AUTH_DIALOG_VIEWS.CONFIRMATION_SUCCESS ||
      confirmationSignOutPending;
    elements.confirmationReturnLogin.textContent = confirmationSignOutPending
      ? "重试安全退出"
      : confirmationGateOwned && confirmationResolutionKind === "failed"
        ? "安全退出并返回登录"
        : "返回登录";
    elements.confirmationReturnSignup.textContent = view === AUTH_DIALOG_VIEWS.RECOVERY_FAILURE
      ? "重新申请恢复邮件"
      : "返回注册";
    elements.title.textContent = getDialogTitle(isAuthenticated);
    renderModeFields();
    setFormDisabled(isUnavailable || isSubmitting);
    elements.close.disabled = confirmationSignOutPending ||
      (isSubmitting && mode === AUTH_DIALOG_MODES.RECOVERY_UPDATE);
    if (isAuthView && isUnavailable && mode !== AUTH_DIALOG_MODES.RECOVERY_UPDATE) {
      elements.feedback.textContent = "暂时无法连接账号服务，请稍后重试。";
    }
  }

  function renderModeFields() {
    const isSignUp = mode === AUTH_DIALOG_MODES.SIGN_UP;
    const isRecoveryRequest = mode === AUTH_DIALOG_MODES.RECOVERY_REQUEST;
    const isRecoveryUpdate = mode === AUTH_DIALOG_MODES.RECOVERY_UPDATE;
    const isResend = mode === AUTH_DIALOG_MODES.RESEND_CONFIRMATION;
    const showPassword = !isRecoveryRequest && !isResend && !(isRecoveryUpdate && recoveryPasswordUpdated);
    const showConfirm = isSignUp || (isRecoveryUpdate && !recoveryPasswordUpdated);
    elements.emailRow.hidden = isRecoveryUpdate;
    elements.passwordRow.hidden = !showPassword;
    elements.confirmRow.hidden = !showConfirm;
    elements.email.required = !isRecoveryUpdate;
    elements.password.required = showPassword;
    elements.confirmPassword.required = showConfirm;
    elements.passwordLabel.textContent = isRecoveryUpdate ? "新密码" : "密码";
    elements.password.setAttribute(
      "autocomplete",
      isSignUp || isRecoveryUpdate ? "new-password" : "current-password"
    );
    elements.submit.textContent = isSignUp
      ? "创建账号"
      : isRecoveryRequest
        ? "发送密码恢复邮件"
        : isResend
          ? "重新发送确认邮件"
          : isRecoveryUpdate
            ? recoveryPasswordUpdated ? "重试退出登录" : "更新密码"
            : "登录";
    elements.formSecondary.hidden = ![isRecoveryRequest, isRecoveryUpdate, isResend].some(Boolean);
    elements.formSecondary.textContent = isRecoveryUpdate
      ? "取消恢复"
      : isResend && resendReturnMode === AUTH_DIALOG_MODES.SIGN_UP
        ? "返回注册"
        : "返回登录";
    elements.forgotPassword.hidden = mode !== AUTH_DIALOG_MODES.SIGN_IN;
    elements.resendConfirmation.hidden = mode !== AUTH_DIALOG_MODES.SIGN_UP;
    elements.modeToggle.textContent = isSignUp ? "已有账号？登录" : "还没有账号？注册";
  }

  function getDialogTitle(isAuthenticated) {
    if (view === AUTH_DIALOG_VIEWS.CONFIRMATION_PENDING) return "请确认邮箱";
    if (view === AUTH_DIALOG_VIEWS.CONFIRMATION_SUCCESS) return "邮箱确认成功";
    if (view === AUTH_DIALOG_VIEWS.CONFIRMATION_FAILURE) return "邮箱确认失败";
    if (view === AUTH_DIALOG_VIEWS.RECOVERY_FAILURE) return "密码恢复失败";
    if (mode === AUTH_DIALOG_MODES.RECOVERY_REQUEST) return "找回密码";
    if (mode === AUTH_DIALOG_MODES.RECOVERY_UPDATE) return "设置新密码";
    if (mode === AUTH_DIALOG_MODES.RESEND_CONFIRMATION) return "重新发送确认邮件";
    if (isAuthenticated) return "账户";
    return mode === AUTH_DIALOG_MODES.SIGN_UP ? "创建账号" : "登录";
  }

  function beginSubmission() {
    isSubmitting = true;
    const generation = ++operationGeneration;
    setFormDisabled(true);
    elements.close.disabled = confirmationSignOutPending || confirmationGateOwned ||
      mode === AUTH_DIALOG_MODES.RECOVERY_UPDATE;
    elements.feedback.textContent = "";
    return generation;
  }

  function finishSubmission(generation) {
    if (generation !== operationGeneration) return false;
    isSubmitting = false;
    setFormDisabled(false);
    elements.close.disabled = confirmationSignOutPending;
    return true;
  }

  function setFormDisabled(disabled) {
    elements.email.disabled = disabled;
    elements.password.disabled = disabled;
    elements.confirmPassword.disabled = disabled;
    elements.submit.disabled = disabled;
    elements.formSecondary.disabled = disabled;
    elements.forgotPassword.disabled = disabled;
    elements.resendConfirmation.disabled = disabled;
  }

  function focusInitialControl() {
    if (view === AUTH_DIALOG_VIEWS.CONFIRMATION_PENDING) return elements.pendingReturnLogin.focus();
    if ([AUTH_DIALOG_VIEWS.CONFIRMATION_FAILURE, AUTH_DIALOG_VIEWS.RECOVERY_FAILURE].includes(view)) {
      return elements.confirmationReturnLogin.focus();
    }
    if (view === AUTH_DIALOG_VIEWS.CONFIRMATION_SUCCESS) return elements.close.focus();
    if (mode === AUTH_DIALOG_MODES.RECOVERY_UPDATE) {
      return recoveryPasswordUpdated ? elements.submit.focus() : elements.password.focus();
    }
    if ([AUTH_DIALOG_MODES.RECOVERY_REQUEST, AUTH_DIALOG_MODES.RESEND_CONFIRMATION].includes(mode)) {
      return elements.email.focus();
    }
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
      void requestClose();
    }
  }

  initialize();

  return Object.freeze({
    close: requestClose,
    destroy,
    getMode: () => mode,
    getView: () => view,
    handleEmailConfirmationCallback,
    handlePasswordRecoveryCallback,
    isOpen: () => isOpen,
    isRecoveryBlocking: () => mode === AUTH_DIALOG_MODES.RECOVERY_UPDATE && recoveryAuthorized,
    open,
    setMode
  });
}

function validateEmail(value) {
  const email = typeof value === "string" ? value.trim() : "";
  if (!email) return { valid: false, message: "请输入邮箱。" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, message: "请输入有效的邮箱地址。" };
  }
  return { valid: true, value: email };
}

function hasRuntimeRecoveryEvidence(state) {
  return state?.authEvent === "PASSWORD_RECOVERY" ||
    state?.sessionKind === AUTH_SESSION_KINDS.PASSWORD_RECOVERY;
}

function hasActiveRecoveryOwnership(state, recoveryUserId) {
  return state?.status === AUTH_STATUSES.AUTHENTICATED &&
    Boolean(recoveryUserId) &&
    state.user?.id === recoveryUserId &&
    hasRuntimeRecoveryEvidence(state);
}

function requestErrorMessage(code) {
  if (code === "rate-limited") return "操作过于频繁，请稍后再试。";
  return "暂时无法发送邮件，请稍后重试。";
}

function passwordUpdateErrorMessage(code) {
  if (code === "invalid-password") return "请输入有效的新密码。";
  return "暂时无法更新密码。请确认链接仍有效后重试。";
}

function authErrorMessage(code) {
  return {
    "invalid-credentials": "邮箱或密码错误。",
    "sign-up-failed": "创建账号失败，请检查邮箱和密码后重试。",
    "sign-out-failed": "退出登录失败，请稍后重试。",
    "service-unavailable": "暂时无法连接账号服务，请稍后重试。"
  }[code] ?? "暂时无法连接账号服务，请稍后重试。";
}

function requireValue(value, label) {
  if (!value) throw new TypeError(`${label} 不存在。`);
}
