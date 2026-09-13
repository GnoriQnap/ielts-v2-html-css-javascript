import { vocabularyData } from "../data/vocabulary.js";
import { validateCustomVocabularySnapshot } from "./custom-vocabulary-snapshot.js";
import { getSupabaseClient } from "./supabase-client.js?v=10.1";

export const CLOUD_CUSTOM_VOCABULARY_TABLE = "user_custom_vocabularies";

export const CLOUD_CUSTOM_VOCABULARY_STATUSES = Object.freeze({
  FOUND: "found",
  NOT_FOUND: "not-found",
  CREATED: "created",
  UPDATED: "updated",
  CONFLICT: "conflict",
  ALREADY_EXISTS: "already-exists",
  IDENTITY_CHANGED: "identity-changed",
  UNAUTHENTICATED: "unauthenticated",
  INVALID_SNAPSHOT: "invalid-snapshot",
  INVALID_REMOTE_DATA: "invalid-remote-data",
  ERROR: "error"
});

export function createCloudCustomVocabularyRepository(options = {}) {
  const {
    getClient = getSupabaseClient,
    officialBaseline = vocabularyData
  } = options;

  async function loadCustomVocabulary() {
    const auth = await getAuthenticatedContext(getClient, "load");
    if (!auth.ok) return auth.result;

    try {
      const result = await loadAuthenticatedRow(auth, officialBaseline, "load");
      const currentIdentity = await confirmIdentity(auth, null, "load");
      return currentIdentity.ok ? result : currentIdentity.result;
    } catch (error) {
      return createOperationError("load", error);
    }
  }

  async function createCustomVocabulary(candidate, guard = {}) {
    const auth = await getAuthenticatedContext(getClient, "create");
    if (!auth.ok) return auth.result;
    if (hasIdentityChanged(auth.userId, guard.expectedUserId)) {
      return identityChanged();
    }
    const validation = validateLocalSnapshot(candidate, officialBaseline, "create");
    if (!validation.ok) return validation.result;

    try {
      const { data, error } = await auth.client
        .from(CLOUD_CUSTOM_VOCABULARY_TABLE)
        .insert({
          user_id: auth.userId,
          vocabulary: validation.snapshot,
          revision: 1
        })
        .select("vocabulary, updated_at, revision")
        .single();

      const currentIdentity = await confirmIdentity(auth, guard.expectedUserId, "create");
      if (!currentIdentity.ok) return currentIdentity.result;
      if (isUniqueConflict(error)) {
        return {
          ok: false,
          status: CLOUD_CUSTOM_VOCABULARY_STATUSES.ALREADY_EXISTS,
          userId: auth.userId
        };
      }
      if (error) return createOperationError("create", error, auth.userId);
      if (!isValidRevision(data?.revision) || data.revision !== 1) {
        return createInvalidRevisionError("create", auth.userId);
      }
      const remote = validateRemoteSnapshot(data?.vocabulary, officialBaseline, "create", auth.userId);
      if (!remote.ok) return remote.result;
      return {
        ok: true,
        status: CLOUD_CUSTOM_VOCABULARY_STATUSES.CREATED,
        userId: auth.userId,
        snapshot: remote.snapshot,
        updatedAt: normalizeUpdatedAt(data?.updated_at),
        revision: data.revision
      };
    } catch (error) {
      return createOperationError("create", error, auth.userId);
    }
  }

  async function updateCustomVocabulary(candidate, guard = {}) {
    const auth = await getAuthenticatedContext(getClient, "update");
    if (!auth.ok) return auth.result;
    if (hasIdentityChanged(auth.userId, guard.expectedUserId)) {
      return identityChanged();
    }
    if (!isValidRevision(guard.expectedRevision)) {
      return createInvalidRevisionError("update", auth.userId);
    }
    const validation = validateLocalSnapshot(candidate, officialBaseline, "update", auth.userId);
    if (!validation.ok) return validation.result;

    try {
      const { data, error } = await auth.client
        .from(CLOUD_CUSTOM_VOCABULARY_TABLE)
        .update({
          vocabulary: validation.snapshot,
          revision: guard.expectedRevision + 1
        })
        .eq("user_id", auth.userId)
        .eq("revision", guard.expectedRevision)
        .select("vocabulary, updated_at, revision");

      const currentIdentity = await confirmIdentity(auth, guard.expectedUserId, "update");
      if (!currentIdentity.ok) return currentIdentity.result;
      if (error) return createOperationError("update", error, auth.userId);
      const rows = normalizeReturnedRows(data);
      if (rows.length === 0) {
        return await classifyEmptyUpdate(auth, guard, officialBaseline);
      }
      if (rows.length !== 1) {
        return createOperationError("update", { code: "unexpected_row_count" }, auth.userId);
      }
      const row = rows[0];
      if (!isValidRevision(row.revision) || row.revision !== guard.expectedRevision + 1) {
        return createInvalidRevisionError("update", auth.userId);
      }
      const remote = validateRemoteSnapshot(row.vocabulary, officialBaseline, "update", auth.userId);
      if (!remote.ok) return remote.result;
      return {
        ok: true,
        status: CLOUD_CUSTOM_VOCABULARY_STATUSES.UPDATED,
        userId: auth.userId,
        snapshot: remote.snapshot,
        updatedAt: normalizeUpdatedAt(row.updated_at),
        revision: row.revision
      };
    } catch (error) {
      return createOperationError("update", error, auth.userId);
    }
  }

  return Object.freeze({
    loadCustomVocabulary,
    createCustomVocabulary,
    updateCustomVocabulary
  });
}

async function loadAuthenticatedRow(auth, officialBaseline, operation) {
  const { data, error } = await auth.client
    .from(CLOUD_CUSTOM_VOCABULARY_TABLE)
    .select("vocabulary, updated_at, revision")
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (error) return createOperationError(operation, error, auth.userId);
  const rows = normalizeReturnedRows(data);
  if (rows.length === 0) {
    return {
      ok: true,
      status: CLOUD_CUSTOM_VOCABULARY_STATUSES.NOT_FOUND,
      userId: auth.userId
    };
  }
  if (rows.length !== 1) {
    return createOperationError(operation, { code: "unexpected_row_count" }, auth.userId);
  }
  const row = rows[0];
  if (!isValidRevision(row.revision)) {
    return createInvalidRevisionError(operation, auth.userId);
  }
  const remote = validateRemoteSnapshot(row.vocabulary, officialBaseline, operation, auth.userId);
  if (!remote.ok) return remote.result;
  return {
    ok: true,
    status: CLOUD_CUSTOM_VOCABULARY_STATUSES.FOUND,
    userId: auth.userId,
    snapshot: remote.snapshot,
    updatedAt: normalizeUpdatedAt(row.updated_at),
    revision: row.revision
  };
}

async function classifyEmptyUpdate(auth, guard, officialBaseline) {
  const currentIdentity = await confirmIdentity(auth, guard.expectedUserId, "update-diagnostic");
  if (!currentIdentity.ok) return currentIdentity.result;

  try {
    const current = await loadAuthenticatedRow(
      { ...auth, userId: currentIdentity.userId },
      officialBaseline,
      "update-diagnostic"
    );
    const identityAfterLoad = await confirmIdentity(auth, guard.expectedUserId, "update-diagnostic");
    if (!identityAfterLoad.ok) return identityAfterLoad.result;
    if (!current.ok) return current;
    if (current.status === CLOUD_CUSTOM_VOCABULARY_STATUSES.NOT_FOUND) {
      return {
        ok: false,
        status: CLOUD_CUSTOM_VOCABULARY_STATUSES.NOT_FOUND,
        userId: auth.userId
      };
    }
    if (current.revision !== guard.expectedRevision) {
      return {
        ok: false,
        status: CLOUD_CUSTOM_VOCABULARY_STATUSES.CONFLICT,
        userId: auth.userId,
        snapshot: current.snapshot,
        updatedAt: current.updatedAt,
        revision: current.revision,
        expectedRevision: guard.expectedRevision
      };
    }
    return createOperationError("update", { code: "no_matching_row" }, auth.userId);
  } catch (error) {
    return createOperationError("update-diagnostic", error, auth.userId);
  }
}

async function confirmIdentity(auth, expectedUserId, operation) {
  const current = await getAuthenticatedContext(() => auth.client, operation);
  if (!current.ok) return current;
  if (
    current.userId !== auth.userId ||
    hasIdentityChanged(current.userId, expectedUserId)
  ) {
    return { ok: false, result: identityChanged() };
  }
  return { ok: true, userId: current.userId };
}

async function getAuthenticatedContext(getClient, operation) {
  let client;
  try {
    client = await getClient();
  } catch (error) {
    return { ok: false, result: createOperationError(operation, error) };
  }
  if (!client?.auth?.getUser || typeof client.from !== "function") {
    return { ok: false, result: createOperationError(operation) };
  }

  try {
    const { data, error } = await client.auth.getUser();
    if (isMissingSession(error)) {
      return {
        ok: false,
        result: { ok: false, status: CLOUD_CUSTOM_VOCABULARY_STATUSES.UNAUTHENTICATED }
      };
    }
    if (error) {
      return { ok: false, result: createOperationError(operation, error) };
    }
    if (!data?.user?.id) {
      return {
        ok: false,
        result: { ok: false, status: CLOUD_CUSTOM_VOCABULARY_STATUSES.UNAUTHENTICATED }
      };
    }
    return { ok: true, client, userId: data.user.id };
  } catch (error) {
    return { ok: false, result: createOperationError(operation, error) };
  }
}

function validateLocalSnapshot(candidate, officialBaseline, operation, userId = null) {
  const validation = validateCustomVocabularySnapshot(candidate, officialBaseline);
  if (!validation.isValid) {
    return {
      ok: false,
      result: createSnapshotError(
        CLOUD_CUSTOM_VOCABULARY_STATUSES.INVALID_SNAPSHOT,
        operation,
        "invalid_custom_vocabulary_snapshot",
        validation.errors,
        userId
      )
    };
  }
  return { ok: true, snapshot: validation.snapshot };
}

function validateRemoteSnapshot(candidate, officialBaseline, operation, userId) {
  const validation = validateCustomVocabularySnapshot(candidate, officialBaseline);
  if (!validation.isValid) {
    return {
      ok: false,
      result: createSnapshotError(
        CLOUD_CUSTOM_VOCABULARY_STATUSES.INVALID_REMOTE_DATA,
        operation,
        "invalid_remote_snapshot",
        validation.errors,
        userId
      )
    };
  }
  return { ok: true, snapshot: validation.snapshot };
}

function createSnapshotError(status, operation, code, errors, userId) {
  return {
    ok: false,
    status,
    ...(userId ? { userId } : {}),
    error: {
      operation,
      code,
      issues: errors.map((error) => ({ code: error.code }))
    }
  };
}

function createOperationError(operation, error = null, userId = null) {
  return {
    ok: false,
    status: CLOUD_CUSTOM_VOCABULARY_STATUSES.ERROR,
    ...(userId ? { userId } : {}),
    error: {
      operation,
      code: safeErrorCode(error)
    }
  };
}

function createInvalidRevisionError(operation, userId = null) {
  return createOperationError(operation, { code: "invalid_revision" }, userId);
}

function identityChanged() {
  return { ok: false, status: CLOUD_CUSTOM_VOCABULARY_STATUSES.IDENTITY_CHANGED };
}

function normalizeReturnedRows(data) {
  if (data === null || data === undefined) return [];
  return Array.isArray(data) ? data : [data];
}

function normalizeUpdatedAt(value) {
  return typeof value === "string" ? value : null;
}

function isValidRevision(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function safeErrorCode(error) {
  const code = error?.code;
  return typeof code === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(code)
    ? code
    : "unavailable";
}

function isMissingSession(error) {
  return ["AuthSessionMissingError", "session_not_found"].includes(error?.name) ||
    error?.code === "session_not_found";
}

function isUniqueConflict(error) {
  return error?.code === "23505";
}

function hasIdentityChanged(actualUserId, expectedUserId) {
  return typeof expectedUserId === "string" && expectedUserId !== actualUserId;
}
