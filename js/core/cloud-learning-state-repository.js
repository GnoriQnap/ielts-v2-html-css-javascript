import {
  createDefaultAppState,
  normalizeAppState,
  SCHEMA_VERSION
} from "./storage.js";
import { getSupabaseClient } from "./supabase-client.js?v=10.1";

export const CLOUD_LEARNING_STATE_TABLE = "user_learning_states";

export const CLOUD_LEARNING_STATE_STATUSES = Object.freeze({
  FOUND: "found",
  NOT_FOUND: "not-found",
  CREATED: "created",
  UPDATED: "updated",
  CONFLICT: "conflict",
  ALREADY_EXISTS: "already-exists",
  IDENTITY_CHANGED: "identity-changed",
  UNAUTHENTICATED: "unauthenticated",
  ERROR: "error"
});

export function createCloudLearningSnapshot(applicationState) {
  const defaults = createDefaultAppState();
  const state = isPlainObject(applicationState) ? applicationState : defaults;
  const practice = isPlainObject(state.practice) ? state.practice : defaults.practice;
  const rounds = isPlainObject(state.rounds) ? state.rounds : defaults.rounds;

  return clonePlain({
    schemaVersion: Number.isInteger(state.schemaVersion)
      ? state.schemaVersion
      : SCHEMA_VERSION,
    learning: isPlainObject(state.learning) ? state.learning : defaults.learning,
    practice: {
      mode: practice.mode ?? defaults.practice.mode,
      activeQuestion: practice.activeQuestion ?? null,
      freeAttemptCount: practice.freeAttemptCount ?? 0,
      reviewQueue: Array.isArray(practice.reviewQueue) ? practice.reviewQueue : []
    },
    rounds: {
      current: rounds.current ?? null,
      lastCompletedSummary: rounds.lastCompletedSummary ?? null
    }
  });
}

export function normalizeCloudLearningSnapshot(candidate, normalizationContext = {}) {
  const normalized = normalizeAppState(candidate, {
    defaultState: createDefaultAppState(),
    validWordKeys: normalizationContext.validWordKeys ?? new Set(),
    validGroupIds: normalizationContext.validGroupIds ?? new Set(),
    correctGroupIdsByWordKey: normalizationContext.correctGroupIdsByWordKey ?? new Map()
  });
  return createCloudLearningSnapshot(normalized);
}

export function createCloudLearningStateRepository(options = {}) {
  const {
    getClient = getSupabaseClient,
    normalizationContext = {},
    getNormalizationContext = () => normalizationContext
  } = options;

  async function loadCloudLearningState() {
    const auth = await getAuthenticatedContext(getClient, "load");
    if (!auth.ok) return auth.result;

    try {
      return await loadAuthenticatedRow(auth, getNormalizationContext(), "load");
    } catch (error) {
      return createOperationError("load", error);
    }
  }

  async function createCloudLearningState(applicationState, guard = {}) {
    const auth = await getAuthenticatedContext(getClient, "create");
    if (!auth.ok) return auth.result;
    if (hasIdentityChanged(auth.userId, guard.expectedUserId)) {
      return { ok: false, status: CLOUD_LEARNING_STATE_STATUSES.IDENTITY_CHANGED };
    }
    const activeNormalizationContext = getNormalizationContext();
    const snapshot = normalizeCloudLearningSnapshot(
      createCloudLearningSnapshot(applicationState),
      activeNormalizationContext
    );

    try {
      const { data, error } = await auth.client
        .from(CLOUD_LEARNING_STATE_TABLE)
        .insert({ user_id: auth.userId, state: snapshot, revision: 1 })
        .select("state, updated_at, revision")
        .single();

      if (isUniqueConflict(error)) {
        return { ok: false, status: CLOUD_LEARNING_STATE_STATUSES.ALREADY_EXISTS };
      }
      if (error) return createOperationError("create", error);
      if (!isValidRevision(data?.revision)) {
        return createInvalidRevisionError("create");
      }
      return {
        ok: true,
        status: CLOUD_LEARNING_STATE_STATUSES.CREATED,
        state: normalizeCloudLearningSnapshot(data?.state ?? snapshot, activeNormalizationContext),
        updatedAt: typeof data?.updated_at === "string" ? data.updated_at : null,
        revision: data.revision
      };
    } catch (error) {
      return createOperationError("create", error);
    }
  }

  async function updateCloudLearningState(applicationState, guard = {}) {
    if (!isValidRevision(guard.expectedRevision)) {
      return createInvalidRevisionError("update");
    }
    const auth = await getAuthenticatedContext(getClient, "update");
    if (!auth.ok) return auth.result;
    if (hasIdentityChanged(auth.userId, guard.expectedUserId)) {
      return { ok: false, status: CLOUD_LEARNING_STATE_STATUSES.IDENTITY_CHANGED };
    }
    const activeNormalizationContext = getNormalizationContext();
    const snapshot = normalizeCloudLearningSnapshot(
      createCloudLearningSnapshot(applicationState),
      activeNormalizationContext
    );

    try {
      const { data, error } = await auth.client
        .from(CLOUD_LEARNING_STATE_TABLE)
        .update({ state: snapshot, revision: guard.expectedRevision + 1 })
        .eq("user_id", auth.userId)
        .eq("revision", guard.expectedRevision)
        .select("state, updated_at, revision");

      if (error) return createOperationError("update", error);
      const rows = normalizeReturnedRows(data);
      if (rows.length === 0) {
        return await classifyEmptyUpdate(auth, guard, getNormalizationContext);
      }
      if (rows.length !== 1) return createOperationError("update", { code: "unexpected_row_count" });
      const row = rows[0];
      if (!isValidRevision(row.revision) || row.revision !== guard.expectedRevision + 1) {
        return createInvalidRevisionError("update");
      }
      return {
        ok: true,
        status: CLOUD_LEARNING_STATE_STATUSES.UPDATED,
        state: normalizeCloudLearningSnapshot(row.state, activeNormalizationContext),
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
        revision: row.revision
      };
    } catch (error) {
      return createOperationError("update", error);
    }
  }

  return Object.freeze({
    loadCloudLearningState,
    createCloudLearningState,
    updateCloudLearningState
  });
}

async function loadAuthenticatedRow(auth, normalizationContext, operation) {
  const { data, error } = await auth.client
    .from(CLOUD_LEARNING_STATE_TABLE)
    .select("state, updated_at, revision")
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (error) return createOperationError(operation, error);
  const rows = normalizeReturnedRows(data);
  if (rows.length === 0) return { ok: true, status: CLOUD_LEARNING_STATE_STATUSES.NOT_FOUND };
  if (rows.length !== 1) return createOperationError(operation, { code: "unexpected_row_count" });
  const row = rows[0];
  if (!isValidRevision(row.revision)) return createInvalidRevisionError(operation);
  return {
    ok: true,
    status: CLOUD_LEARNING_STATE_STATUSES.FOUND,
    state: normalizeCloudLearningSnapshot(row.state, normalizationContext),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    revision: row.revision
  };
}

function normalizeReturnedRows(data) {
  if (data === null || data === undefined) return [];
  return Array.isArray(data) ? data : [data];
}

async function classifyEmptyUpdate(auth, guard, getNormalizationContext) {
  const currentAuth = await getAuthenticatedContext(() => auth.client, "update-diagnostic");
  if (!currentAuth.ok) return currentAuth.result;
  if (
    currentAuth.userId !== auth.userId ||
    hasIdentityChanged(currentAuth.userId, guard.expectedUserId)
  ) {
    return { ok: false, status: CLOUD_LEARNING_STATE_STATUSES.IDENTITY_CHANGED };
  }

  try {
    const current = await loadAuthenticatedRow(
      currentAuth,
      getNormalizationContext(),
      "update-diagnostic"
    );
    if (!current.ok) return current;
    if (current.status === CLOUD_LEARNING_STATE_STATUSES.NOT_FOUND) {
      return { ok: false, status: CLOUD_LEARNING_STATE_STATUSES.NOT_FOUND };
    }
    if (current.revision !== guard.expectedRevision) {
      return {
        ok: false,
        status: CLOUD_LEARNING_STATE_STATUSES.CONFLICT,
        state: current.state,
        updatedAt: current.updatedAt,
        revision: current.revision,
        expectedRevision: guard.expectedRevision
      };
    }
    return createOperationError("update", { code: "no_matching_row" });
  } catch (error) {
    return createOperationError("update-diagnostic", error);
  }
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
        result: { ok: false, status: CLOUD_LEARNING_STATE_STATUSES.UNAUTHENTICATED }
      };
    }
    if (error) {
      return { ok: false, result: createOperationError(operation, error) };
    }
    if (!data?.user?.id) {
      return {
        ok: false,
        result: { ok: false, status: CLOUD_LEARNING_STATE_STATUSES.UNAUTHENTICATED }
      };
    }
    return { ok: true, client, userId: data.user.id };
  } catch (error) {
    return { ok: false, result: createOperationError(operation, error) };
  }
}

function createOperationError(operation, error = null) {
  return {
    ok: false,
    status: CLOUD_LEARNING_STATE_STATUSES.ERROR,
    error: {
      operation,
      code: safeErrorCode(error)
    }
  };
}

function createInvalidRevisionError(operation) {
  return createOperationError(operation, { code: "invalid_revision" });
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

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}
