import { AUTH_STATUSES } from "./auth-service.js?v=10.2a";
import { CLOUD_LEARNING_STATE_STATUSES } from "./cloud-learning-state-repository.js?v=10.4a";

export const LEARNING_STATE_SOURCES = Object.freeze({
  GUEST: "guest",
  AUTHENTICATED_CLOUD: "authenticated-cloud",
  PENDING_MIGRATION: "pending-migration"
});

export const CLOUD_SYNC_STATUSES = Object.freeze({
  GUEST: "guest",
  LOADING: "loading",
  CONNECTED: "connected",
  PENDING_MIGRATION: "pending-migration",
  UNAVAILABLE: "unavailable",
  SAVE_ERROR: "save-error"
});

export function createLearningStateRuntime({
  guestState,
  cloudRepository,
  saveGuestState,
  normalizeRuntimeState = (state) => state,
  onRuntimeStateChange = () => {},
  onStatusChange = () => {}
}) {
  requireFunction(cloudRepository?.loadCloudLearningState, "Cloud load");
  requireFunction(cloudRepository?.updateCloudLearningState, "Cloud update");
  requireFunction(saveGuestState, "Guest save");
  requireFunction(normalizeRuntimeState, "State normalization");

  let preservedGuestState = guestState;
  let currentState = guestState;
  let source = LEARNING_STATE_SOURCES.GUEST;
  let syncStatus = CLOUD_SYNC_STATUSES.GUEST;
  let currentUserId = null;
  let cloudRowConfirmed = false;
  let generation = 0;
  let loadingUserId = null;
  let loadingPromise = null;
  let cloudSaveChain = Promise.resolve();
  let unsubscribeAuth = null;

  function getState() {
    return currentState;
  }

  function getStatus() {
    return {
      source,
      syncStatus,
      userId: currentUserId,
      cloudRowConfirmed
    };
  }

  function connectAuthService(authService) {
    if (unsubscribeAuth) return unsubscribeAuth;
    requireFunction(authService?.subscribe, "Auth subscription");
    unsubscribeAuth = authService.subscribe((authState) => {
      void handleAuthState(authState);
    });
    return unsubscribeAuth;
  }

  async function handleAuthState(authState) {
    if (authState?.status === AUTH_STATUSES.AUTHENTICATED && authState.user?.id) {
      return activateAuthenticatedUser(authState.user.id);
    }
    if (authState?.status === AUTH_STATUSES.LOADING) {
      return getStatus();
    }
    return activateGuest(authState?.status === AUTH_STATUSES.UNAVAILABLE
      ? CLOUD_SYNC_STATUSES.UNAVAILABLE
      : CLOUD_SYNC_STATUSES.GUEST);
  }

  async function activateAuthenticatedUser(userId) {
    if (
      currentUserId === userId &&
      loadingUserId === null &&
      [
        LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD,
        LEARNING_STATE_SOURCES.PENDING_MIGRATION
      ].includes(source)
    ) {
      return getStatus();
    }
    if (loadingUserId === userId && loadingPromise) {
      return loadingPromise;
    }

    const wasShowingAccountState = source === LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD;
    const operationGeneration = ++generation;
    loadingUserId = userId;
    currentUserId = userId;
    cloudRowConfirmed = false;
    source = LEARNING_STATE_SOURCES.GUEST;
    if (wasShowingAccountState) {
      currentState = preservedGuestState;
    }
    setSyncStatus(CLOUD_SYNC_STATUSES.LOADING);
    if (wasShowingAccountState) notifyRuntimeStateChange();

    loadingPromise = (async () => {
      const result = await cloudRepository.loadCloudLearningState();
      if (operationGeneration !== generation || currentUserId !== userId) {
        return { ...getStatus(), stale: true };
      }

      loadingUserId = null;
      loadingPromise = null;
      if (result.ok && result.status === CLOUD_LEARNING_STATE_STATUSES.FOUND) {
        source = LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD;
        cloudRowConfirmed = true;
        currentState = normalizeRuntimeState(result.state);
        setSyncStatus(CLOUD_SYNC_STATUSES.CONNECTED);
        notifyRuntimeStateChange();
        return getStatus();
      }

      if (result.ok && result.status === CLOUD_LEARNING_STATE_STATUSES.NOT_FOUND) {
        source = LEARNING_STATE_SOURCES.PENDING_MIGRATION;
        cloudRowConfirmed = false;
        currentState = preservedGuestState;
        setSyncStatus(CLOUD_SYNC_STATUSES.PENDING_MIGRATION);
        notifyRuntimeStateChange();
        return getStatus();
      }

      source = LEARNING_STATE_SOURCES.GUEST;
      cloudRowConfirmed = false;
      currentState = preservedGuestState;
      setSyncStatus(CLOUD_SYNC_STATUSES.UNAVAILABLE);
      notifyRuntimeStateChange();
      return getStatus();
    })().catch(() => {
      if (operationGeneration === generation && currentUserId === userId) {
        loadingUserId = null;
        loadingPromise = null;
        source = LEARNING_STATE_SOURCES.GUEST;
        cloudRowConfirmed = false;
        currentState = preservedGuestState;
        setSyncStatus(CLOUD_SYNC_STATUSES.UNAVAILABLE);
        notifyRuntimeStateChange();
      }
      return getStatus();
    });

    return loadingPromise;
  }

  function activateGuest(nextSyncStatus = CLOUD_SYNC_STATUSES.GUEST) {
    generation += 1;
    loadingUserId = null;
    loadingPromise = null;
    currentUserId = null;
    cloudRowConfirmed = false;
    const shouldNotify = currentState !== preservedGuestState || source !== LEARNING_STATE_SOURCES.GUEST;
    source = LEARNING_STATE_SOURCES.GUEST;
    currentState = preservedGuestState;
    setSyncStatus(nextSyncStatus);
    if (shouldNotify) notifyRuntimeStateChange();
    return getStatus();
  }

  function persistState(nextState) {
    currentState = nextState;
    if (source !== LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD || !cloudRowConfirmed) {
      preservedGuestState = saveGuestState(nextState);
      currentState = preservedGuestState;
      return currentState;
    }

    enqueueCloudSave(nextState, {
      generation,
      userId: currentUserId
    });
    return currentState;
  }

  function enqueueCloudSave(stateToSave, identity) {
    cloudSaveChain = cloudSaveChain
      .catch(() => undefined)
      .then(async () => {
        if (!isCurrentCloudIdentity(identity)) return { status: "stale" };
        const result = await cloudRepository.updateCloudLearningState(
          stateToSave,
          { expectedUserId: identity.userId }
        );
        if (!isCurrentCloudIdentity(identity)) return { status: "stale" };

        if (result.ok && result.status === CLOUD_LEARNING_STATE_STATUSES.UPDATED) {
          setSyncStatus(CLOUD_SYNC_STATUSES.CONNECTED);
          return result;
        }
        if (result.status === CLOUD_LEARNING_STATE_STATUSES.NOT_FOUND) {
          source = LEARNING_STATE_SOURCES.PENDING_MIGRATION;
          cloudRowConfirmed = false;
          currentState = preservedGuestState;
          setSyncStatus(CLOUD_SYNC_STATUSES.PENDING_MIGRATION);
          notifyRuntimeStateChange();
          return result;
        }
        setSyncStatus(CLOUD_SYNC_STATUSES.SAVE_ERROR);
        return result;
      })
      .catch(() => {
        if (isCurrentCloudIdentity(identity)) {
          setSyncStatus(CLOUD_SYNC_STATUSES.SAVE_ERROR);
        }
        return { ok: false, status: CLOUD_LEARNING_STATE_STATUSES.ERROR };
      });
  }

  function isCurrentCloudIdentity(identity) {
    return source === LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD &&
      cloudRowConfirmed &&
      generation === identity.generation &&
      currentUserId === identity.userId;
  }

  function setSyncStatus(nextStatus) {
    syncStatus = nextStatus;
    onStatusChange(getStatus());
  }

  function notifyRuntimeStateChange() {
    onRuntimeStateChange(currentState, getStatus());
  }

  async function flushCloudSaves() {
    await cloudSaveChain;
  }

  function destroy() {
    generation += 1;
    unsubscribeAuth?.();
    unsubscribeAuth = null;
  }

  return Object.freeze({
    connectAuthService,
    destroy,
    flushCloudSaves,
    getState,
    getStatus,
    handleAuthState,
    persistState
  });
}

function requireFunction(value, label) {
  if (typeof value !== "function") {
    throw new TypeError(`${label} 必须是函数。`);
  }
}
