import { AUTH_STATUSES } from "./auth-service.js?v=10.9d3";
import {
  composeVocabulary,
  createCustomVocabularySnapshot,
  createStableCustomCategoryId
} from "./custom-vocabulary-snapshot.js";
import {
  CUSTOM_VOCABULARY_CREATE_ACTIONS,
  CUSTOM_VOCABULARY_MIGRATION_KINDS,
  CUSTOM_VOCABULARY_SOURCES,
  CUSTOM_VOCABULARY_SYNC_STATUSES
} from "./custom-vocabulary-runtime.js";

export const CUSTOM_VOCABULARY_INTEGRATION_STATUSES = Object.freeze({
  READY: "ready",
  PENDING_MIGRATION: "pending-migration",
  BLOCKED: "blocked",
  STALE: "stale",
  ERROR: "error"
});

export function isActiveQuestionRenderable(activeQuestion, vocabularyIndex) {
  if (activeQuestion === null || activeQuestion === undefined) return true;
  if (!activeQuestion || typeof activeQuestion !== "object") return false;
  if (!vocabularyIndex?.displayByWordKey?.has(activeQuestion.wordKey)) return false;
  if (!Array.isArray(activeQuestion.optionGroupIds) || activeQuestion.optionGroupIds.length === 0) {
    return false;
  }
  if (!Array.isArray(activeQuestion.correctGroupIds) || activeQuestion.correctGroupIds.length === 0) {
    return false;
  }
  if (!Array.isArray(activeQuestion.selectedGroupIds)) return false;

  const optionGroupIds = new Set(activeQuestion.optionGroupIds);
  if (optionGroupIds.size !== activeQuestion.optionGroupIds.length) return false;
  if (activeQuestion.optionGroupIds.some((groupId) => !vocabularyIndex.groupById?.has(groupId))) {
    return false;
  }
  if (activeQuestion.correctGroupIds.some((groupId) => !optionGroupIds.has(groupId))) return false;
  return activeQuestion.selectedGroupIds.every((groupId) => optionGroupIds.has(groupId));
}

export function createCustomVocabularyIntegration({
  customRuntime,
  learningRuntime,
  officialBaseline,
  getGuestVocabulary,
  saveGuestVocabulary,
  activateVocabulary,
  holdLearningSurface = () => {},
  onVocabularyReady = () => {},
  randomUUID
}) {
  requireFunction(customRuntime?.initializeForAuthenticatedUser, "Custom Runtime initialization");
  requireFunction(customRuntime?.switchToGuest, "Custom Runtime Guest transition");
  requireFunction(learningRuntime?.handleAuthState, "Learning Runtime Auth transition");
  requireFunction(getGuestVocabulary, "Guest vocabulary read");
  requireFunction(saveGuestVocabulary, "Guest vocabulary save");
  requireFunction(activateVocabulary, "Vocabulary activation");

  let transitionGeneration = 0;
  let transitionKey = null;
  let transitionPromise = null;
  let settledKey = null;
  let currentAuthState = null;
  let currentIdentityMetadata = null;

  function handleAuthState(authState) {
    if (authState?.status === AUTH_STATUSES.LOADING) {
      return Promise.resolve({ status: "loading" });
    }
    const key = createAuthKey(authState);
    if (transitionKey === key && transitionPromise) return transitionPromise;
    if (settledKey === key && isSettledForAuth(authState)) {
      return Promise.resolve(createCurrentResult());
    }

    const operationGeneration = ++transitionGeneration;
    transitionKey = key;
    currentAuthState = cloneAuthState(authState);
    if (authState?.status === AUTH_STATUSES.AUTHENTICATED) holdLearningSurface();
    transitionPromise = performAuthTransition(authState, operationGeneration)
      .finally(() => {
        if (operationGeneration === transitionGeneration) {
          transitionPromise = null;
          transitionKey = null;
        }
      });
    return transitionPromise;
  }

  async function performAuthTransition(authState, operationGeneration) {
    if (authState?.status !== AUTH_STATUSES.AUTHENTICATED || !authState.user?.id) {
      customRuntime.switchToGuest();
      currentIdentityMetadata = null;
      activateVocabulary(getGuestVocabulary(), {
        source: CUSTOM_VOCABULARY_SOURCES.GUEST_LOCAL,
        identityMetadata: null,
        reason: "guest"
      });
      await learningRuntime.handleAuthState(authState);
      if (operationGeneration !== transitionGeneration) return staleResult();
      settledKey = createAuthKey(authState);
      onVocabularyReady({ source: CUSTOM_VOCABULARY_SOURCES.GUEST_LOCAL });
      return { ok: true, status: CUSTOM_VOCABULARY_INTEGRATION_STATUSES.READY };
    }

    const expectedUserId = authState.user.id;
    currentIdentityMetadata = null;
    activateVocabulary(officialBaseline, {
      source: CUSTOM_VOCABULARY_SOURCES.UNAVAILABLE,
      identityMetadata: null,
      reason: "account-loading"
    });
    const result = await customRuntime.initializeForAuthenticatedUser(expectedUserId);
    if (!isCurrentAuthOperation(operationGeneration, expectedUserId)) return staleResult();
    const status = customRuntime.getStatus();
    if (status.source === CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD) {
      return finishAuthenticatedVocabulary(authState, operationGeneration, "cloud-load");
    }
    if (status.source === CUSTOM_VOCABULARY_SOURCES.PENDING_MIGRATION) {
      settledKey = createAuthKey(authState);
      if (status.migrationKind === CUSTOM_VOCABULARY_MIGRATION_KINDS.EMPTY_GUEST) {
        const created = await customRuntime.startEmptyCloudVocabulary();
        if (!isCurrentAuthOperation(operationGeneration, expectedUserId)) return staleResult();
        if (customRuntime.getStatus().source === CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD) {
          return finishAuthenticatedVocabulary(authState, operationGeneration, "auto-empty-create");
        }
        return { ok: false, status: CUSTOM_VOCABULARY_INTEGRATION_STATUSES.BLOCKED, result: created };
      }
      return {
        ok: true,
        status: CUSTOM_VOCABULARY_INTEGRATION_STATUSES.PENDING_MIGRATION,
        migrationKind: status.migrationKind
      };
    }
    settledKey = createAuthKey(authState);
    return { ok: false, status: CUSTOM_VOCABULARY_INTEGRATION_STATUSES.BLOCKED, result };
  }

  async function completeMigration(action) {
    const authState = currentAuthState;
    const expectedUserId = authState?.user?.id;
    if (
      authState?.status !== AUTH_STATUSES.AUTHENTICATED ||
      !expectedUserId ||
      customRuntime.getStatus().source !== CUSTOM_VOCABULARY_SOURCES.PENDING_MIGRATION
    ) {
      return staleResult();
    }
    const operationGeneration = transitionGeneration;
    const result = action === CUSTOM_VOCABULARY_CREATE_ACTIONS.SAVE_GUEST
      ? await customRuntime.saveGuestToAccount()
      : await customRuntime.startEmptyCloudVocabulary();
    if (!isCurrentAuthOperation(operationGeneration, expectedUserId)) return staleResult();
    if (customRuntime.getStatus().source !== CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD) {
      return result;
    }
    const ready = await finishAuthenticatedVocabulary(authState, operationGeneration, action);
    return ready.ok ? result : ready;
  }

  async function finishAuthenticatedVocabulary(authState, operationGeneration, reason) {
    const expectedUserId = authState.user.id;
    const composed = composeVocabulary(officialBaseline, customRuntime.getSnapshot());
    if (!composed.ok) {
      return { ok: false, status: CUSTOM_VOCABULARY_INTEGRATION_STATUSES.ERROR };
    }
    currentIdentityMetadata = clonePlain(composed.identityMetadata);
    activateVocabulary(composed.vocabulary, {
      source: CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD,
      identityMetadata: currentIdentityMetadata,
      reason
    });
    if (!isCurrentAuthOperation(operationGeneration, expectedUserId)) return staleResult();

    // Vocabulary/index must be active before the Learning Repository asks for
    // its normalization context.
    await learningRuntime.handleAuthState(authState);
    if (!isCurrentAuthOperation(operationGeneration, expectedUserId)) return staleResult();
    settledKey = createAuthKey(authState);
    onVocabularyReady({ source: CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD, reason });
    return { ok: true, status: CUSTOM_VOCABULARY_INTEGRATION_STATUSES.READY };
  }

  function saveVocabularyCandidate(candidate) {
    const status = customRuntime.getStatus();
    if (status.source === CUSTOM_VOCABULARY_SOURCES.GUEST_LOCAL) {
      const saved = saveGuestVocabulary(candidate);
      activateVocabulary(saved, {
        source: CUSTOM_VOCABULARY_SOURCES.GUEST_LOCAL,
        identityMetadata: null,
        reason: "guest-mutation"
      });
      return { ok: true, status: "saved-guest", savePromise: null };
    }
    if (
      status.source !== CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD ||
      status.syncStatus === CUSTOM_VOCABULARY_SYNC_STATUSES.SAVING
    ) {
      return { ok: false, status: status.source === CUSTOM_VOCABULARY_SOURCES.CONFLICT
        ? "conflict"
        : "not-writable" };
    }

    const extracted = createCustomVocabularySnapshot(candidate, officialBaseline, {
      identityMetadata: currentIdentityMetadata,
      generateCategoryId(group) {
        return createStableCustomCategoryId(randomUUID === undefined
          ? {}
          : { randomUUID });
      }
    });
    if (!extracted.ok) {
      return { ok: false, status: "invalid-snapshot", errors: extracted.errors };
    }
    const composed = composeVocabulary(officialBaseline, extracted.snapshot);
    if (!composed.ok) {
      return { ok: false, status: "compose-failed", errors: composed.errors };
    }

    currentIdentityMetadata = clonePlain(composed.identityMetadata);
    activateVocabulary(composed.vocabulary, {
      source: CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD,
      identityMetadata: currentIdentityMetadata,
      reason: "account-mutation"
    });
    const savePromise = customRuntime.updateCloudSnapshot(extracted.snapshot);
    return { ok: true, status: "saving-cloud", snapshot: extracted.snapshot, savePromise };
  }

  async function reloadAfterConflict() {
    const expectedUserId = currentAuthState?.user?.id;
    const operationGeneration = transitionGeneration;
    const result = await customRuntime.reloadCloudCustomVocabularyAfterConflict();
    if (!isCurrentAuthOperation(operationGeneration, expectedUserId)) return staleResult();
    if (customRuntime.getStatus().source !== CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD) {
      return result;
    }
    const composed = composeVocabulary(officialBaseline, customRuntime.getSnapshot());
    if (!composed.ok) return { ok: false, status: "compose-failed" };
    currentIdentityMetadata = clonePlain(composed.identityMetadata);
    activateVocabulary(composed.vocabulary, {
      source: CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD,
      identityMetadata: currentIdentityMetadata,
      reason: "conflict-reload"
    });
    onVocabularyReady({
      source: CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD,
      reason: "conflict-reload",
      reconcileLearning: false
    });
    return result;
  }

  function isCurrentAuthOperation(operationGeneration, expectedUserId) {
    return operationGeneration === transitionGeneration &&
      currentAuthState?.status === AUTH_STATUSES.AUTHENTICATED &&
      currentAuthState.user?.id === expectedUserId;
  }

  function isSettledForAuth(authState) {
    const status = customRuntime.getStatus();
    if (authState?.status === AUTH_STATUSES.AUTHENTICATED) {
      return status.userId === authState.user?.id && [
        CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD,
        CUSTOM_VOCABULARY_SOURCES.PENDING_MIGRATION,
        CUSTOM_VOCABULARY_SOURCES.CONFLICT,
        CUSTOM_VOCABULARY_SOURCES.UNAVAILABLE
      ].includes(status.source);
    }
    return status.source === CUSTOM_VOCABULARY_SOURCES.GUEST_LOCAL;
  }

  function createCurrentResult() {
    const source = customRuntime.getStatus().source;
    return {
      ok: source !== CUSTOM_VOCABULARY_SOURCES.UNAVAILABLE,
      status: source === CUSTOM_VOCABULARY_SOURCES.PENDING_MIGRATION
        ? CUSTOM_VOCABULARY_INTEGRATION_STATUSES.PENDING_MIGRATION
        : source === CUSTOM_VOCABULARY_SOURCES.UNAVAILABLE
          ? CUSTOM_VOCABULARY_INTEGRATION_STATUSES.BLOCKED
          : CUSTOM_VOCABULARY_INTEGRATION_STATUSES.READY
    };
  }

  return Object.freeze({
    completeMigration,
    getIdentityMetadata: () => cloneNullable(currentIdentityMetadata),
    handleAuthState,
    reloadAfterConflict,
    saveVocabularyCandidate
  });
}

function createAuthKey(authState) {
  return authState?.status === AUTH_STATUSES.AUTHENTICATED
    ? `authenticated:${authState.user?.id ?? ""}`
    : authState?.status ?? AUTH_STATUSES.GUEST;
}

function cloneAuthState(authState) {
  return authState ? {
    ...authState,
    user: authState.user ? { ...authState.user } : null
  } : { status: AUTH_STATUSES.GUEST, user: null };
}

function staleResult() {
  return { ok: false, status: CUSTOM_VOCABULARY_INTEGRATION_STATUSES.STALE };
}

function cloneNullable(value) {
  return value === null ? null : clonePlain(value);
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label} 必须是函数。`);
}
