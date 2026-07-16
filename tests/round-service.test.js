import test from "node:test";
import assert from "node:assert/strict";
import {
  abandonRound,
  applyRoundDecision,
  completeRound,
  createRound,
  getRoundEligibleWordKeys,
  markRoundWordShown,
  recordRoundAnswer
} from "../js/core/round-service.js";
import { selectPracticeWordKey } from "../js/core/review-scheduler.js";

const allWordKeys = Array.from({ length: 60 }, (_, index) => `word-${index + 1}`);

function learningWith(records = {}) {
  return { byWordKey: structuredClone(records) };
}

function createSizedRound(requestedSize, options = {}) {
  return createRound({
    eligibleWordKeys: allWordKeys,
    learning: learningWith(options.records),
    requestedSize,
    id: options.id ?? `round-${requestedSize}`,
    createdAt: "2026-07-16T08:00:00.000Z",
    random: () => 0.25
  });
}

test("creates preset rounds containing 20, 30, and 50 distinct words", () => {
  for (const size of [20, 30, 50]) {
    const round = createSizedRound(size);
    assert.equal(round.wordKeys.length, size);
    assert.equal(new Set(round.wordKeys).size, size);
    assert.equal(Object.keys(round.progressByWord).length, size);
  }
});

test("custom size must be at least five and no more than available words", () => {
  assert.throws(() => createSizedRound(4), /5/);
  assert.throws(() => createSizedRound(61), /60/);
  assert.equal(createSizedRound(5).wordKeys.length, 5);
  assert.equal(createSizedRound(60).wordKeys.length, 60);
  assert.throws(() => createRound({
    eligibleWordKeys: allWordKeys.slice(0, 4),
    learning: learningWith(),
    requestedSize: 4
  }), /不足 5/);
});

test("review words are selected first by error count and reviewSince", () => {
  const round = createRound({
    eligibleWordKeys: allWordKeys,
    requestedSize: 5,
    id: "round-priority",
    createdAt: "2026-07-16T08:00:00.000Z",
    random: () => 0.5,
    learning: learningWith({
      "word-1": { status: "review", errorCount: 2, reviewSince: "2026-07-16T07:00:00.000Z" },
      "word-2": { status: "review", errorCount: 4, reviewSince: "2026-07-16T08:00:00.000Z" },
      "word-3": { status: "review", errorCount: 2, reviewSince: "2026-07-16T06:00:00.000Z" }
    })
  });

  assert.deepEqual(round.wordKeys.slice(0, 3), ["word-2", "word-3", "word-1"]);
});

test("remembered words never enter a round", () => {
  const round = createSizedRound(50, {
    records: Object.fromEntries(
      allWordKeys.slice(0, 10).map((wordKey) => [wordKey, { status: "remembered" }])
    )
  });

  assert.equal(round.wordKeys.some((wordKey) => Number(wordKey.split("-")[1]) <= 10), false);
});

test("creating a round does not increase roundsEntered", () => {
  const learning = learningWith({
    "word-1": { status: "new", roundsEntered: 0, enteredRoundIds: [] }
  });
  createRound({
    eligibleWordKeys: allWordKeys,
    learning,
    requestedSize: 5,
    id: "round-no-early-entry",
    random: () => 0
  });

  assert.equal(learning.byWordKey["word-1"].roundsEntered, 0);
  assert.deepEqual(learning.byWordKey["word-1"].enteredRoundIds, []);
});

test("first display increases roundsEntered and repeat insertion does not", () => {
  const round = createSizedRound(5, { id: "round-shown" });
  const wordKey = round.wordKeys[0];
  const learning = learningWith();
  const first = markRoundWordShown({ round, learning, wordKey });
  const repeated = markRoundWordShown({
    round: first.round,
    learning: first.learning,
    wordKey
  });

  assert.equal(first.applied, true);
  assert.equal(first.round.progressByWord[wordKey].hasBeenShown, true);
  assert.equal(first.learning.byWordKey[wordKey].roundsEntered, 1);
  assert.deepEqual(first.learning.byWordKey[wordKey].enteredRoundIds, ["round-shown"]);
  assert.equal(repeated.applied, false);
  assert.equal(repeated.learning.byWordKey[wordKey].roundsEntered, 1);
});

test("active round eligibility excludes mastered and out-of-round words", () => {
  let round = createSizedRound(5);
  const firstWord = round.wordKeys[0];
  const secondWord = round.wordKeys[1];
  round = applyRoundDecision(round, firstWord, "remembered");
  const learning = learningWith({
    [secondWord]: { status: "review" },
    "word-outside": { status: "review" }
  });

  assert.equal(getRoundEligibleWordKeys(round, learning, "random").includes(firstWord), false);
  assert.equal(getRoundEligibleWordKeys(round, learning, "random").includes("word-outside"), false);
  assert.deepEqual(getRoundEligibleWordKeys(round, learning, "intensive"), [secondWord]);
});

test("abandoning a round clears only current round state", () => {
  const learning = learningWith({ "word-1": { status: "review", errorCount: 2 } });
  const queue = [{ wordKey: "word-1" }];
  const rounds = {
    current: createSizedRound(5),
    lastCompletedSummary: { roundId: "older" }
  };
  const result = abandonRound(rounds);

  assert.equal(result.current, null);
  assert.deepEqual(result.lastCompletedSummary, { roundId: "older" });
  assert.deepEqual(learning.byWordKey["word-1"], { status: "review", errorCount: 2 });
  assert.deepEqual(queue, [{ wordKey: "word-1" }]);
});

test("round answers and decisions update per-word and aggregate progress", () => {
  let round = createSizedRound(5);
  const wordKey = round.wordKeys[0];
  round = recordRoundAnswer(round, wordKey, false);
  round = recordRoundAnswer(round, wordKey, true);
  round = applyRoundDecision(round, wordKey, "review");

  assert.equal(round.attemptCount, 2);
  assert.equal(round.correctAttemptCount, 1);
  assert.equal(round.progressByWord[wordKey].firstAttemptCorrect, false);
  assert.equal(round.progressByWord[wordKey].everWrong, true);
  assert.equal(round.progressByWord[wordKey].everChoseReview, true);
  assert.equal(round.progressByWord[wordKey].mastered, false);
});

test("completing a round creates a detached immutable summary snapshot", () => {
  let round = createSizedRound(5, { id: "round-complete" });
  round.wordKeys.forEach((wordKey, index) => {
    round = recordRoundAnswer(round, wordKey, index < 3);
    round = applyRoundDecision(round, wordKey, "remembered");
  });
  const completed = completeRound(
    { current: round, lastCompletedSummary: null },
    "2026-07-16T10:00:00.000Z"
  );

  assert.equal(completed.completed, true);
  assert.equal(completed.rounds.current, null);
  assert.deepEqual(completed.rounds.lastCompletedSummary, {
    roundId: "round-complete",
    completedAt: "2026-07-16T10:00:00.000Z",
    totalWords: 5,
    masteredCount: 5,
    firstAttemptCorrectCount: 3
  });
  assert.equal(Object.isFrozen(completed.rounds.lastCompletedSummary), true);
  assert.equal(completeRound({ current: null, lastCompletedSummary: completed.rounds.lastCompletedSummary }).completed, false);
});

test("the last unmastered word remains available after an error and completes only when mastered", () => {
  let round = createSizedRound(20, { id: "round-last-word" });
  const lastWordKey = round.wordKeys.at(-1);
  for (const wordKey of round.wordKeys.slice(0, -1)) {
    round = applyRoundDecision(round, wordKey, "remembered");
  }

  const beforeLastAnswer = completeRound({ current: round, lastCompletedSummary: null });
  assert.equal(beforeLastAnswer.completed, false);
  assert.equal(beforeLastAnswer.rounds.current, round);

  round = recordRoundAnswer(round, lastWordKey, false);
  const afterError = completeRound({ current: round, lastCompletedSummary: null });
  assert.equal(afterError.completed, false);
  assert.equal(afterError.rounds.current, round);
  const eligibleWordKeys = getRoundEligibleWordKeys(round, learningWith(), "random");
  assert.deepEqual(eligibleWordKeys, [lastWordKey]);
  assert.equal(selectPracticeWordKey({
    mode: "random",
    eligibleWordKeys,
    learning: learningWith(),
    excludeWordKey: lastWordKey,
    random: () => 0
  }), lastWordKey);
  assert.equal(round.attemptCount, 1);
  assert.equal(round.progressByWord[lastWordKey].errorCount, 1);

  round = recordRoundAnswer(round, lastWordKey, true);
  round = applyRoundDecision(round, lastWordKey, "remembered");
  const completed = completeRound(
    { current: round, lastCompletedSummary: null },
    "2026-07-16T11:00:00.000Z"
  );
  assert.equal(completed.completed, true);
  assert.equal(completed.rounds.current, null);
  assert.equal(completed.rounds.lastCompletedSummary.masteredCount, 20);
  assert.equal(round.attemptCount, 2);
});
