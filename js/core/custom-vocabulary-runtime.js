import { defaultVocabularyData } from "../data/default-vocabulary.js";
import {
  createCustomVocabularySnapshot,
  createEmptyCustomVocabularySnapshot,
  createStableCustomCategoryId,
  detectOfficialVocabularyMutations,
  validateCustomVocabularySnapshot
} from "./custom-vocabulary-snapshot.js";
import { CLOUD_CUSTOM_VOCABULARY_STATUSES } from "./cloud-custom-vocabulary-repository.js";

export const CUSTOM_VOCABULARY_IDENTITY_STORAGE_KEY =
  "ielts_synonym_trainer_custom_vocabulary_identity";
export const CUSTOM_VOCABULARY_IDENTITY_SCHEMA_VERSION = 1;

export const CUSTOM_VOCABULARY_SOURCES = Object.freeze({
  GUEST_LOCAL: "guest-local",
  AUTHENTICATED_CLOUD: "authenticated-cloud",
  PENDING_MIGRATION: "pending-migration",
  CONFLICT: "conflict",
  UNAVAILABLE: "unavailable"
});

export const CUSTOM_VOCABULARY_SYNC_STATUSES = Object.freeze({
  GUEST: "guest",
  LOADING: "loading",
  CONNECTED: "connected",
  PENDING_MIGRATION: "pending-migration",
  GUEST_SNAPSHOT_UNAVAILABLE: "guest-snapshot-unavailable",
  UNAVAILABLE: "unavailable",
  CREATING: "creating",
  SETUP_ERROR: "setup-error",
  SAVING: "saving",
  SAVE_ERROR: "save-error",
  CONFLICT: "conflict"
});

export const CUSTOM_VOCABULARY_MIGRATION_KINDS = Object.freeze({
  MEANINGFUL_GUEST: "meaningful-guest",
  EMPTY_GUEST: "empty-guest",
  GUEST_SNAPSHOT_UNAVAILABLE: "guest-snapshot-unavailable"
});

export const CUSTOM_VOCABULARY_CREATE_ACTIONS = Object.freeze({
  SAVE_GUEST: "save-guest",
  START_EMPTY: "start-empty"
});

export function hasMeaningfulCustomVocabulary(snapshot) {
  return Boolean(
    snapshot &&
    Array.isArray(snapshot.categories) &&
    Array.isArray(snapshot.words) &&
    (snapshot.categories.length > 0 || snapshot.words.length > 0)
  );
}

/**
 * Adapts the legacy full Guest vocabulary to Snapshot V1 without changing the
 * vocabulary cache. Only stable custom-category identity metadata may be saved.
 */
export function createGuestCustomVocabularySnapshot({
  fullVocabulary,
  officialBaseline = defaultVocabularyData,
  officialCompatibility = null,
  storage = globalThis.localStorage,
  storageKey = CUSTOM_VOCABULARY_IDENTITY_STORAGE_KEY,
  randomUUID
} = {}) {
  if (officialCompatibility?.status === "legacy-incompatible") {
    return guestSnapshotFailure("legacy-incompatible", officialCompatibility.errors);
  }
  const mutation = detectOfficialVocabularyMutations(fullVocabulary, officialBaseline);
  if (!mutation.isValid) {
    return guestSnapshotFailure("legacy-incompatible", mutation.errors);
  }

  const officialGroupIds = new Set(
    officialBaseline.vocabulary_list.map(({ group_id: groupId }) => groupId)
  );
  const customGroupIds = fullVocabulary.vocabulary_list
    .map(({ group_id: groupId }) => groupId)
    .filter((groupId) => !officialGroupIds.has(groupId))
    .sort((left, right) => left - right);
  const read = readIdentityMetadata(storage, storageKey);
  const normalized = normalizeIdentityMetadata(read.value, customGroupIds, officialGroupIds);
  const identityByGroupId = { ...normalized.identityByGroupId };
  let generated = false;

  for (const groupId of customGroupIds) {
    if (identityByGroupId[groupId]) continue;
    try {
      identityByGroupId[groupId] = randomUUID === undefined
        ? createStableCustomCategoryId()
        : createStableCustomCategoryId({ randomUUID });
    } catch {
      return guestSnapshotFailure("identity-generation-unavailable", []);
    }
    generated = true;
  }

  const metadata = {
    schemaVersion: CUSTOM_VOCABULARY_IDENTITY_SCHEMA_VERSION,
    customCategoryIdByGroupId: identityByGroupId
  };
  const extracted = createCustomVocabularySnapshot(fullVocabulary, officialBaseline, {
    identityMetadata: metadata
  });
  if (!extracted.ok) {
    return guestSnapshotFailure("guest-snapshot-unavailable", extracted.errors);
  }

  const metadataChanged = read.corrupted || normalized.changed || generated || (
    read.value !== null && JSON.stringify(read.value) !== JSON.stringify(metadata)
  );
  if (metadataChanged && !writeIdentityMetadata(storage, storageKey, metadata)) {
    return guestSnapshotFailure("identity-storage-unavailable", []);
  }

  const metadataStatus = read.corrupted || normalized.corrupted
    ? "identity-rebuilt"
    : generated
      ? "initialized"
      : normalized.changed
        ? "cleaned"
        : "unchanged";
  return {
    ok: true,
    status: "ready",
    snapshot: clonePlain(extracted.snapshot),
    meaningful: hasMeaningfulCustomVocabulary(extracted.snapshot),
    identityMetadata: clonePlain(metadata),
    metadataStatus,
    errors: []
  };
}

export function createCustomVocabularyRuntime({
  guestVocabularyRepository,
  cloudRepository,
  identityStorage = globalThis.localStorage,
  identityStorageKey = CUSTOM_VOCABULARY_IDENTITY_STORAGE_KEY,
  officialBaseline = defaultVocabularyData,
  randomUUID,
  onStatusChange = () => {}
} = {}) {
  requireFunction(guestVocabularyRepository?.getCurrentVocabulary, "Guest vocabulary read");
  requireFunction(cloudRepository?.loadCustomVocabulary, "Cloud vocabulary load");
  requireFunction(cloudRepository?.createCustomVocabulary, "Cloud vocabulary create");
  requireFunction(cloudRepository?.updateCustomVocabulary, "Cloud vocabulary update");

  let source = CUSTOM_VOCABULARY_SOURCES.GUEST_LOCAL;
  let syncStatus = CUSTOM_VOCABULARY_SYNC_STATUSES.GUEST;
  let userId = null;
  let cloudRevision = null;
  let generation = 0;
  let currentSnapshot = null;
  let guestBoundary = null;
  let migrationKind = null;
  let conflictRemote = null;
  let createPromise = null;
  let updatePromise = null;
  let reloadPromise = null;

  function getStatus() {
    return Object.freeze({
      source,
      syncStatus,
      userId,
      cloudRevision,
      generation,
      migrationRequired: source === CUSTOM_VOCABULARY_SOURCES.PENDING_MIGRATION,
      migrationKind,
      meaningfulGuestVocabulary: Boolean(guestBoundary?.meaningful),
      guestSnapshotStatus: guestBoundary?.status ?? null,
      identityMetadataStatus: guestBoundary?.metadataStatus ?? null,
      remoteRevision: conflictRemote?.revision ?? null,
      operationInProgress: Boolean(createPromise || updatePromise || reloadPromise)
    });
  }

  function getSnapshot() {
    return cloneNullable(currentSnapshot);
  }

  function getRemoteConflict() {
    return cloneNullable(conflictRemote);
  }

  function initializeForGuest() {
    generation += 1;
    clearAccountState();
    source = CUSTOM_VOCABULARY_SOURCES.GUEST_LOCAL;
    guestBoundary = readGuestBoundary();
    currentSnapshot = guestBoundary.ok ? clonePlain(guestBoundary.snapshot) : null;
    migrationKind = null;
    setSyncStatus(guestBoundary.ok
      ? CUSTOM_VOCABULARY_SYNC_STATUSES.GUEST
      : CUSTOM_VOCABULARY_SYNC_STATUSES.GUEST_SNAPSHOT_UNAVAILABLE);
    return { ...getStatus(), snapshot: getSnapshot() };
  }

  async function initializeForAuthenticatedUser(expectedUserId) {
    if (!isNonEmptyString(expectedUserId)) {
      return { ok: false, status: "invalid-user" };
    }
    const operation = { generation: ++generation, userId: expectedUserId };
    clearAccountState();
    userId = expectedUserId;
    source = CUSTOM_VOCABULARY_SOURCES.UNAVAILABLE;
    currentSnapshot = null;
    guestBoundary = readGuestBoundary();
    setSyncStatus(CUSTOM_VOCABULARY_SYNC_STATUSES.LOADING);

    let result;
    try {
      result = await cloudRepository.loadCustomVocabulary();
    } catch {
      result = { ok: false, status: CLOUD_CUSTOM_VOCABULARY_STATUSES.ERROR };
    }
    if (!isCurrentIdentity(operation)) return staleResult();
    if (result.userId !== expectedUserId) return staleResult();

    if (result.ok && result.status === CLOUD_CUSTOM_VOCABULARY_STATUSES.FOUND) {
      return activateCloudSnapshot(result, operation);
    }
    if (result.ok && result.status === CLOUD_CUSTOM_VOCABULARY_STATUSES.NOT_FOUND) {
      source = CUSTOM_VOCABULARY_SOURCES.PENDING_MIGRATION;
      currentSnapshot = guestBoundary.ok ? clonePlain(guestBoundary.snapshot) : null;
      migrationKind = getMigrationKind(guestBoundary);
      setSyncStatus(guestBoundary.ok
        ? CUSTOM_VOCABULARY_SYNC_STATUSES.PENDING_MIGRATION
        : CUSTOM_VOCABULARY_SYNC_STATUSES.GUEST_SNAPSHOT_UNAVAILABLE);
      return { ...getStatus(), ok: true, status: "pending-migration" };
    }
    source = CUSTOM_VOCABULARY_SOURCES.UNAVAILABLE;
    currentSnapshot = null;
    cloudRevision = null;
    setSyncStatus(CUSTOM_VOCABULARY_SYNC_STATUSES.UNAVAILABLE);
    return { ...getStatus(), ok: false, status: result.status ?? "error" };
  }

  function switchToGuest() {
    return initializeForGuest();
  }

  function saveGuestToAccount() {
    return createCloudVocabulary(CUSTOM_VOCABULARY_CREATE_ACTIONS.SAVE_GUEST);
  }

  function startEmptyCloudVocabulary() {
    return createCloudVocabulary(CUSTOM_VOCABULARY_CREATE_ACTIONS.START_EMPTY);
  }

  function createCloudVocabulary(action) {
    if (createPromise) return createPromise;
    if (!isCurrentPendingMigration()) return Promise.resolve(staleResult());
    if (action === CUSTOM_VOCABULARY_CREATE_ACTIONS.SAVE_GUEST && !guestBoundary?.ok) {
      return Promise.resolve({ ok: false, status: "guest-snapshot-unavailable" });
    }
    const operation = { generation, userId };
    const snapshot = action === CUSTOM_VOCABULARY_CREATE_ACTIONS.SAVE_GUEST
      ? clonePlain(guestBoundary.snapshot)
      : createEmptyCustomVocabularySnapshot();
    setSyncStatus(CUSTOM_VOCABULARY_SYNC_STATUSES.CREATING);

    createPromise = (async () => {
      let result;
      try {
        result = await cloudRepository.createCustomVocabulary(snapshot, {
          expectedUserId: operation.userId
        });
      } catch {
        result = { ok: false, status: CLOUD_CUSTOM_VOCABULARY_STATUSES.ERROR };
      }
      if (!isCurrentPendingIdentity(operation)) return staleResult();
      if (result.ok && result.status === CLOUD_CUSTOM_VOCABULARY_STATUSES.CREATED) {
        createPromise = null;
        return activateCloudSnapshot(result, operation);
      }
      if (result.status === CLOUD_CUSTOM_VOCABULARY_STATUSES.ALREADY_EXISTS) {
        return loadAfterAlreadyExists(operation);
      }
      createPromise = null;
      setSyncStatus(CUSTOM_VOCABULARY_SYNC_STATUSES.SETUP_ERROR);
      return result;
    })();
    return createPromise;
  }

  async function loadAfterAlreadyExists(operation) {
    let result;
    try {
      result = await cloudRepository.loadCustomVocabulary();
    } catch {
      result = { ok: false, status: CLOUD_CUSTOM_VOCABULARY_STATUSES.ERROR };
    }
    if (!isCurrentPendingIdentity(operation)) return staleResult();
    createPromise = null;
    if (
      result.ok &&
      result.status === CLOUD_CUSTOM_VOCABULARY_STATUSES.FOUND &&
      result.userId === operation.userId
    ) {
      return activateCloudSnapshot(result, operation);
    }
    source = CUSTOM_VOCABULARY_SOURCES.UNAVAILABLE;
    currentSnapshot = null;
    cloudRevision = null;
    migrationKind = null;
    setSyncStatus(CUSTOM_VOCABULARY_SYNC_STATUSES.UNAVAILABLE);
    return result;
  }

  function updateCloudSnapshot(candidate) {
    if (updatePromise || !isWritableCloudState()) {
      return Promise.resolve({ ok: false, status: source === CUSTOM_VOCABULARY_SOURCES.CONFLICT
        ? "conflict-blocked"
        : "stale" });
    }
    const validation = validateCustomVocabularySnapshot(candidate, officialBaseline);
    if (!validation.isValid) {
      return Promise.resolve({
        ok: false,
        status: CLOUD_CUSTOM_VOCABULARY_STATUSES.INVALID_SNAPSHOT,
        errors: clonePlain(validation.errors)
      });
    }
    const operation = { generation, userId, revision: cloudRevision };
    const candidateSnapshot = clonePlain(validation.snapshot);
    currentSnapshot = candidateSnapshot;
    setSyncStatus(CUSTOM_VOCABULARY_SYNC_STATUSES.SAVING);

    updatePromise = (async () => {
      let result;
      try {
        result = await cloudRepository.updateCustomVocabulary(candidateSnapshot, {
          expectedUserId: operation.userId,
          expectedRevision: operation.revision
        });
      } catch {
        result = { ok: false, status: CLOUD_CUSTOM_VOCABULARY_STATUSES.ERROR };
      }
      if (!isCurrentIdentity(operation)) return staleResult();
      updatePromise = null;
      if (result.ok && result.status === CLOUD_CUSTOM_VOCABULARY_STATUSES.UPDATED) {
        return activateCloudSnapshot(result, operation);
      }
      if (result.status === CLOUD_CUSTOM_VOCABULARY_STATUSES.CONFLICT) {
        source = CUSTOM_VOCABULARY_SOURCES.CONFLICT;
        conflictRemote = isValidRevision(result.revision) && result.snapshot
          ? {
              snapshot: clonePlain(result.snapshot),
              revision: result.revision,
              updatedAt: result.updatedAt ?? null
            }
          : null;
        setSyncStatus(CUSTOM_VOCABULARY_SYNC_STATUSES.CONFLICT);
        return result;
      }
      if (result.status === CLOUD_CUSTOM_VOCABULARY_STATUSES.NOT_FOUND) {
        source = CUSTOM_VOCABULARY_SOURCES.PENDING_MIGRATION;
        cloudRevision = null;
        currentSnapshot = guestBoundary?.ok ? clonePlain(guestBoundary.snapshot) : null;
        migrationKind = getMigrationKind(guestBoundary);
        setSyncStatus(CUSTOM_VOCABULARY_SYNC_STATUSES.PENDING_MIGRATION);
        return result;
      }
      setSyncStatus(CUSTOM_VOCABULARY_SYNC_STATUSES.SAVE_ERROR);
      return result;
    })();
    return updatePromise;
  }

  function reloadCloudCustomVocabularyAfterConflict() {
    if (reloadPromise) return reloadPromise;
    if (source !== CUSTOM_VOCABULARY_SOURCES.CONFLICT || !userId) {
      return Promise.resolve(staleResult());
    }
    const operation = { generation, userId };
    reloadPromise = (async () => {
      let result;
      try {
        result = await cloudRepository.loadCustomVocabulary();
      } catch {
        result = { ok: false, status: CLOUD_CUSTOM_VOCABULARY_STATUSES.ERROR };
      }
      if (!isCurrentConflictIdentity(operation)) return staleResult();
      reloadPromise = null;
      if (
        result.ok &&
        result.status === CLOUD_CUSTOM_VOCABULARY_STATUSES.FOUND &&
        result.userId === operation.userId
      ) {
        return activateCloudSnapshot(result, operation);
      }
      setSyncStatus(CUSTOM_VOCABULARY_SYNC_STATUSES.CONFLICT);
      return result;
    })();
    return reloadPromise;
  }

  function readGuestBoundary() {
    try {
      return createGuestCustomVocabularySnapshot({
        fullVocabulary: guestVocabularyRepository.getCurrentVocabulary(),
        officialCompatibility: guestVocabularyRepository.getOfficialCompatibility?.() ?? null,
        officialBaseline,
        storage: identityStorage,
        storageKey: identityStorageKey,
        randomUUID
      });
    } catch {
      return guestSnapshotFailure("guest-snapshot-unavailable", []);
    }
  }

  function activateCloudSnapshot(result, operation) {
    if (!isCurrentIdentity(operation) || result.userId !== operation.userId) {
      return staleResult();
    }
    if (!isValidRevision(result.revision)) {
      source = CUSTOM_VOCABULARY_SOURCES.UNAVAILABLE;
      currentSnapshot = null;
      cloudRevision = null;
      setSyncStatus(CUSTOM_VOCABULARY_SYNC_STATUSES.UNAVAILABLE);
      return { ok: false, status: "invalid-revision" };
    }
    const validation = validateCustomVocabularySnapshot(result.snapshot, officialBaseline);
    if (!validation.isValid) {
      source = CUSTOM_VOCABULARY_SOURCES.UNAVAILABLE;
      currentSnapshot = null;
      cloudRevision = null;
      setSyncStatus(CUSTOM_VOCABULARY_SYNC_STATUSES.UNAVAILABLE);
      return { ok: false, status: "invalid-remote-data" };
    }
    source = CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD;
    currentSnapshot = clonePlain(validation.snapshot);
    cloudRevision = result.revision;
    migrationKind = null;
    conflictRemote = null;
    createPromise = null;
    updatePromise = null;
    reloadPromise = null;
    setSyncStatus(CUSTOM_VOCABULARY_SYNC_STATUSES.CONNECTED);
    return { ...result, snapshot: getSnapshot() };
  }

  function clearAccountState() {
    userId = null;
    cloudRevision = null;
    currentSnapshot = null;
    migrationKind = null;
    conflictRemote = null;
    createPromise = null;
    updatePromise = null;
    reloadPromise = null;
  }

  function isCurrentIdentity(operation) {
    return generation === operation.generation && userId === operation.userId;
  }

  function isCurrentPendingMigration() {
    return source === CUSTOM_VOCABULARY_SOURCES.PENDING_MIGRATION &&
      isNonEmptyString(userId);
  }

  function isCurrentPendingIdentity(operation) {
    return isCurrentPendingMigration() && isCurrentIdentity(operation);
  }

  function isCurrentConflictIdentity(operation) {
    return source === CUSTOM_VOCABULARY_SOURCES.CONFLICT && isCurrentIdentity(operation);
  }

  function isWritableCloudState() {
    return source === CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD &&
      syncStatus !== CUSTOM_VOCABULARY_SYNC_STATUSES.CONFLICT &&
      isNonEmptyString(userId) &&
      isValidRevision(cloudRevision);
  }

  function setSyncStatus(nextStatus) {
    syncStatus = nextStatus;
    onStatusChange(getStatus());
  }

  return Object.freeze({
    getRemoteConflict,
    getSnapshot,
    getStatus,
    initializeForAuthenticatedUser,
    initializeForGuest,
    reloadCloudCustomVocabularyAfterConflict,
    saveGuestToAccount,
    startEmptyCloudVocabulary,
    switchToGuest,
    updateCloudSnapshot
  });
}

function getMigrationKind(guestBoundary) {
  if (!guestBoundary?.ok) {
    return CUSTOM_VOCABULARY_MIGRATION_KINDS.GUEST_SNAPSHOT_UNAVAILABLE;
  }
  return guestBoundary.meaningful
    ? CUSTOM_VOCABULARY_MIGRATION_KINDS.MEANINGFUL_GUEST
    : CUSTOM_VOCABULARY_MIGRATION_KINDS.EMPTY_GUEST;
}

function readIdentityMetadata(storage, storageKey) {
  if (!storage?.getItem) return { value: null, corrupted: false };
  try {
    const serialized = storage.getItem(storageKey);
    if (!serialized) return { value: null, corrupted: false };
    const value = JSON.parse(serialized);
    return { value, corrupted: hasDangerousStructure(value) };
  } catch {
    return { value: null, corrupted: true };
  }
}

function normalizeIdentityMetadata(candidate, customGroupIds, officialGroupIds) {
  const empty = { identityByGroupId: {}, changed: false, corrupted: false };
  if (candidate === null) return empty;
  if (
    hasDangerousStructure(candidate) ||
    !isPlainObject(candidate) ||
    candidate.schemaVersion !== CUSTOM_VOCABULARY_IDENTITY_SCHEMA_VERSION ||
    !isPlainObject(candidate.customCategoryIdByGroupId)
  ) {
    return { ...empty, changed: true, corrupted: true };
  }

  const customSet = new Set(customGroupIds);
  const usedIds = new Set();
  const identityByGroupId = {};
  let changed = false;
  let corrupted = false;
  for (const [rawGroupId, rawCategoryId] of Object.entries(candidate.customCategoryIdByGroupId)) {
    const groupId = Number(rawGroupId);
    const categoryId = typeof rawCategoryId === "string" ? rawCategoryId.toLowerCase() : "";
    if (!Number.isInteger(groupId) || officialGroupIds.has(groupId) || !isUuid(categoryId)) {
      changed = true;
      corrupted = true;
      continue;
    }
    if (!customSet.has(groupId)) {
      changed = true;
      continue;
    }
    if (usedIds.has(categoryId)) {
      changed = true;
      corrupted = true;
      continue;
    }
    usedIds.add(categoryId);
    identityByGroupId[groupId] = categoryId;
    if (rawCategoryId !== categoryId || rawGroupId !== String(groupId)) changed = true;
  }
  return { identityByGroupId, changed, corrupted };
}

function writeIdentityMetadata(storage, storageKey, metadata) {
  if (!storage?.setItem) return false;
  try {
    storage.setItem(storageKey, JSON.stringify(metadata));
    return true;
  } catch {
    return false;
  }
}

function guestSnapshotFailure(status, errors = []) {
  return {
    ok: false,
    status,
    snapshot: null,
    meaningful: false,
    identityMetadata: null,
    metadataStatus: null,
    errors: clonePlain(errors ?? [])
  };
}

function hasDangerousStructure(value, seen = new Set()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return true;
  for (const key of Object.keys(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key) || hasDangerousStructure(value[key], seen)) {
      return true;
    }
  }
  seen.delete(value);
  return false;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isValidRevision(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function staleResult() {
  return { ok: false, status: "stale" };
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
