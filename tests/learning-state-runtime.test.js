import assert from "node:assert/strict";
import test from "node:test";

import { AUTH_STATUSES } from "../js/core/auth-service.js";
import {
  CLOUD_SYNC_STATUSES,
  createLearningStateRuntime,
  LEARNING_STATE_SOURCES,
  PERSISTENCE_INTENTS
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

test("cloud-deferred intent still saves guest state immediately", () => {
  const fixture = createFixture();
  const changed = learningState("guest-selection");

  fixture.runtime.persistState(changed, { intent: PERSISTENCE_INTENTS.CLOUD_DEFERRED });

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
  assert.equal(fixture.runtime.getStatus().cloudRevision, null);
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
  const fixture = createFixture({ rows: {}, guestState: meaningfulState("guest") });
  await authenticate(fixture, "new-user");

  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.PENDING_MIGRATION);
  assert.equal(fixture.runtime.getStatus().syncStatus, CLOUD_SYNC_STATUSES.PENDING_MIGRATION);
  const changed = learningState("pending-guest-change");
  fixture.runtime.persistState(changed);

  assert.equal(fixture.savedGuestStates.at(-1).label, "pending-guest-change");
  assert.equal(fixture.cloud.calls.create, 0);
  assert.equal(fixture.cloud.calls.update.length, 0);
});

test("cloud-deferred intent still saves pending-migration state to guest storage", async () => {
  const fixture = createFixture({ rows: {}, guestState: meaningfulState("guest") });
  await authenticate(fixture, "new-user");
  const changed = learningState("pending-selection");

  fixture.runtime.persistState(changed, { intent: PERSISTENCE_INTENTS.CLOUD_DEFERRED });

  assert.equal(fixture.savedGuestStates.at(-1).label, "pending-selection");
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
  assert.equal(fixture.cloud.calls.update[0].guard.expectedRevision, 1);
  assert.equal(fixture.runtime.getStatus().cloudRevision, 2);
});

test("authenticated cloud defers unsubmitted selection until an immediate snapshot", async () => {
  const fixture = createFixture({ rows: { a: learningState("cloud-a") } });
  await authenticate(fixture, "a");
  const selected = learningState("selected-only");
  selected.practice.activeQuestion = { selectedGroupIds: [4, 7], phase: "answering" };

  fixture.runtime.persistState(selected, { intent: PERSISTENCE_INTENTS.CLOUD_DEFERRED });
  await fixture.runtime.flushCloudSaves();
  assert.equal(fixture.runtime.getState().label, "selected-only");
  assert.equal(fixture.cloud.calls.update.length, 0);
  assert.equal(fixture.runtime.getStatus().cloudRevision, 1);

  const submitted = structuredClone(selected);
  submitted.label = "submitted";
  submitted.practice.activeQuestion.phase = "graded";
  submitted.practice.freeAttemptCount = 1;
  fixture.runtime.persistState(submitted);
  await fixture.runtime.flushCloudSaves();

  assert.equal(fixture.cloud.calls.update.length, 1);
  assert.deepEqual(fixture.cloud.calls.update[0].state.practice.activeQuestion.selectedGroupIds, [4, 7]);
  assert.equal(fixture.cloud.calls.update[0].state.practice.freeAttemptCount, 1);
});

test("bounded cloud saves retain only the latest pending snapshot and read the latest revision", async () => {
  let finishFirst;
  const first = new Promise((resolve) => { finishFirst = resolve; });
  const fixture = createFixture({
    rows: { a: learningState("cloud-a") },
    updateResults: [first]
  });
  await authenticate(fixture, "a");
  fixture.runtime.persistState(learningState("save-a"));
  await waitFor(() => fixture.cloud.calls.update.length === 1);
  fixture.runtime.persistState(learningState("save-b"));
  fixture.runtime.persistState(learningState("save-c"));
  const latest = learningState("save-d");
  latest.learning.byWordKey.idea = { status: "review", answerCount: 3 };
  latest.practice.reviewQueue = [{ wordKey: "idea", dueAttempt: 5 }];
  latest.rounds.current = { id: "round-latest", attemptCount: 3 };
  fixture.runtime.persistState(latest);
  assert.equal(fixture.cloud.calls.update.length, 1);

  finishFirst({ ok: true, status: "updated", revision: 2 });
  await fixture.runtime.flushCloudSaves();

  assert.deepEqual(fixture.cloud.calls.update.map(({ state }) => state.label), ["save-a", "save-d"]);
  assert.deepEqual(fixture.cloud.calls.update.map(({ guard }) => guard.expectedRevision), [1, 2]);
  assert.equal(fixture.cloud.calls.update[1].state.learning.byWordKey.idea.answerCount, 3);
  assert.equal(fixture.cloud.calls.update[1].state.practice.reviewQueue[0].wordKey, "idea");
  assert.equal(fixture.cloud.calls.update[1].state.rounds.current.id, "round-latest");
  assert.equal(fixture.runtime.getStatus().cloudRevision, 3);
});

test("flushCloudSaves waits for both the in-flight and final pending snapshot", async () => {
  let finishFirst;
  let finishLatest;
  const first = new Promise((resolve) => { finishFirst = resolve; });
  const latest = new Promise((resolve) => { finishLatest = resolve; });
  const fixture = createFixture({
    rows: { a: learningState("cloud-a") },
    updateResults: [first, latest]
  });
  await authenticate(fixture, "a");
  fixture.runtime.persistState(learningState("first"));
  await waitFor(() => fixture.cloud.calls.update.length === 1);
  fixture.runtime.persistState(learningState("latest"));

  let flushed = false;
  const flushing = fixture.runtime.flushCloudSaves().then(() => { flushed = true; });
  finishFirst({ ok: true, status: "updated", revision: 2 });
  await waitFor(() => fixture.cloud.calls.update.length === 2);
  assert.equal(flushed, false);
  finishLatest({ ok: true, status: "updated", revision: 3 });
  await flushing;
  assert.equal(flushed, true);
});

test("revision conflict keeps local runtime, stops queued writes, and reloads only on request", async () => {
  const remote = learningState("remote-rev-2");
  const fixture = createFixture({
    rows: { a: learningState("cloud-rev-1") },
    updateResults: [{
      ok: false,
      status: "conflict",
      state: remote,
      revision: 2,
      expectedRevision: 1
    }]
  });
  await authenticate(fixture, "a");
  fixture.runtime.persistState(learningState("local-first"));
  fixture.runtime.persistState(learningState("local-second"));
  await fixture.runtime.flushCloudSaves();

  assert.equal(fixture.runtime.getStatus().syncStatus, CLOUD_SYNC_STATUSES.CONFLICT);
  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD);
  assert.equal(fixture.runtime.getStatus().remoteRevision, 2);
  assert.equal(fixture.runtime.getState().label, "local-second");
  assert.equal(fixture.cloud.calls.update.length, 1);
  assert.equal(fixture.savedGuestStates.length, 0);
  assert.equal(
    fixture.statusChanges.some(({ syncStatus }) => syncStatus === CLOUD_SYNC_STATUSES.CONFLICT),
    true
  );

  fixture.runtime.persistState(learningState("local-after-conflict"));
  await fixture.runtime.flushCloudSaves();
  assert.equal(fixture.cloud.calls.update.length, 1);
  assert.equal(fixture.runtime.getState().label, "local-after-conflict");

  fixture.cloud.setLoadOverride(Promise.resolve({
    ok: true,
    status: "found",
    state: remote,
    revision: 2
  }));
  await fixture.runtime.reloadCloudLearningStateAfterConflict();
  assert.equal(fixture.runtime.getState().label, "remote-rev-2");
  assert.equal(fixture.runtime.getStatus().cloudRevision, 2);
  assert.equal(fixture.runtime.getStatus().syncStatus, CLOUD_SYNC_STATUSES.CONNECTED);
  assert.equal(fixture.savedGuestStates.length, 0);
});

test("identity-changed update discards its pending snapshot", async () => {
  let finishFirst;
  const first = new Promise((resolve) => { finishFirst = resolve; });
  const fixture = createFixture({
    rows: { a: learningState("cloud-a") },
    updateResults: [first]
  });
  await authenticate(fixture, "a");
  fixture.runtime.persistState(learningState("first"));
  await waitFor(() => fixture.cloud.calls.update.length === 1);
  fixture.runtime.persistState(learningState("pending"));

  finishFirst({ ok: false, status: "identity-changed" });
  await fixture.runtime.flushCloudSaves();

  assert.equal(fixture.cloud.calls.update.length, 1);
  assert.equal(fixture.runtime.getStatus().syncStatus, CLOUD_SYNC_STATUSES.SAVE_ERROR);
});

test("network error pauses with one latest snapshot and a later immediate change retries once", async () => {
  let finishFirst;
  const first = new Promise((resolve) => { finishFirst = resolve; });
  const fixture = createFixture({
    rows: { a: learningState("cloud-a") },
    updateResults: [first]
  });
  await authenticate(fixture, "a");
  fixture.runtime.persistState(learningState("failed-a"));
  await waitFor(() => fixture.cloud.calls.update.length === 1);
  fixture.runtime.persistState(learningState("pending-b"));
  fixture.runtime.persistState(learningState("pending-c"));

  finishFirst({ ok: false, status: "error" });
  await fixture.runtime.flushCloudSaves();
  assert.equal(fixture.cloud.calls.update.length, 1);
  assert.equal(fixture.runtime.getStatus().syncStatus, CLOUD_SYNC_STATUSES.SAVE_ERROR);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fixture.cloud.calls.update.length, 1);

  fixture.runtime.persistState(learningState("retry-latest"));
  await fixture.runtime.flushCloudSaves();
  assert.equal(fixture.cloud.calls.update.length, 2);
  assert.equal(fixture.cloud.calls.update[1].state.label, "retry-latest");
  assert.equal(fixture.cloud.calls.update[1].guard.expectedRevision, 1);
  assert.equal(fixture.runtime.getStatus().syncStatus, CLOUD_SYNC_STATUSES.CONNECTED);
});

test("a failed conflict reload preserves the local runtime and conflict guard", async () => {
  const fixture = createFixture({
    rows: { a: learningState("cloud-rev-1") },
    updateResults: [{ ok: false, status: "conflict", revision: 2 }]
  });
  await authenticate(fixture, "a");
  fixture.runtime.persistState(learningState("unsaved-local"));
  await fixture.runtime.flushCloudSaves();
  fixture.cloud.setLoadOverride(Promise.resolve({ ok: false, status: "error" }));

  const result = await fixture.runtime.reloadCloudLearningStateAfterConflict();
  assert.equal(result.status, "error");
  assert.equal(fixture.runtime.getState().label, "unsaved-local");
  assert.equal(fixture.runtime.getStatus().syncStatus, CLOUD_SYNC_STATUSES.CONFLICT);
  assert.equal(fixture.savedGuestStates.length, 0);
});

test("two devices loading revision one cannot overwrite one another", async () => {
  const cloud = createSharedOccCloud(learningState("remembered-100"));
  const deviceA = createRuntimeForSharedCloud(cloud);
  const deviceB = createRuntimeForSharedCloud(cloud);
  await deviceA.handleAuthState(authenticated("same-user"));
  await deviceB.handleAuthState(authenticated("same-user"));

  deviceA.persistState(learningState("remembered-105"));
  await deviceA.flushCloudSaves();
  deviceB.persistState(learningState("remembered-101"));
  await deviceB.flushCloudSaves();

  assert.equal(cloud.remote.state.label, "remembered-105");
  assert.equal(cloud.remote.revision, 2);
  assert.equal(deviceB.getStatus().syncStatus, CLOUD_SYNC_STATUSES.CONFLICT);
  assert.equal(deviceB.getState().label, "remembered-101");
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
  assert.equal(fixture.runtime.getStatus().meaningfulGuestProgress, false);
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

  const missing = createFixture({ rows: {}, guestState: meaningfulState("guest") });
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
  finishSave({ ok: true, status: "updated", revision: 2 });
  await fixture.runtime.flushCloudSaves();

  assert.equal(fixture.cloud.calls.update[0].guard.expectedUserId, "a");
  assert.equal(fixture.runtime.getState().label, "cloud-b");
  assert.equal(fixture.runtime.getStatus().userId, "b");
});

test("generation change discards the old identity's pending snapshot", async () => {
  let finishSave;
  const delayedSave = new Promise((resolve) => { finishSave = resolve; });
  const fixture = createFixture({
    rows: { a: learningState("cloud-a"), b: learningState("cloud-b") },
    updateResults: [delayedSave]
  });
  await authenticate(fixture, "a");
  fixture.runtime.persistState(learningState("in-flight-a"));
  await waitFor(() => fixture.cloud.calls.update.length === 1);
  fixture.runtime.persistState(learningState("pending-a"));

  await authenticate(fixture, "b");
  finishSave({ ok: true, status: "updated", revision: 2 });
  await fixture.runtime.flushCloudSaves();

  assert.equal(fixture.cloud.calls.update.length, 1);
  assert.equal(fixture.runtime.getStatus().userId, "b");
  assert.equal(fixture.runtime.getState().label, "cloud-b");
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

  finishLoad({ ok: true, status: "found", state: learningState("cloud-b"), revision: 1 });
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
  fixture.runtime.persistState(learningState("pending-a"));
  await becomeGuest(fixture);
  finishSave({ ok: true, status: "updated", revision: 2 });
  await fixture.runtime.flushCloudSaves();

  assert.equal(fixture.runtime.getState().label, "guest");
  assert.equal(fixture.cloud.calls.update.length, 1);
  assert.equal(fixture.savedGuestStates.length, 0);
});

function createFixture(options = {}) {
  const guestState = options.guestState ?? learningState("guest");
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
  const revisions = Object.fromEntries(Object.keys(rows).map((userId) => [userId, 1]));
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
          ? { ok: true, status: "found", state, revision: revisions[currentUserId] }
          : { ok: true, status: "not-found" };
      },
      async updateCloudLearningState(state, guard) {
        calls.update.push({ state, guard });
        const result = updateResults.shift();
        if (result) return await result;
        revisions[currentUserId] = guard.expectedRevision + 1;
        rows[currentUserId] = state;
        return { ok: true, status: "updated", state, revision: revisions[currentUserId] };
      },
      async createCloudLearningState() {
        calls.create += 1;
        return { ok: true, status: "created", revision: 1 };
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

function meaningfulState(label) {
  const state = learningState(label);
  state.practice.freeAttemptCount = 1;
  return state;
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

function createSharedOccCloud(initialState) {
  const remote = { state: structuredClone(initialState), revision: 1 };
  return {
    remote,
    repository: {
      async loadCloudLearningState() {
        return {
          ok: true,
          status: "found",
          state: structuredClone(remote.state),
          revision: remote.revision
        };
      },
      async updateCloudLearningState(state, guard) {
        if (guard.expectedRevision !== remote.revision) {
          return {
            ok: false,
            status: "conflict",
            state: structuredClone(remote.state),
            revision: remote.revision,
            expectedRevision: guard.expectedRevision
          };
        }
        remote.state = structuredClone(state);
        remote.revision += 1;
        return {
          ok: true,
          status: "updated",
          state: structuredClone(remote.state),
          revision: remote.revision
        };
      },
      async createCloudLearningState() {
        throw new Error("create is outside this OCC scenario");
      }
    }
  };
}

function createRuntimeForSharedCloud(cloud) {
  return createLearningStateRuntime({
    guestState: learningState("guest"),
    cloudRepository: cloud.repository,
    saveGuestState: (state) => state,
    normalizeRuntimeState: (state) => structuredClone(state)
  });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
}
