import test from "node:test";
import assert from "node:assert/strict";
import {
  getDueReviewWords,
  normalizeReviewQueue,
  PRACTICE_MODES,
  removeReviewItem,
  scheduleReview,
  selectPracticeWordKey
} from "../js/core/review-scheduler.js";

function learningWith(statuses) {
  return {
    byWordKey: Object.fromEntries(
      Object.entries(statuses).map(([wordKey, status]) => [wordKey, { status }])
    )
  };
}

test("adds a free review item with a delay from five to seven attempts", () => {
  const minimum = scheduleReview([], "sustain", 10, { random: () => 0 });
  const maximum = scheduleReview([], "critical", 10, { random: () => 0.999 });

  assert.deepEqual(minimum[0], {
    wordKey: "sustain",
    scope: "free",
    roundId: null,
    scheduledAtAttempt: 10,
    dueAfterAttempt: 15,
    delay: 5
  });
  assert.equal(maximum[0].delay, 7);
  assert.equal(maximum[0].dueAfterAttempt, 17);
});

test("rescheduling the same word updates its only queue item", () => {
  const first = scheduleReview([], "sustain", 3, { random: () => 0 });
  const second = scheduleReview(first, "sustain", 8, { random: () => 0.999 });

  assert.equal(second.length, 1);
  assert.equal(second[0].scheduledAtAttempt, 8);
  assert.equal(second[0].dueAfterAttempt, 15);
});

test("removes a review item by wordKey", () => {
  const queue = scheduleReview([], "sustain", 2, { random: () => 0 });

  assert.deepEqual(removeReviewItem(queue, "sustain"), []);
});

test("a review word is not due immediately and becomes due at its target attempt", () => {
  const queue = scheduleReview([], "sustain", 10, { random: () => 0.5 });

  assert.deepEqual(getDueReviewWords(queue, 10), []);
  assert.deepEqual(getDueReviewWords(queue, 15), []);
  assert.deepEqual(getDueReviewWords(queue, 16), ["sustain"]);
});

test("random mode prioritizes a due review word without repeating the previous word", () => {
  const queue = scheduleReview([], "sustain", 1, { random: () => 0 });
  const learning = learningWith({ sustain: "review", other: "new" });

  assert.equal(selectPracticeWordKey({
    mode: PRACTICE_MODES.RANDOM,
    eligibleWordKeys: ["other", "sustain"],
    learning,
    reviewQueue: queue,
    attemptCount: 6,
    excludeWordKey: "other",
    random: () => 0
  }), "sustain");

  assert.equal(selectPracticeWordKey({
    mode: PRACTICE_MODES.RANDOM,
    eligibleWordKeys: ["other", "sustain"],
    learning,
    reviewQueue: queue,
    attemptCount: 6,
    excludeWordKey: "sustain",
    random: () => 0
  }), "other");
});

test("intensive mode only returns review words and returns null when none exist", () => {
  assert.equal(selectPracticeWordKey({
    mode: PRACTICE_MODES.INTENSIVE,
    eligibleWordKeys: ["new-word", "review-word", "remembered-word"],
    learning: learningWith({
      "new-word": "new",
      "review-word": "review",
      "remembered-word": "remembered"
    }),
    random: () => 0
  }), "review-word");

  assert.equal(selectPracticeWordKey({
    mode: PRACTICE_MODES.INTENSIVE,
    eligibleWordKeys: ["new-word", "remembered-word"],
    learning: learningWith({
      "new-word": "new",
      "remembered-word": "remembered"
    })
  }), null);
});

test("normalization removes invalid, missing, remembered, and duplicate queue entries", () => {
  const validItem = scheduleReview([], "review-word", 4, { random: () => 0 })[0];
  const rememberedItem = scheduleReview([], "remembered-word", 4, { random: () => 0 })[0];
  const result = normalizeReviewQueue([
    validItem,
    { ...validItem, scheduledAtAttempt: 8, dueAfterAttempt: 13 },
    rememberedItem,
    { ...validItem, wordKey: "missing-word" },
    { wordKey: "broken" }
  ], {
    validWordKeys: new Set(["review-word", "remembered-word"]),
    learning: learningWith({
      "review-word": "review",
      "remembered-word": "remembered"
    })
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].wordKey, "review-word");
  assert.equal(result[0].scheduledAtAttempt, 8);
});

test("round-scoped scheduling persists its round id without duplicating the word", () => {
  const freeQueue = scheduleReview([], "review-word", 2, { random: () => 0 });
  const roundQueue = scheduleReview(freeQueue, "review-word", 4, {
    random: () => 0,
    scope: "round",
    roundId: "round-1"
  });
  const normalized = normalizeReviewQueue(roundQueue, {
    validWordKeys: new Set(["review-word"]),
    learning: learningWith({ "review-word": "review" })
  });

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].scope, "round");
  assert.equal(normalized[0].roundId, "round-1");
});
