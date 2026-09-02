import assert from "node:assert/strict";
import test from "node:test";

import { AUTH_STATUSES } from "../js/core/auth-service.js";
import {
  CLOUD_SYNC_STATUSES,
  createLearningStateRuntime,
  LEARNING_STATE_SOURCES
} from "../js/core/learning-state-runtime.js";

test("guest initialization and persistence use the existing local store", () => {
  const fixture = createFixture();
  assert.equal(fixture.runtime.getState(), fixture.guestState);
  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.GUEST);

  const changed = learningState("guest-change");
  fixture.runtime.persistState(changed);
  assert.deepEqual(fixture.savedGuestStates, [changed]);
  assert.equal(fixture.cloud.calls.update.length, 0);
});

test("cloud found switches runtime without overwriting guest storage and logout restores guest", async () => {
  const cloudState = learningState("cloud-a");
  const fixture = createFixture({ rows: { a: cloudState } });

  await authenticate(fixture, "a");
  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD);
  assert.equal(fixture.runtime.getState().label, "cloud-a");
  assert.deepEqual(fixture.savedGuestStates, []);

  await becomeGuest(fixture);
  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.GUEST);
  assert.equal(fixture.runtime.getState().label, "guest");
  assert.deepEqual(fixture.savedGuestStates, []);
});

test("switching between A and B never exposes the other account state", async () => {
  const fixture = createFixture({
    rows: { a: learningState("cloud-a"), b: learningState("cloud-b") }
  });
  await authenticate(fixture, "a");
  assert.equal(fixture.runtime.getState().label, "cloud-a");
  await becomeGuest(fixture);
  assert.equal(fixture.runtime.getState().label, "guest");
  await authenticate(fixture, "b");
  assert.equal(fixture.runtime.getState().label, "cloud-b");
  await becomeGuest(fixture);
  await authenticate(fixture, "a");
  assert.equal(fixture.runtime.getState().label, "cloud-a");
});

test("missing cloud row enters pending migration and keeps learning in guest storage", async () => {
  const fixture = createFixture({ rows: {} });
  await authenticate(fixture, "new-user");

  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.PENDING_MIGRATION);
  assert.equal(fixture.runtime.getStatus().syncStatus, CLOUD_SYNC_STATUSES.PENDING_MIGRATION);
  const changed = learningState("pending-guest-change");
  fixture.runtime.persistState(changed);

  assert.equal(fixture.savedGuestStates.at(-1).label, "pending-guest-change");
  assert.equal(fixture.cloud.calls.create, 0);
  assert.equal(fixture.cloud.calls.update.length, 0);
});

test("authenticated cloud saves update only cloud and never guest storage", async () => {
  const fixture = createFixture({ rows: { a: learningState("cloud-a") } });
  await authenticate(fixture, "a");
  const changed = learningState("cloud-a-change");
  fixture.runtime.persistState(changed);
  await fixture.runtime.flushCloudSaves();

  assert.equal(fixture.savedGuestStates.length, 0);
  assert.equal(fixture.cloud.calls.update.length, 1);
  assert.equal(fixture.cloud.calls.update[0].state.label, "cloud-a-change");
  assert.equal(fixture.cloud.calls.update[0].guard.expectedUserId, "a");
});

test("an update missing its row never inserts and returns to pending guest state", async () => {
  const fixture = createFixture({
    rows: { a: learningState("cloud-a") },
    updateResults: [{ ok: false, status: "not-found" }]
  });
  await authenticate(fixture, "a");
  fixture.runtime.persistState(learningState("cloud-change"));
  await fixture.runtime.flushCloudSaves();

  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.PENDING_MIGRATION);
  assert.equal(fixture.runtime.getState().label, "guest");
  assert.equal(fixture.cloud.calls.create, 0);
  assert.equal(fixture.cloud.calls.update.length, 1);
});

test("cloud and network errors preserve guest state and do not write remotely", async () => {
  const fixture = createFixture({ loadError: true });
  await authenticate(fixture, "a");

  assert.equal(fixture.runtime.getState().label, "guest");
  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.GUEST);
  assert.equal(fixture.runtime.getStatus().syncStatus, CLOUD_SYNC_STATUSES.UNAVAILABLE);
  assert.equal(fixture.cloud.calls.update.length, 0);
  assert.equal(fixture.savedGuestStates.length, 0);
});

test("session restore uses the same found and not-found boundaries", async () => {
  const found = createFixture({ rows: { a: learningState("restored-a") } });
  await authenticate(found, "a");
  assert.equal(found.runtime.getState().label, "restored-a");

  const missing = createFixture({ rows: {} });
  await authenticate(missing, "a");
  assert.equal(missing.runtime.getState().label, "guest");
  assert.equal(missing.runtime.getStatus().source, LEARNING_STATE_SOURCES.PENDING_MIGRATION);
});

test("one auth subscription and duplicate authenticated events cause one cloud load", async () => {
  const fixture = createFixture({ rows: { a: learningState("cloud-a") } });
  const auth = createAuthEmitter(fixture.cloud);
  fixture.runtime.connectAuthService(auth);
  fixture.runtime.connectAuthService(auth);
  assert.equal(auth.subscriptionCount, 1);

  await Promise.all([
    auth.emit(authenticated("a")),
    auth.emit(authenticated("a"))
  ]);
  assert.equal(fixture.cloud.calls.load.length, 1);
});

test("stale A save cannot run as B and its completion cannot replace B state", async () => {
  let finishSave;
  const delayedSave = new Promise((resolve) => { finishSave = resolve; });
  const fixture = createFixture({
    rows: { a: learningState("cloud-a"), b: learningState("cloud-b") },
    updateResults: [delayedSave]
  });
  await authenticate(fixture, "a");
  fixture.runtime.persistState(learningState("delayed-a"));
  await waitFor(() => fixture.cloud.calls.update.length === 1);
  await authenticate(fixture, "b");
  finishSave({ ok: true, status: "updated" });
  await fixture.runtime.flushCloudSaves();

  assert.equal(fixture.cloud.calls.update[0].guard.expectedUserId, "a");
  assert.equal(fixture.runtime.getState().label, "cloud-b");
  assert.equal(fixture.runtime.getStatus().userId, "b");
});

test("switching identities restores guest before the next cloud load can finish", async () => {
  let finishLoad;
  const fixture = createFixture({ rows: { a: learningState("cloud-a") } });
  await authenticate(fixture, "a");
  fixture.cloud.setLoadOverride(new Promise((resolve) => { finishLoad = resolve; }));
  const switching = authenticate(fixture, "b");

  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.GUEST);
  assert.equal(fixture.runtime.getState().label, "guest");
  fixture.runtime.persistState(learningState("guest-during-switch"));
  assert.equal(fixture.savedGuestStates.at(-1).label, "guest-during-switch");
  assert.equal(fixture.cloud.calls.update.length, 0);

  finishLoad({ ok: true, status: "found", state: learningState("cloud-b") });
  await switching;
  assert.equal(fixture.runtime.getState().label, "cloud-b");
});

test("logout while a save is pending cannot replace or persist over guest state", async () => {
  let finishSave;
  const delayedSave = new Promise((resolve) => { finishSave = resolve; });
  const fixture = createFixture({
    rows: { a: learningState("cloud-a") },
    updateResults: [delayedSave]
  });
  await authenticate(fixture, "a");
  fixture.runtime.persistState(learningState("delayed-a"));
  await waitFor(() => fixture.cloud.calls.update.length === 1);
  await becomeGuest(fixture);
  finishSave({ ok: true, status: "updated" });
  await fixture.runtime.flushCloudSaves();

  assert.equal(fixture.runtime.getState().label, "guest");
  assert.equal(fixture.savedGuestStates.length, 0);
});

function createFixture(options = {}) {
  const guestState = learningState("guest");
  const savedGuestStates = [];
  const cloud = createCloudRepositoryMock(options);
  const runtimeChanges = [];
  const statusChanges = [];
  const runtime = createLearningStateRuntime({
    guestState,
    cloudRepository: cloud.repository,
    saveGuestState(state) {
      savedGuestStates.push(state);
      return state;
    },
    normalizeRuntimeState: (state) => structuredClone(state),
    onRuntimeStateChange(state, status) {
      runtimeChanges.push({ state, status });
    },
    onStatusChange(status) {
      statusChanges.push(status);
    }
  });
  return { cloud, guestState, runtime, runtimeChanges, savedGuestStates, statusChanges };
}

function createCloudRepositoryMock({ rows = {}, loadError = false, updateResults = [] } = {}) {
  let currentUserId = null;
  let loadOverride = null;
  const calls = { load: [], update: [], create: 0 };
  return {
    calls,
    setCurrentUserId(userId) { currentUserId = userId; },
    setLoadOverride(result) { loadOverride = result; },
    repository: {
      async loadCloudLearningState() {
        calls.load.push(currentUserId);
        if (loadOverride) {
          const result = await loadOverride;
          loadOverride = null;
          return result;
        }
        if (loadError) return { ok: false, status: "error" };
        const state = rows[currentUserId];
        return state
          ? { ok: true, status: "found", state }
          : { ok: true, status: "not-found" };
      },
      async updateCloudLearningState(state, guard) {
        calls.update.push({ state, guard });
        const result = updateResults.shift();
        return result ? await result : { ok: true, status: "updated", state };
      },
      async createCloudLearningState() {
        calls.create += 1;
        return { ok: true, status: "created" };
      }
    }
  };
}

function authenticated(id) {
  return { status: AUTH_STATUSES.AUTHENTICATED, user: { id } };
}

function guest() {
  return { status: AUTH_STATUSES.GUEST, user: null };
}

function authenticate(fixture, userId) {
  fixture.cloud.setCurrentUserId(userId);
  return fixture.runtime.handleAuthState(authenticated(userId));
}

function becomeGuest(fixture) {
  fixture.cloud.setCurrentUserId(null);
  return fixture.runtime.handleAuthState(guest());
}

function learningState(label) {
  return {
    label,
    schemaVersion: 1,
    learning: { byWordKey: {} },
    practice: { mode: "random", activeQuestion: null, freeAttemptCount: 0, reviewQueue: [] },
    rounds: { current: null, lastCompletedSummary: null }
  };
}

function createAuthEmitter(cloud) {
  const listeners = new Set();
  return {
    subscriptionCount: 0,
    subscribe(listener) {
      this.subscriptionCount += 1;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async emit(state) {
      cloud.setCurrentUserId(state.user?.id ?? null);
      await Promise.all([...listeners].map((listener) => listener(state)));
    }
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
}
