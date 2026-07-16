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
  validWordKeys: new Set(["critical"]),
  validGroupIds: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  correctGroupIdsByWordKey: new Map([["critical", new Set([7, 8])]])
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
    optionGroupIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    correctGroupIds: [7, 8],
    selectedGroupIds: [8, 7],
    phase: "awaitingDecision",
    result: {
      isCorrect: true,
      submittedAt: "2026-07-16T08:00:00.000Z",
      decision: null
    }
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
  assert.deepEqual(loaded.practice.activeQuestion.selectedGroupIds, [8, 7]);
  assert.equal(loaded.practice.activeQuestion.phase, "graded");
  assert.equal(loaded.practice.activeQuestion.result.isCorrect, true);
});

test("missing fields recover to safe defaults", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1 }));
  const loaded = loadAppState({ storage, ...context });

  assert.deepEqual(loaded.learning, { byWordKey: {} });
  assert.equal(loaded.practice.activeQuestion, null);
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
    lastAnsweredAt: null
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
