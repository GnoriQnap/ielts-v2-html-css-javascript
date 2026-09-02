import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOUD_LEARNING_STATE_STATUSES,
  createCloudLearningSnapshot,
  createCloudLearningStateRepository,
  normalizeCloudLearningSnapshot
} from "../js/core/cloud-learning-state-repository.js";
import { createDefaultAppState } from "../js/core/storage.js";

const context = {
  validWordKeys: new Set(["idea"]),
  validGroupIds: new Set([1, 2, 3, 4, 5, 6]),
  correctGroupIdsByWordKey: new Map([["idea", new Set([1])]])
};

test("cloud snapshot contains only the explicit learning boundary", () => {
  const state = createApplicationState();
  state.savedAt = "2026-09-02T00:00:00.000Z";
  state.vocabulary = { private: true };
  state.auth = { access_token: "secret", refresh_token: "secret" };
  state.practice.roundPreparation = true;
  state.practice.roundPreparationSize = 30;
  state.practice.roundPreparationCustom = true;
  state.ui = { modal: "open", search: "idea" };

  const snapshot = createCloudLearningSnapshot(state);

  assert.deepEqual(Object.keys(snapshot), ["schemaVersion", "learning", "practice", "rounds"]);
  assert.deepEqual(Object.keys(snapshot.practice), [
    "mode",
    "activeQuestion",
    "freeAttemptCount",
    "reviewQueue"
  ]);
  assert.deepEqual(Object.keys(snapshot.rounds), ["current", "lastCompletedSummary"]);
  assert.equal("savedAt" in snapshot, false);
  assert.equal("vocabulary" in snapshot, false);
  assert.equal("auth" in snapshot, false);
  assert.equal("roundPreparation" in snapshot.practice, false);
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
});

test("cloud normalization reuses application rules for invalid references and missing fields", () => {
  const normalized = normalizeCloudLearningSnapshot({
    schemaVersion: 0,
    learning: {
      byWordKey: {
        idea: { status: "review", errorCount: 2 },
        missing: { status: "remembered" }
      }
    },
    practice: {
      mode: "unknown",
      activeQuestion: { wordKey: "missing" },
      freeAttemptCount: -1,
      reviewQueue: [{ wordKey: "missing" }]
    }
  }, context);

  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.learning.byWordKey.idea.status, "review");
  assert.equal("missing" in normalized.learning.byWordKey, false);
  assert.equal(normalized.practice.mode, "random");
  assert.equal(normalized.practice.activeQuestion, null);
  assert.equal(normalized.practice.freeAttemptCount, 0);
  assert.deepEqual(normalized.practice.reviewQueue, []);
  assert.deepEqual(normalized.rounds, { current: null, lastCompletedSummary: null });
});

test("unauthenticated operations never access the learning-state table", async () => {
  const mock = createMockSupabase({ userId: null });
  const repository = createRepository(mock.client);

  assert.equal((await repository.loadCloudLearningState()).status, "unauthenticated");
  assert.equal((await repository.createCloudLearningState(createApplicationState())).status, "unauthenticated");
  assert.equal((await repository.updateCloudLearningState(createApplicationState())).status, "unauthenticated");
  assert.equal(mock.calls.from.length, 0);
});

test("load distinguishes a missing row from an error", async () => {
  const missing = createMockSupabase({ userId: "user-a", loadRow: null });
  const missingResult = await createRepository(missing.client).loadCloudLearningState();
  assert.deepEqual(missingResult, { ok: true, status: "not-found" });

  const failed = createMockSupabase({
    userId: "user-a",
    loadError: { code: "42501", message: "raw database text" }
  });
  const failedResult = await createRepository(failed.client).loadCloudLearningState();
  assert.equal(failedResult.ok, false);
  assert.equal(failedResult.status, "error");
  assert.deepEqual(failedResult.error, { operation: "load", code: "42501" });
  assert.equal(JSON.stringify(failedResult).includes("raw database text"), false);
});

test("load normalizes a found cloud row without changing current application state", async () => {
  const localState = createApplicationState();
  const before = structuredClone(localState);
  const mock = createMockSupabase({
    userId: "user-a",
    loadRow: {
      state: { schemaVersion: 1, learning: { byWordKey: { missing: { status: "review" } } } },
      updated_at: "2026-09-02T10:00:00.000Z"
    }
  });

  const result = await createRepository(mock.client).loadCloudLearningState();
  assert.equal(result.status, CLOUD_LEARNING_STATE_STATUSES.FOUND);
  assert.deepEqual(result.state.learning, { byWordKey: {} });
  assert.equal(result.updatedAt, "2026-09-02T10:00:00.000Z");
  assert.deepEqual(localState, before);
});

test("create uses insert with the authenticated user id and never accepts a caller user_id", async () => {
  const state = createApplicationState();
  state.user_id = "user-b";
  const mock = createMockSupabase({ userId: "user-a" });
  const result = await createRepository(mock.client).createCloudLearningState(state);

  assert.equal(result.status, CLOUD_LEARNING_STATE_STATUSES.CREATED);
  assert.equal(mock.calls.insert.length, 1);
  assert.equal(mock.calls.insert[0].user_id, "user-a");
  assert.equal("user_id" in mock.calls.insert[0].state, false);
  assert.equal(mock.calls.upsert, 0);
});

test("create returns already-exists on a unique conflict without an update or upsert", async () => {
  const mock = createMockSupabase({
    userId: "user-a",
    createError: { code: "23505", message: "duplicate key" }
  });
  const result = await createRepository(mock.client)
    .createCloudLearningState(createApplicationState());

  assert.deepEqual(result, { ok: false, status: "already-exists" });
  assert.equal(mock.calls.insert.length, 1);
  assert.equal(mock.calls.update.length, 0);
  assert.equal(mock.calls.upsert, 0);
});

test("update changes only the authenticated row and never inserts a missing row", async () => {
  const found = createMockSupabase({ userId: "user-a" });
  const result = await createRepository(found.client)
    .updateCloudLearningState(createApplicationState());
  assert.equal(result.status, CLOUD_LEARNING_STATE_STATUSES.UPDATED);
  assert.deepEqual(found.calls.eq, [["user_id", "user-a"]]);
  assert.equal(found.calls.insert.length, 0);
  assert.equal(found.calls.upsert, 0);

  const missing = createMockSupabase({ userId: "user-a", updateRow: null });
  const missingResult = await createRepository(missing.client)
    .updateCloudLearningState(createApplicationState());
  assert.deepEqual(missingResult, { ok: false, status: "not-found" });
  assert.equal(missing.calls.insert.length, 0);
});

test("auth and network failures remain structured and do not expose raw messages", async () => {
  const authFailure = createMockSupabase({
    userId: null,
    authError: { code: "network_error", message: "private endpoint detail" }
  });
  const result = await createRepository(authFailure.client).loadCloudLearningState();

  assert.equal(result.status, CLOUD_LEARNING_STATE_STATUSES.ERROR);
  assert.deepEqual(result.error, { operation: "load", code: "network_error" });
  assert.equal(JSON.stringify(result).includes("private endpoint detail"), false);
  assert.equal(authFailure.calls.from.length, 0);
});

function createRepository(client) {
  return createCloudLearningStateRepository({
    getClient: async () => client,
    normalizationContext: context
  });
}

function createApplicationState() {
  const state = createDefaultAppState();
  state.learning.byWordKey.idea = {
    status: "review",
    correctCount: 1,
    errorCount: 2,
    answerCount: 3,
    lastAnsweredAt: "2026-09-02T09:00:00.000Z",
    reviewSince: "2026-09-02T08:00:00.000Z",
    enteredRoundIds: [],
    roundsEntered: 0
  };
  state.practice.freeAttemptCount = 3;
  return state;
}

function createMockSupabase(options = {}) {
  const {
    userId = "user-a",
    authError = null,
    loadRow = undefined,
    loadError = null,
    createRow = undefined,
    createError = null,
    updateRow = undefined,
    updateError = null
  } = options;
  const calls = {
    from: [],
    select: [],
    insert: [],
    update: [],
    eq: [],
    upsert: 0
  };

  const client = {
    calls,
    auth: {
      async getUser() {
        return { data: { user: userId ? { id: userId } : null }, error: authError };
      }
    },
    from(table) {
      calls.from.push(table);
      return createQuery();
    }
  };

  function createQuery() {
    let operation = "load";
    let payload = null;
    const query = {
      select(columns) {
        calls.select.push(columns);
        return query;
      },
      insert(value) {
        operation = "create";
        payload = structuredClone(value);
        calls.insert.push(payload);
        return query;
      },
      update(value) {
        operation = "update";
        payload = structuredClone(value);
        calls.update.push(payload);
        return query;
      },
      upsert() {
        calls.upsert += 1;
        throw new Error("upsert must not be called");
      },
      eq(column, value) {
        calls.eq.push([column, value]);
        return query;
      },
      async maybeSingle() {
        if (operation === "update") {
          const row = updateRow === undefined
            ? { state: payload.state, updated_at: "2026-09-02T11:00:00.000Z" }
            : updateRow;
          return { data: row, error: updateError };
        }
        return { data: loadRow === undefined ? null : loadRow, error: loadError };
      },
      async single() {
        const row = createRow === undefined
          ? { state: payload.state, updated_at: "2026-09-02T10:30:00.000Z" }
          : createRow;
        return { data: row, error: createError };
      }
    };
    return query;
  }

  return { client, calls };
}
