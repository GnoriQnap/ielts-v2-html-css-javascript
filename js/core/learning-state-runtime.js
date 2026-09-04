import { AUTH_STATUSES } from "./auth-service.js?v=10.2a";
import { CLOUD_LEARNING_STATE_STATUSES } from "./cloud-learning-state-repository.js?v=10.6b2";
import { createDefaultAppState } from "./storage.js?v=8.4c1";

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
  CREATING: "creating",
  SETUP_ERROR: "setup-error",
  SAVE_ERROR: "save-error",
  CONFLICT: "conflict"
});

export const CLOUD_SETUP_ACTIONS = Object.freeze({
  SAVE_GUEST: "save-guest",
  START_FRESH: "start-fresh"
});

export const PERSISTENCE_INTENTS = Object.freeze({
  IMMEDIATE: "immediate",
  CLOUD_DEFERRED: "cloud-deferred"
});

export function hasMeaningfulLearningProgress(state) {
  if (!state || typeof state !== "object") return false;
  const records = state.learning?.byWordKey;
  if (records && typeof records === "object" && !Array.isArray(records)) {
    for (const record of Object.values(records)) {
      if (isMeaningfulLearningRecord(record)) return true;
    }
  }

  const practice = state.practice;
  if (Number.isInteger(practice?.freeAttemptCount) && practice.freeAttemptCount > 0) return true;
  if (Array.isArray(practice?.reviewQueue) && practice.reviewQueue.length > 0) return true;
  if (isMeaningfulActiveQuestion(practice?.activeQuestion)) return true;
  if (hasMeaningfulRoundProgress(state.rounds?.current)) return true;
  return Boolean(state.rounds?.lastCompletedSummary);
}

export function createLearningStateRuntime({
  guestState,
  cloudRepository,
  saveGuestState,
  createDefaultState = createDefaultAppState,
  normalizeRuntimeState = (state) => state,
  onRuntimeStateChange = () => {},
  onStatusChange = () => {}
}) {
  requireFunction(cloudRepository?.loadCloudLearningState, "Cloud load");
  requireFunction(cloudRepository?.updateCloudLearningState, "Cloud update");
  requireFunction(saveGuestState, "Guest save");
  requireFunction(createDefaultState, "Default state factory");
  requireFunction(normalizeRuntimeState, "State normalization");

  let preservedGuestState = guestState;
  let currentState = guestState;
  let source = LEARNING_STATE_SOURCES.GUEST;
  let syncStatus = CLOUD_SYNC_STATUSES.GUEST;
  let currentUserId = null;
  let cloudRowConfirmed = false;
  let cloudRevision = null;
  let conflictRemote = null;
  let conflictReloadPromise = null;
  let generation = 0;
  let loadingUserId = null;
  let loadingPromise = null;
  let cloudSaveInFlight = null;
  let cloudPendingLatest = null;
  let cloudRetryPaused = false;
  let pendingMigration = null;
  let migrationPromise = null;
  let lastSetupAction = null;
  let unsubscribeAuth = null;

  function getState() {
    return currentState;
  }

  function getStatus() {
    return {
      source,
      syncStatus,
      userId: currentUserId,
      cloudRowConfirmed,
      cloudRevision,
      remoteRevision: conflictRemote?.revision ?? null,
      conflictReloading: Boolean(conflictReloadPromise),
      meaningfulGuestProgress: pendingMigration?.meaningfulGuestProgress ?? false,
      migrationInProgress: Boolean(migrationPromise),
      lastSetupAction
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
    discardPendingCloudSave();
    pendingMigration = null;
    migrationPromise = null;
    lastSetupAction = null;
    loadingUserId = userId;
    currentUserId = userId;
    cloudRowConfirmed = false;
    cloudRevision = null;
    conflictRemote = null;
    conflictReloadPromise = null;
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
        pendingMigration = null;
        migrationPromise = null;
        source = LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD;
        cloudRowConfirmed = true;
        cloudRevision = result.revision;
        currentState = normalizeRuntimeState(result.state);
        setSyncStatus(CLOUD_SYNC_STATUSES.CONNECTED);
        notifyRuntimeStateChange();
        return getStatus();
      }

      if (result.ok && result.status === CLOUD_LEARNING_STATE_STATUSES.NOT_FOUND) {
        source = LEARNING_STATE_SOURCES.PENDING_MIGRATION;
        cloudRowConfirmed = false;
        cloudRevision = null;
        currentState = preservedGuestState;
        pendingMigration = {
          userId,
          generation: operationGeneration,
          meaningfulGuestProgress: hasMeaningfulLearningProgress(preservedGuestState)
        };
        setSyncStatus(CLOUD_SYNC_STATUSES.PENDING_MIGRATION);
        notifyRuntimeStateChange();
        if (!pendingMigration.meaningfulGuestProgress) {
          return establishCloudLearningState(CLOUD_SETUP_ACTIONS.START_FRESH);
        }
        return getStatus();
      }

      source = LEARNING_STATE_SOURCES.GUEST;
      pendingMigration = null;
      cloudRowConfirmed = false;
      cloudRevision = null;
      currentState = preservedGuestState;
      setSyncStatus(CLOUD_SYNC_STATUSES.UNAVAILABLE);
      notifyRuntimeStateChange();
      return getStatus();
    })().catch(() => {
      if (operationGeneration === generation && currentUserId === userId) {
        loadingUserId = null;
        loadingPromise = null;
        source = LEARNING_STATE_SOURCES.GUEST;
        pendingMigration = null;
        cloudRowConfirmed = false;
        cloudRevision = null;
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
    discardPendingCloudSave();
    loadingUserId = null;
    loadingPromise = null;
    currentUserId = null;
    cloudRowConfirmed = false;
    cloudRevision = null;
    conflictRemote = null;
    conflictReloadPromise = null;
    pendingMigration = null;
    migrationPromise = null;
    lastSetupAction = null;
    const shouldNotify = currentState !== preservedGuestState || source !== LEARNING_STATE_SOURCES.GUEST;
    source = LEARNING_STATE_SOURCES.GUEST;
    currentState = preservedGuestState;
    setSyncStatus(nextSyncStatus);
    if (shouldNotify) notifyRuntimeStateChange();
    return getStatus();
  }

  function persistState(nextState, options = {}) {
    const intent = normalizePersistenceIntent(options.intent);
    currentState = nextState;
    if (source !== LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD || !cloudRowConfirmed) {
      preservedGuestState = saveGuestState(nextState);
      currentState = preservedGuestState;
      return currentState;
    }

    if (syncStatus === CLOUD_SYNC_STATUSES.CONFLICT) return currentState;

    // An unsubmitted selection may be lost on refresh in cloud mode. The next
    // immediate snapshot (submit, decision, navigation, etc.) includes it.
    if (intent === PERSISTENCE_INTENTS.CLOUD_DEFERRED) return currentState;

    enqueueCloudSave(nextState, {
      generation,
      userId: currentUserId
    });
    return currentState;
  }

  function enqueueCloudSave(stateToSave, identity) {
    cloudPendingLatest = { state: stateToSave, identity };
    cloudRetryPaused = false;
    drainCloudSaves();
  }

  function drainCloudSaves() {
    if (cloudSaveInFlight || cloudRetryPaused || !cloudPendingLatest) return;

    const request = cloudPendingLatest;
    cloudPendingLatest = null;
    if (!isCurrentCloudIdentity(request.identity)) {
      drainCloudSaves();
      return;
    }
    if (syncStatus === CLOUD_SYNC_STATUSES.CONFLICT || !isValidRevision(cloudRevision)) {
      discardPendingCloudSave();
      return;
    }

    cloudSaveInFlight = performCloudSave(request)
      .catch(() => handleCloudSaveError(request))
      .finally(() => {
        cloudSaveInFlight = null;
        drainCloudSaves();
      });
  }

  async function performCloudSave(request) {
    const { state: stateToSave, identity } = request;
    if (!isCurrentCloudIdentity(identity)) return { status: "stale" };

    // Read at drain time so a coalesced pending snapshot uses the revision
    // returned by the preceding in-flight update.
    const expectedRevision = cloudRevision;
    const result = await cloudRepository.updateCloudLearningState(
      stateToSave,
      { expectedUserId: identity.userId, expectedRevision }
    );
    if (!isCurrentCloudIdentity(identity)) return { status: "stale" };

    if (result.ok && result.status === CLOUD_LEARNING_STATE_STATUSES.UPDATED) {
      if (!isValidRevision(result.revision) || result.revision !== expectedRevision + 1) {
        return handleCloudSaveError(request);
      }
      cloudRevision = result.revision;
      setSyncStatus(CLOUD_SYNC_STATUSES.CONNECTED);
      return result;
    }
    if (result.status === CLOUD_LEARNING_STATE_STATUSES.CONFLICT) {
      conflictRemote = isValidRevision(result.revision)
        ? { state: result.state, updatedAt: result.updatedAt ?? null, revision: result.revision }
        : null;
      discardPendingCloudSave();
      setSyncStatus(CLOUD_SYNC_STATUSES.CONFLICT);
      return result;
    }
    if (result.status === CLOUD_LEARNING_STATE_STATUSES.NOT_FOUND) {
      discardPendingCloudSave();
      source = LEARNING_STATE_SOURCES.PENDING_MIGRATION;
      cloudRowConfirmed = false;
      cloudRevision = null;
      currentState = preservedGuestState;
      pendingMigration = {
        userId: identity.userId,
        generation: identity.generation,
        meaningfulGuestProgress: hasMeaningfulLearningProgress(preservedGuestState)
      };
      migrationPromise = null;
      setSyncStatus(CLOUD_SYNC_STATUSES.PENDING_MIGRATION);
      notifyRuntimeStateChange();
      return result;
    }
    if (result.status === CLOUD_LEARNING_STATE_STATUSES.IDENTITY_CHANGED) {
      discardPendingCloudSave();
      setSyncStatus(CLOUD_SYNC_STATUSES.SAVE_ERROR);
      return result;
    }
    return handleCloudSaveError(request, result);
  }

  function handleCloudSaveError(request, result = {
    ok: false,
    status: CLOUD_LEARNING_STATE_STATUSES.ERROR
  }) {
    if (isCurrentCloudIdentity(request.identity)) {
      if (!cloudPendingLatest || !isSameIdentity(cloudPendingLatest.identity, request.identity)) {
        cloudPendingLatest = request;
      }
      cloudRetryPaused = true;
      setSyncStatus(CLOUD_SYNC_STATUSES.SAVE_ERROR);
    }
    return result;
  }

  function discardPendingCloudSave() {
    cloudPendingLatest = null;
    cloudRetryPaused = false;
  }

  function saveGuestProgressToAccount() {
    return establishCloudLearningState(CLOUD_SETUP_ACTIONS.SAVE_GUEST);
  }

  function startCloudLearningFromZero() {
    return establishCloudLearningState(CLOUD_SETUP_ACTIONS.START_FRESH);
  }

  function establishCloudLearningState(action) {
    if (migrationPromise) return migrationPromise;
    if (!isCurrentPendingMigration()) {
      return Promise.resolve({ ok: false, status: "stale" });
    }

    const identity = {
      generation: pendingMigration.generation,
      userId: pendingMigration.userId
    };
    const stateToCreate = action === CLOUD_SETUP_ACTIONS.SAVE_GUEST
      ? preservedGuestState
      : normalizeRuntimeState(createDefaultState());
    lastSetupAction = null;
    setSyncStatus(CLOUD_SYNC_STATUSES.CREATING);

    migrationPromise = (async () => {
      const result = await cloudRepository.createCloudLearningState(
        stateToCreate,
        { expectedUserId: identity.userId }
      );
      if (!isSamePendingIdentity(identity)) return { ok: false, status: "stale" };

      if (result.ok && result.status === CLOUD_LEARNING_STATE_STATUSES.CREATED) {
        activateCreatedCloudState(result.state, result.revision, action);
        return result;
      }
      if (result.status === CLOUD_LEARNING_STATE_STATUSES.ALREADY_EXISTS) {
        return loadExistingStateAfterConflict(identity);
      }

      migrationPromise = null;
      setSyncStatus(CLOUD_SYNC_STATUSES.SETUP_ERROR);
      return result;
    })().catch(() => {
      if (isSamePendingIdentity(identity)) {
        migrationPromise = null;
        setSyncStatus(CLOUD_SYNC_STATUSES.SETUP_ERROR);
      }
      return { ok: false, status: CLOUD_LEARNING_STATE_STATUSES.ERROR };
    });
    return migrationPromise;
  }

  async function loadExistingStateAfterConflict(identity) {
    const result = await cloudRepository.loadCloudLearningState();
    if (!isSamePendingIdentity(identity)) return { ok: false, status: "stale" };
    if (result.ok && result.status === CLOUD_LEARNING_STATE_STATUSES.FOUND) {
      activateCreatedCloudState(result.state, result.revision, "loaded-existing");
      return result;
    }
    migrationPromise = null;
    setSyncStatus(CLOUD_SYNC_STATUSES.SETUP_ERROR);
    return result;
  }

  function activateCreatedCloudState(state, revision, action) {
    if (!isValidRevision(revision)) {
      migrationPromise = null;
      setSyncStatus(CLOUD_SYNC_STATUSES.SETUP_ERROR);
      return;
    }
    source = LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD;
    cloudRowConfirmed = true;
    cloudRevision = revision;
    conflictRemote = null;
    currentState = normalizeRuntimeState(state);
    pendingMigration = null;
    migrationPromise = null;
    lastSetupAction = action;
    setSyncStatus(CLOUD_SYNC_STATUSES.CONNECTED);
    notifyRuntimeStateChange();
  }

  function isCurrentPendingMigration() {
    return source === LEARNING_STATE_SOURCES.PENDING_MIGRATION &&
      !cloudRowConfirmed &&
      pendingMigration !== null &&
      currentUserId === pendingMigration.userId &&
      generation === pendingMigration.generation;
  }

  function isSamePendingIdentity(identity) {
    return isCurrentPendingMigration() &&
      identity.userId === pendingMigration.userId &&
      identity.generation === pendingMigration.generation;
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

  function reloadCloudLearningStateAfterConflict() {
    if (conflictReloadPromise) return conflictReloadPromise;
    if (
      source !== LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD ||
      !cloudRowConfirmed ||
      syncStatus !== CLOUD_SYNC_STATUSES.CONFLICT ||
      !currentUserId
    ) {
      return Promise.resolve({ ok: false, status: "stale" });
    }

    const identity = { generation, userId: currentUserId };
    conflictReloadPromise = (async () => {
      onStatusChange(getStatus());
      const result = await cloudRepository.loadCloudLearningState();
      if (!isCurrentConflictIdentity(identity)) return { ok: false, status: "stale" };
      if (result.ok && result.status === CLOUD_LEARNING_STATE_STATUSES.FOUND && isValidRevision(result.revision)) {
        currentState = normalizeRuntimeState(result.state);
        cloudRevision = result.revision;
        conflictRemote = null;
        conflictReloadPromise = null;
        setSyncStatus(CLOUD_SYNC_STATUSES.CONNECTED);
        notifyRuntimeStateChange();
        return result;
      }
      conflictReloadPromise = null;
      onStatusChange(getStatus());
      return result;
    })().catch(() => {
      if (isCurrentConflictIdentity(identity)) {
        conflictReloadPromise = null;
        onStatusChange(getStatus());
      }
      return { ok: false, status: CLOUD_LEARNING_STATE_STATUSES.ERROR };
    });
    return conflictReloadPromise;
  }

  function isCurrentConflictIdentity(identity) {
    return isCurrentCloudIdentity(identity) && syncStatus === CLOUD_SYNC_STATUSES.CONFLICT;
  }

  function notifyRuntimeStateChange() {
    onRuntimeStateChange(currentState, getStatus());
  }

  async function flushCloudSaves() {
    while (cloudSaveInFlight) {
      await cloudSaveInFlight;
    }
    if (cloudPendingLatest && !cloudRetryPaused) {
      drainCloudSaves();
      while (cloudSaveInFlight) {
        await cloudSaveInFlight;
      }
    }
  }

  function destroy() {
    generation += 1;
    discardPendingCloudSave();
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
    persistState,
    saveGuestProgressToAccount,
    startCloudLearningFromZero,
    reloadCloudLearningStateAfterConflict
  });
}

function isValidRevision(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function normalizePersistenceIntent(intent) {
  return intent === PERSISTENCE_INTENTS.CLOUD_DEFERRED
    ? PERSISTENCE_INTENTS.CLOUD_DEFERRED
    : PERSISTENCE_INTENTS.IMMEDIATE;
}

function isSameIdentity(left, right) {
  return left?.generation === right?.generation && left?.userId === right?.userId;
}

function isMeaningfulLearningRecord(record) {
  if (!record || typeof record !== "object") return false;
  if (["review", "remembered"].includes(record.status)) return true;
  if ([record.answerCount, record.correctCount, record.errorCount, record.roundsEntered]
    .some((value) => Number.isInteger(value) && value > 0)) return true;
  if (typeof record.lastAnsweredAt === "string" && record.lastAnsweredAt) return true;
  if (typeof record.reviewSince === "string" && record.reviewSince) return true;
  return Array.isArray(record.enteredRoundIds) && record.enteredRoundIds.length > 0;
}

function isMeaningfulActiveQuestion(question) {
  if (!question || typeof question !== "object") return false;
  if (question.phase === "graded" || question.result) return true;
  return Array.isArray(question.selectedGroupIds) && question.selectedGroupIds.length > 0;
}

function hasMeaningfulRoundProgress(round) {
  if (!round || typeof round !== "object") return false;
  if ([round.attemptCount, round.correctAttemptCount]
    .some((value) => Number.isInteger(value) && value > 0)) return true;
  const progress = round.progressByWord;
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return false;
  return Object.values(progress).some((item) => item && typeof item === "object" && (
    item.hasBeenShown === true ||
    item.mastered === true ||
    item.everWrong === true ||
    item.everChoseReview === true ||
    item.masteredViaExternalChange === true ||
    (item.firstAttemptCorrect !== null && item.firstAttemptCorrect !== undefined) ||
    (item.firstDecision !== null && item.firstDecision !== undefined) ||
    (Number.isInteger(item.attemptCount) && item.attemptCount > 0) ||
    (Number.isInteger(item.correctCount) && item.correctCount > 0) ||
    (Number.isInteger(item.errorCount) && item.errorCount > 0)
  ));
}

function requireFunction(value, label) {
  if (typeof value !== "function") {
    throw new TypeError(`${label} 必须是函数。`);
  }
}
