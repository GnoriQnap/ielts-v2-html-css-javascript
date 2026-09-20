import assert from "node:assert/strict";
import test from "node:test";

import { AUTH_STATUSES } from "../js/core/auth-service.js";
import {
  CLOUD_SETUP_ACTIONS,
  CLOUD_SYNC_STATUSES,
  createLearningStateRuntime,
  hasMeaningfulLearningProgress,
  LEARNING_STATE_SOURCES
} from "../js/core/learning-state-runtime.js";
import { createDefaultAppState } from "../js/core/storage.js";

test("meaningful progress ignores persistence and UI-only defaults", () => {
  const state = createDefaultAppState();
  state.savedAt = "2026-09-03T00:00:00.000Z";
  state.practice.roundPreparation = true;
  state.practice.roundPreparationSize = 30;
  state.ui = { modal: true };
  state.learning.byWordKey.idea = {
    status: "new",
    answerCount: 0,
    correctCount: 0,
    errorCount: 0,
    enteredRoundIds: [],
    roundsEntered: 0
  };
  state.practice.activeQuestion = {
    wordKey: "idea",
    phase: "answering",
    selectedGroupIds: []
  };

  assert.equal(hasMeaningfulLearningProgress(state), false);
});

test("meaningful progress recognizes real learning activity", () => {
  const candidates = [
    mutateDefault((state) => { state.learning.byWordKey.idea = { status: "review" }; }),
    mutateDefault((state) => { state.learning.byWordKey.idea = { status: "new", answerCount: 1 }; }),
    mutateDefault((state) => { state.practice.freeAttemptCount = 1; }),
    mutateDefault((state) => { state.practice.reviewQueue = [{ wordKey: "idea" }]; }),
    mutateDefault((state) => { state.practice.activeQuestion = { phase: "answering", selectedGroupIds: [1] }; }),
    mutateDefault((state) => { state.practice.activeQuestion = { phase: "graded", selectedGroupIds: [1] }; }),
    mutateDefault((state) => { state.rounds.current = { attemptCount: 1 }; }),
    mutateDefault((state) => { state.rounds.current = { progressByWord: { idea: { hasBeenShown: true } } }; }),
    mutateDefault((state) => { state.rounds.lastCompletedSummary = { roundId: "round-1" }; })
  ];
  for (const candidate of candidates) {
    assert.equal(hasMeaningfulLearningProgress(candidate), true);
  }
});

test("not-found with meaningful guest waits for an explicit choice", async () => {
  const fixture = createFixture({ guestState: meaningfulGuest() });
  await fixture.login("a");

  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.PENDING_MIGRATION);
  assert.equal(fixture.runtime.getStatus().meaningfulGuestProgress, true);
  assert.equal(fixture.cloud.calls.create.length, 0);
});

test("save to account inserts the preserved guest snapshot and keeps guest intact", async () => {
  const guestState = meaningfulGuest();
  const guestBefore = structuredClone(guestState);
  const fixture = createFixture({ guestState });
  await fixture.login("a");
  const result = await fixture.runtime.saveGuestProgressToAccount();

  assert.equal(result.status, "created");
  assert.equal(fixture.cloud.calls.create.length, 1);
  assert.deepEqual(fixture.cloud.calls.create[0].state, guestBefore);
  assert.equal(fixture.cloud.calls.create[0].guard.expectedUserId, "a");
  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD);
  assert.equal(fixture.runtime.getStatus().lastSetupAction, CLOUD_SETUP_ACTIONS.SAVE_GUEST);
  assert.deepEqual(fixture.savedGuestStates, []);

  await fixture.logout();
  assert.deepEqual(fixture.runtime.getState(), guestBefore);
});

test("start fresh inserts the default state without uploading guest learning", async () => {
  const guestState = meaningfulGuest();
  const fixture = createFixture({ guestState });
  await fixture.login("a");
  await fixture.runtime.startCloudLearningFromZero();

  const inserted = fixture.cloud.calls.create[0].state;
  assert.deepEqual(inserted, createDefaultAppState());
  assert.notDeepEqual(inserted.learning, guestState.learning);
  assert.equal(fixture.runtime.getStatus().lastSetupAction, CLOUD_SETUP_ACTIONS.START_FRESH);
  assert.deepEqual(fixture.savedGuestStates, []);
  await fixture.logout();
  assert.deepEqual(fixture.runtime.getState(), guestState);
});

test("empty guest automatically creates a default cloud state", async () => {
  const fixture = createFixture();
  await fixture.login("a");

  assert.equal(fixture.cloud.calls.create.length, 1);
  assert.deepEqual(fixture.cloud.calls.create[0].state, createDefaultAppState());
  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD);
});

test("create failure keeps Guest private and remains retryable pending migration", async () => {
  const guestState = meaningfulGuest();
  const guestBefore = structuredClone(guestState);
  const fixture = createFixture({
    guestState,
    createResults: [{ ok: false, status: "error", error: { code: "unavailable" } }]
  });
  await fixture.login("a");
  const result = await fixture.runtime.saveGuestProgressToAccount();

  assert.equal(result.status, "error");
  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.PENDING_MIGRATION);
  assert.equal(fixture.runtime.getStatus().syncStatus, CLOUD_SYNC_STATUSES.SETUP_ERROR);
  assert.notEqual(fixture.runtime.getState(), guestState);
  assert.deepEqual(fixture.runtime.getState(), createDefaultAppState());
  assert.deepEqual(guestState, guestBefore);
  assert.deepEqual(fixture.savedGuestStates, []);
});

test("already-exists reloads and uses remote state without overwriting it", async () => {
  const remote = cloudState("remote-won");
  const fixture = createFixture({
    guestState: meaningfulGuest(),
    createResults: [{ ok: false, status: "already-exists" }],
    loadResults: [{ ok: true, status: "not-found" }, { ok: true, status: "found", state: remote, revision: 1 }]
  });
  await fixture.login("a");
  const result = await fixture.runtime.saveGuestProgressToAccount();

  assert.equal(result.status, "found");
  assert.equal(fixture.cloud.calls.create.length, 1);
  assert.equal(fixture.cloud.calls.update.length, 0);
  assert.deepEqual(fixture.runtime.getState(), remote);
  assert.equal(fixture.runtime.getStatus().lastSetupAction, "loaded-existing");
});

test("created account loads normally next time without another setup prompt", async () => {
  const fixture = createFixture({ guestState: meaningfulGuest() });
  await fixture.login("a");
  await fixture.runtime.startCloudLearningFromZero();
  await fixture.logout();
  await fixture.login("a");

  assert.equal(fixture.cloud.calls.create.length, 1);
  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD);
  assert.equal(fixture.runtime.getStatus().meaningfulGuestProgress, false);
});

test("identity change invalidates A setup before and after its delayed insert", async () => {
  let finishCreate;
  const fixture = createFixture({
    guestState: meaningfulGuest(),
    rows: { b: cloudState("cloud-b") },
    createResults: [new Promise((resolve) => { finishCreate = resolve; })]
  });
  await fixture.login("a");
  const pendingCreate = fixture.runtime.saveGuestProgressToAccount();
  await waitFor(() => fixture.cloud.calls.create.length === 1);
  await fixture.login("b");
  finishCreate({ ok: true, status: "created", state: cloudState("late-a"), revision: 1 });
  assert.equal((await pendingCreate).status, "stale");
  assert.equal(fixture.runtime.getState().marker, "cloud-b");
});

test("a delayed A setup does not block B from receiving an independent setup choice", async () => {
  let finishCreate;
  const fixture = createFixture({
    guestState: meaningfulGuest(),
    createResults: [new Promise((resolve) => { finishCreate = resolve; })]
  });
  await fixture.login("a");
  const pendingA = fixture.runtime.saveGuestProgressToAccount();
  await waitFor(() => fixture.cloud.calls.create.length === 1);

  await fixture.login("b");
  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.PENDING_MIGRATION);
  assert.equal(fixture.runtime.getStatus().userId, "b");
  const pendingB = fixture.runtime.startCloudLearningFromZero();
  await waitFor(() => fixture.cloud.calls.create.length === 2);
  assert.equal(fixture.cloud.calls.create[1].guard.expectedUserId, "b");
  await pendingB;

  finishCreate({ ok: true, status: "created", state: cloudState("late-a"), revision: 1 });
  assert.equal((await pendingA).status, "stale");
  assert.equal(fixture.runtime.getStatus().userId, "b");
  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.AUTHENTICATED_CLOUD);
});

test("logout invalidates an unfinished setup and double click creates once", async () => {
  let finishCreate;
  const fixture = createFixture({
    guestState: meaningfulGuest(),
    createResults: [new Promise((resolve) => { finishCreate = resolve; })]
  });
  await fixture.login("a");
  const first = fixture.runtime.saveGuestProgressToAccount();
  const second = fixture.runtime.saveGuestProgressToAccount();
  assert.equal(first, second);
  await waitFor(() => fixture.cloud.calls.create.length === 1);
  await fixture.logout();
  finishCreate({ ok: true, status: "created", state: cloudState("late"), revision: 1 });
  assert.equal((await first).status, "stale");
  assert.equal(fixture.cloud.calls.create.length, 1);
  assert.equal(fixture.runtime.getStatus().source, LEARNING_STATE_SOURCES.GUEST);
  assert.equal(fixture.runtime.getState().practice.freeAttemptCount, 2);
});

function createFixture({
  guestState = createDefaultAppState(),
  rows = {},
  loadResults = [],
  createResults = []
} = {}) {
  const cloud = createCloudMock({ rows, loadResults, createResults });
  const savedGuestStates = [];
  const runtime = createLearningStateRuntime({
    guestState,
    cloudRepository: cloud.repository,
    saveGuestState(state) {
      savedGuestStates.push(structuredClone(state));
      return state;
    },
    createDefaultState: createDefaultAppState,
    normalizeRuntimeState: (state) => structuredClone(state)
  });
  return {
    cloud,
    runtime,
    savedGuestStates,
    async login(userId) {
      cloud.userId = userId;
      return runtime.handleAuthState({ status: AUTH_STATUSES.AUTHENTICATED, user: { id: userId } });
    },
    async logout() {
      cloud.userId = null;
      return runtime.handleAuthState({ status: AUTH_STATUSES.GUEST, user: null });
    }
  };
}

function createCloudMock({ rows, loadResults, createResults }) {
  const calls = { load: [], create: [], update: [] };
  const revisions = Object.fromEntries(Object.keys(rows).map((userId) => [userId, 1]));
  const mock = {
    userId: null,
    calls,
    repository: {
      async loadCloudLearningState() {
        calls.load.push(mock.userId);
        if (loadResults.length) return await loadResults.shift();
        return rows[mock.userId]
          ? { ok: true, status: "found", state: structuredClone(rows[mock.userId]), revision: revisions[mock.userId] }
          : { ok: true, status: "not-found" };
      },
      async createCloudLearningState(state, guard) {
        calls.create.push({ state: structuredClone(state), guard: { ...guard } });
        if (createResults.length) return await createResults.shift();
        rows[mock.userId] = structuredClone(state);
        revisions[mock.userId] = 1;
        return { ok: true, status: "created", state: structuredClone(state), revision: 1 };
      },
      async updateCloudLearningState(state, guard) {
        calls.update.push({ state: structuredClone(state), guard: { ...guard } });
        revisions[mock.userId] = guard.expectedRevision + 1;
        return { ok: true, status: "updated", state, revision: revisions[mock.userId] };
      }
    }
  };
  return mock;
}

function meaningfulGuest() {
  const state = createDefaultAppState();
  state.practice.freeAttemptCount = 2;
  state.learning.byWordKey.idea = {
    status: "review",
    answerCount: 2,
    correctCount: 1,
    errorCount: 1,
    lastAnsweredAt: "2026-09-03T00:00:00.000Z",
    reviewSince: "2026-09-03T00:00:00.000Z",
    enteredRoundIds: [],
    roundsEntered: 0
  };
  return state;
}

function cloudState(marker) {
  return { ...createDefaultAppState(), marker };
}

function mutateDefault(mutate) {
  const state = createDefaultAppState();
  mutate(state);
  return state;
}

async function waitFor(predicate) {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
}
