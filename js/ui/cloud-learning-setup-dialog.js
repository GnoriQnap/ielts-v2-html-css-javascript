import {
  CLOUD_SYNC_STATUSES,
  LEARNING_STATE_SOURCES
} from "../core/learning-state-runtime.js?v=10.6b2";

export function createCloudLearningSetupDialog({
  runtimeActions,
  elements,
  body,
  backgroundElements = [],
  documentRef = globalThis.document
}) {
  let isOpen = false;
  let isSubmitting = false;
  let autoOpenedUserId = null;
  let returnFocusElement = null;
  const addedInertElements = new Set();

  elements.open.addEventListener("click", open);
  elements.close.addEventListener("click", close);
  elements.saveGuest.addEventListener("click", () => submit("save-guest"));
  elements.startFresh.addEventListener("click", () => submit("start-fresh"));
  documentRef?.addEventListener?.("keydown", handleKeydown);

  function update(status) {
    const isPending = status.source === LEARNING_STATE_SOURCES.PENDING_MIGRATION;
    elements.open.hidden = !isPending;
    elements.open.disabled = status.migrationInProgress;
    elements.saveGuest.disabled = status.migrationInProgress;
    elements.startFresh.disabled = status.migrationInProgress;

    if (!isPending) {
      if (isOpen) close();
      if (status.source === LEARNING_STATE_SOURCES.GUEST) autoOpenedUserId = null;
      return;
    }

    const shouldAutoOpen = (
      status.meaningfulGuestProgress || status.syncStatus === CLOUD_SYNC_STATUSES.SETUP_ERROR
    ) && autoOpenedUserId !== status.userId;
    if (shouldAutoOpen) {
      autoOpenedUserId = status.userId;
      open();
    }
    if (status.syncStatus === CLOUD_SYNC_STATUSES.SETUP_ERROR && isOpen) {
      elements.feedback.textContent = "暂时无法建立云端学习进度，请稍后重试。";
    }
  }

  function open() {
    if (!elements.open.hidden) returnFocusElement = documentRef?.activeElement ?? elements.open;
    elements.overlay.hidden = false;
    elements.overlay.setAttribute("aria-hidden", "false");
    elements.overlay.classList.add("is-open");
    body.classList.add("cloud-learning-setup-open");
    setBackgroundInert(true);
    elements.feedback.textContent = "";
    isOpen = true;
    elements.saveGuest.focus();
  }

  function close() {
    const focusTarget = returnFocusElement;
    elements.overlay.hidden = true;
    elements.overlay.setAttribute("aria-hidden", "true");
    elements.overlay.classList.remove("is-open");
    body.classList.remove("cloud-learning-setup-open");
    setBackgroundInert(false);
    isOpen = false;
    isSubmitting = false;
    returnFocusElement = null;
    if (focusTarget?.isConnected) {
      try { focusTarget.focus(); } catch { /* Cleanup must not depend on focus restoration. */ }
    }
  }

  async function submit(action) {
    if (isSubmitting) return;
    isSubmitting = true;
    elements.saveGuest.disabled = true;
    elements.startFresh.disabled = true;
    elements.feedback.textContent = "";
    const operation = action === "save-guest"
      ? runtimeActions.saveGuestProgressToAccount
      : runtimeActions.startCloudLearningFromZero;
    let result;
    try {
      result = await operation();
    } catch {
      result = { ok: false, status: "error" };
    }
    isSubmitting = false;
    const status = runtimeActions.getStatus();
    elements.saveGuest.disabled = status.migrationInProgress;
    elements.startFresh.disabled = status.migrationInProgress;
    if (status.source === LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD) {
      close();
      return result;
    }
    if (result.status !== "stale") {
      elements.feedback.textContent = "暂时无法建立云端学习进度，请稍后重试。";
    }
    return result;
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

  function handleKeydown(event) {
    if (isOpen && event.key === "Escape" && !isSubmitting) {
      event.preventDefault?.();
      close();
    }
  }

  function destroy() {
    close();
    documentRef?.removeEventListener?.("keydown", handleKeydown);
  }

  return Object.freeze({ close, destroy, isOpen: () => isOpen, open, update });
}
