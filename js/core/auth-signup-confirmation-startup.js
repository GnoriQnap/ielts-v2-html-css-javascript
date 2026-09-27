import { AUTH_STATUSES } from "./auth-service.js?v=10.9d3";

export function createSignupConfirmationStartupCoordinator({
  authService,
  signupCallback,
  handleSignupConfirmation,
  cleanSignupCallback,
  handleRecoveryAuthState,
  dispatchOwnershipState
}) {
  requireFunction(authService?.initialize, "Auth initialize");
  requireFunction(authService?.getState, "Auth getState");
  requireFunction(handleSignupConfirmation, "Signup confirmation handler");
  requireFunction(dispatchOwnershipState, "Auth ownership dispatcher");

  // URL evidence may hold ownership startup, but the dialog still requires a
  // real authenticated Supabase session before it can complete confirmation.
  const hasSignupCallbackGateEvidence = Boolean(
    signupCallback?.isCallback &&
    signupCallback?.hasConfirmationEvidence &&
    !signupCallback?.hasError
  );
  let gateActive = hasSignupCallbackGateEvidence;
  let latestAuthState = null;
  let lastOwnershipKey = "";
  let lastOwnershipPromise = null;

  function handleAuthState(authState) {
    handleRecoveryAuthState?.(authState);
    if (!authState || authState.status === AUTH_STATUSES.LOADING) {
      return Promise.resolve({ handled: false, loading: true });
    }

    latestAuthState = authState;
    if (gateActive) {
      return Promise.resolve({ handled: false, gated: true });
    }
    return dispatchOwnership(authState);
  }

  async function initialize() {
    const initializedState = await authService.initialize();
    await handleAuthState(initializedState);

    if (!signupCallback?.isCallback) {
      return { gated: false, confirmation: null };
    }

    let confirmationResult;
    try {
      confirmationResult = await handleSignupConfirmation(signupCallback);
    } finally {
      cleanSignupCallback?.();
    }

    if (!gateActive) {
      return { gated: false, confirmation: confirmationResult };
    }
    if (confirmationResult?.success) {
      const releaseResult = await releaseAfterConfirmationSignOut(authService.getState());
      return { ...releaseResult, confirmation: confirmationResult };
    }
    return { gated: true, confirmation: confirmationResult };
  }

  async function releaseAfterConfirmationSignOut(authState = authService.getState()) {
    if (authState?.status !== AUTH_STATUSES.GUEST) {
      return { released: false, gated: gateActive };
    }
    latestAuthState = authState;
    gateActive = false;
    await dispatchOwnership(authState);
    return { released: true, gated: false };
  }

  function dispatchOwnership(authState) {
    const ownershipKey = createOwnershipKey(authState);
    if (ownershipKey === lastOwnershipKey && lastOwnershipPromise) {
      return lastOwnershipPromise;
    }
    lastOwnershipKey = ownershipKey;
    lastOwnershipPromise = Promise.resolve(dispatchOwnershipState(authState)).catch((error) => {
      if (lastOwnershipKey === ownershipKey) {
        lastOwnershipKey = "";
        lastOwnershipPromise = null;
      }
      throw error;
    });
    return lastOwnershipPromise;
  }

  return Object.freeze({
    handleAuthState,
    initialize,
    isOwnershipGated: () => gateActive,
    releaseAfterConfirmationSignOut
  });
}

function createOwnershipKey(authState) {
  return `${authState?.status ?? "unknown"}:${authState?.user?.id ?? ""}`;
}

function requireFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label} 必须是函数。`);
}
