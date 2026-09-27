import {
  AUTH_CALLBACK_CLASSIFICATIONS,
  inspectAuthCallback
} from "./auth-confirmation.js?v=10.9d3";

const RECOVERY_CLASSIFICATIONS = new Set([
  AUTH_CALLBACK_CLASSIFICATIONS.PASSWORD_RECOVERY,
  AUTH_CALLBACK_CLASSIFICATIONS.INVALID_PASSWORD_RECOVERY
]);

export function createAuthRecoveryStartupCoordinator({
  callbackUrl,
  establishRecoveryUi,
  cleanCallbackUrl
}) {
  if (typeof establishRecoveryUi !== "function") {
    throw new TypeError("Recovery UI handler 必须是函数。");
  }
  const callbackUrlSnapshot = String(callbackUrl ?? "");
  const initialIntent = inspectAuthCallback(callbackUrlSnapshot);
  const isRecoveryCallback = initialIntent.isCallback &&
    RECOVERY_CLASSIFICATIONS.has(initialIntent.classification);
  let lastClassification = "";
  let callbackUrlCleaned = false;

  function handleAuthState(authState) {
    if (!isRecoveryCallback || authState?.status === "loading") {
      return { handled: false, classification: initialIntent.classification };
    }
    const callback = inspectAuthCallback(callbackUrlSnapshot, {
      authEvent: authState?.authEvent,
      sessionKind: authState?.sessionKind
    });
    const mayUpgradeInvalidRecovery =
      lastClassification === AUTH_CALLBACK_CLASSIFICATIONS.INVALID_PASSWORD_RECOVERY &&
      callback.classification === AUTH_CALLBACK_CLASSIFICATIONS.PASSWORD_RECOVERY;
    if (lastClassification && !mayUpgradeInvalidRecovery) {
      return { handled: false, duplicate: true, classification: callback.classification };
    }

    lastClassification = callback.classification;
    establishRecoveryUi(callback, authState);
    if (!callbackUrlCleaned && typeof cleanCallbackUrl === "function") {
      cleanCallbackUrl();
      callbackUrlCleaned = true;
    }
    return { handled: true, classification: callback.classification };
  }

  return Object.freeze({
    getInitialIntent: () => initialIntent,
    handleAuthState,
    isRecoveryCallback: () => isRecoveryCallback
  });
}
