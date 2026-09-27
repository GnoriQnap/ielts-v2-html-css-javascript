import {
  CUSTOM_VOCABULARY_CREATE_ACTIONS,
  CUSTOM_VOCABULARY_MIGRATION_KINDS,
  CUSTOM_VOCABULARY_SOURCES,
  CUSTOM_VOCABULARY_SYNC_STATUSES
} from "../core/custom-vocabulary-runtime.js";

export function createCustomVocabularySetupDialog({
  integrationActions,
  runtimeActions,
  elements,
  body,
  backgroundElements = [],
  documentRef = globalThis.document,
  shouldDeferAutoOpen = () => false
}) {
  let isOpen = false;
  let isSubmitting = false;
  let openedForUserId = null;
  let returnFocusElement = null;
  const addedInertElements = new Set();

  elements.open.addEventListener("click", open);
  elements.saveGuest.addEventListener("click", () => submit(CUSTOM_VOCABULARY_CREATE_ACTIONS.SAVE_GUEST));
  elements.startEmpty.addEventListener("click", () => submit(CUSTOM_VOCABULARY_CREATE_ACTIONS.START_EMPTY));

  function update(status) {
    const isPending = status.source === CUSTOM_VOCABULARY_SOURCES.PENDING_MIGRATION;
    const isBlocked = status.migrationKind ===
      CUSTOM_VOCABULARY_MIGRATION_KINDS.GUEST_SNAPSHOT_UNAVAILABLE;
    const isEmptyRetry = status.migrationKind === CUSTOM_VOCABULARY_MIGRATION_KINDS.EMPTY_GUEST;
    const requiresDialog = isPending && (
      status.migrationKind !== CUSTOM_VOCABULARY_MIGRATION_KINDS.EMPTY_GUEST ||
      status.syncStatus === CUSTOM_VOCABULARY_SYNC_STATUSES.SETUP_ERROR
    );
    elements.open.hidden = !requiresDialog;
    elements.open.disabled = status.operationInProgress;
    elements.saveGuest.hidden = isBlocked || isEmptyRetry;
    elements.saveGuest.disabled = status.operationInProgress;
    elements.startEmpty.disabled = status.operationInProgress;
    elements.title.textContent = isBlocked
      ? "无法直接同步本机词汇"
      : isEmptyRetry
        ? "初始化账号自定义词汇"
        : "设置账号自定义词汇";
    elements.copy.textContent = isBlocked
      ? "本机词库包含旧版或不兼容修改，无法安全上传到账号。"
      : isEmptyRetry
        ? "暂时无法建立账号自定义词汇，请重试。"
      : "检测到这台设备上有自定义词汇。选择是否保存到账号。";
    elements.startEmpty.textContent = isBlocked
      ? "账号从零开始"
      : isEmptyRetry
        ? "重试初始化"
        : "从零开始";
    elements.note.textContent = isBlocked
      ? "账号从零开始不会删除这台设备上的访客词汇。"
      : "从零开始不会删除这台设备上的访客词汇。";

    if (shouldDeferAutoOpen()) {
      if (isOpen) closeForDeferral();
      openedForUserId = null;
      return;
    }

    if (!requiresDialog) {
      if (isOpen) closeAfterResolution();
      if (status.source === CUSTOM_VOCABULARY_SOURCES.GUEST_LOCAL) openedForUserId = null;
      return;
    }
    if (openedForUserId !== status.userId) {
      openedForUserId = status.userId;
      open();
    }
    if (status.syncStatus === CUSTOM_VOCABULARY_SYNC_STATUSES.SETUP_ERROR) {
      elements.feedback.textContent = "暂时无法建立账号自定义词汇，请稍后重试。";
    }
  }

  function open() {
    if (shouldDeferAutoOpen()) return;
    if (elements.open.hidden && !runtimeActions.getStatus().migrationRequired) return;
    if (!isOpen) returnFocusElement = documentRef?.activeElement ?? elements.open;
    elements.overlay.hidden = false;
    elements.overlay.setAttribute("aria-hidden", "false");
    elements.overlay.classList.add("is-open");
    body.classList.add("custom-vocabulary-setup-open");
    setBackgroundInert(true);
    elements.feedback.textContent = "";
    isOpen = true;
    const status = runtimeActions.getStatus();
    const firstAction = status.migrationKind ===
      CUSTOM_VOCABULARY_MIGRATION_KINDS.GUEST_SNAPSHOT_UNAVAILABLE
      ? elements.startEmpty
      : elements.saveGuest;
    firstAction.focus();
  }

  async function submit(action) {
    if (isSubmitting) return;
    isSubmitting = true;
    elements.saveGuest.disabled = true;
    elements.startEmpty.disabled = true;
    elements.feedback.textContent = "正在设置账号自定义词汇…";
    let result;
    try {
      result = await integrationActions.completeMigration(action);
    } catch {
      result = { ok: false, status: "error" };
    }
    isSubmitting = false;
    const status = runtimeActions.getStatus();
    if (status.source === CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD) {
      closeAfterResolution();
      return result;
    }
    elements.saveGuest.disabled = false;
    elements.startEmpty.disabled = false;
    if (result.status !== "stale") {
      elements.feedback.textContent = "暂时无法建立账号自定义词汇，请稍后重试。";
    }
    return result;
  }

  function closeAfterResolution() {
    const focusTarget = returnFocusElement;
    setBackgroundInert(false);
    if (focusTarget?.isConnected) {
      try { focusTarget.focus(); } catch { /* Cleanup must not depend on focus restoration. */ }
    }
    elements.overlay.hidden = true;
    elements.overlay.setAttribute("aria-hidden", "true");
    elements.overlay.classList.remove("is-open");
    body.classList.remove("custom-vocabulary-setup-open");
    isOpen = false;
    isSubmitting = false;
    returnFocusElement = null;
    elements.feedback.textContent = "";
  }

  function closeForDeferral() {
    const wasSubmitting = isSubmitting;
    closeAfterResolution();
    isSubmitting = wasSubmitting;
  }

  function setBackgroundInert(inert) {
    if (inert) {
      for (const element of backgroundElements) {
        if (element && !element.hasAttribute?.("inert")) {
          element.setAttribute("inert", "");
          addedInertElements.add(element);
        }
      }
      return;
    }
    for (const element of addedInertElements) element.removeAttribute?.("inert");
    addedInertElements.clear();
  }

  return Object.freeze({ isOpen: () => isOpen, open, update });
}
