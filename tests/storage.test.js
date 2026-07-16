import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultAppState,
  loadAppState,
  saveAppState,
  STORAGE_KEY
} from "../js/core/storage.js";

const vocabulary = {
  vocabulary_list: [
    { group_id: 1, category: "分类一", words: ["critical"] }
  ]
};
const context = {
  vocabulary,
  validWordKeys: new Set(["critical", "word-2", "word-3", "word-4", "word-5"]),
  validGroupIds: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  correctGroupIdsByWordKey: new Map([["critical", new Set([5, 6])]])
};

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

function createPersistedState() {
  const state = createDefaultAppState(vocabulary);
  state.learning.byWordKey.critical = {
    status: "review",
    correctCount: 2,
    errorCount: 1,
    answerCount: 3,
    lastAnsweredAt: "2026-07-16T08:00:00.000Z"
  };
  state.practice.activeQuestion = {
    wordKey: "critical",
    optionGroupIds: [1, 2, 3, 4, 5, 6],
    correctGroupIds: [5, 6],
    selectedGroupIds: [6, 5],
    phase: "awaitingDecision",
    result: {
      isCorrect: true,
      submittedAt: "2026-07-16T08:00:00.000Z",
      decision: null
    }
  };
  state.practice.mode = "intensive";
  state.practice.freeAttemptCount = 12;
  state.practice.reviewQueue = [{
    wordKey: "critical",
    scope: "free",
    roundId: null,
    scheduledAtAttempt: 3,
    dueAfterAttempt: 9,
    delay: 6
  }];
  const roundWordKeys = ["critical", "word-2", "word-3", "word-4", "word-5"];
  state.rounds.current = {
    id: "round-persisted",
    createdAt: "2026-07-16T07:00:00.000Z",
    requestedSize: 5,
    wordKeys: roundWordKeys,
    attemptCount: 2,
    correctAttemptCount: 1,
    progressByWord: Object.fromEntries(roundWordKeys.map((wordKey) => [wordKey, {
      hasBeenShown: wordKey === "critical",
      firstAttemptCorrect: wordKey === "critical" ? true : null,
      firstDecision: null,
      everWrong: false,
      everChoseReview: false,
      masteredViaExternalChange: false,
      mastered: false,
      attemptCount: wordKey === "critical" ? 1 : 0,
      correctCount: wordKey === "critical" ? 1 : 0,
      errorCount: 0
    }]))
  };
  return state;
}

test("state saves and restores learning and the active question", () => {
  const storage = new MemoryStorage();
  const saved = saveAppState(createPersistedState(), {
    storage,
    now: () => new Date("2026-07-16T09:00:00.000Z")
  });
  const loaded = loadAppState({ storage, ...context });

  assert.equal(saved.savedAt, "2026-07-16T09:00:00.000Z");
  assert.equal(loaded.learning.byWordKey.critical.status, "review");
  assert.deepEqual(loaded.practice.activeQuestion.selectedGroupIds, [6, 5]);
  assert.equal(loaded.practice.activeQuestion.phase, "graded");
  assert.equal(loaded.practice.activeQuestion.result.isCorrect, true);
  assert.equal(loaded.practice.mode, "intensive");
  assert.equal(loaded.practice.freeAttemptCount, 12);
  assert.equal(loaded.practice.reviewQueue.length, 1);
  assert.equal(loaded.rounds.current.id, "round-persisted");
  assert.equal(loaded.rounds.current.wordKeys.length, 5);
  assert.equal(loaded.rounds.current.progressByWord.critical.hasBeenShown, true);
});

test("missing fields recover to safe defaults", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1 }));
  const loaded = loadAppState({ storage, ...context });

  assert.deepEqual(loaded.learning, { byWordKey: {} });
  assert.equal(loaded.practice.activeQuestion, null);
  assert.equal(loaded.practice.mode, "random");
  assert.equal(loaded.practice.freeAttemptCount, 0);
  assert.deepEqual(loaded.practice.reviewQueue, []);
  assert.deepEqual(loaded.rounds, { current: null, lastCompletedSummary: null });
  assert.deepEqual(loaded.vocabulary, vocabulary);
});

test("illegal learning status and counts recover independently", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({
    vocabulary,
    learning: {
      byWordKey: {
        critical: {
          status: "unknown",
          correctCount: -2,
          errorCount: "4",
          answerCount: 5,
          lastAnsweredAt: 123
        }
      }
    },
    practice: { activeQuestion: null }
  }));
  const loaded = loadAppState({ storage, ...context });

  assert.deepEqual(loaded.learning.byWordKey.critical, {
    status: "new",
    correctCount: 0,
    errorCount: 0,
    answerCount: 5,
    lastAnsweredAt: null,
    reviewSince: null,
    enteredRoundIds: [],
    roundsEntered: 0
  });
});

test("damaged JSON returns a usable default state", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, "{not valid json");
  const loaded = loadAppState({ storage, ...context });

  assert.equal(loaded.schemaVersion, 1);
  assert.deepEqual(loaded.learning, { byWordKey: {} });
  assert.equal(loaded.practice.activeQuestion, null);
  assert.deepEqual(loaded.vocabulary, vocabulary);
});

test("invalid review queue fields recover and remembered words are removed", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({
    vocabulary,
    learning: {
      byWordKey: {
        critical: {
          status: "remembered",
          correctCount: 1,
          errorCount: 0,
          answerCount: 1,
          lastAnsweredAt: null
        }
      }
    },
    practice: {
      mode: "unknown",
      freeAttemptCount: -1,
      activeQuestion: null,
      reviewQueue: [{
        wordKey: "critical",
        scope: "free",
        roundId: null,
        scheduledAtAttempt: 1,
        dueAfterAttempt: 6,
        delay: 5
      }]
    }
  }));
  const loaded = loadAppState({ storage, ...context });

  assert.equal(loaded.practice.mode, "random");
  assert.equal(loaded.practice.freeAttemptCount, 0);
  assert.deepEqual(loaded.practice.reviewQueue, []);
});
