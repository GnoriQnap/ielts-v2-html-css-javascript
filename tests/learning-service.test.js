import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMasteryDecision,
  getLearningRecord,
  LEARNING_STATUSES,
  recordAnswer
} from "../js/core/learning-service.js";

function createActiveQuestion() {
  return {
    wordKey: "critical",
    optionGroupIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    correctGroupIds: [7, 8],
    selectedGroupIds: [7, 8],
    phase: "answering",
    result: null
  };
}

function createLearning() {
  return { byWordKey: {} };
}

test("incorrect answer increments objective counts and enters review", () => {
  const result = recordAnswer({
    learning: createLearning(),
    activeQuestion: createActiveQuestion(),
    isCorrect: false,
    answeredAt: "2026-07-16T08:00:00.000Z"
  });
  const record = getLearningRecord(result.learning, "critical");

  assert.equal(result.applied, true);
  assert.equal(result.activeQuestion.phase, "graded");
  assert.equal(record.status, LEARNING_STATUSES.REVIEW);
  assert.equal(record.answerCount, 1);
  assert.equal(record.correctCount, 0);
  assert.equal(record.errorCount, 1);
});

test("correct answer increments counts without automatically remembering", () => {
  const result = recordAnswer({
    learning: createLearning(),
    activeQuestion: createActiveQuestion(),
    isCorrect: true,
    answeredAt: "2026-07-16T08:00:00.000Z"
  });
  const record = getLearningRecord(result.learning, "critical");

  assert.equal(result.activeQuestion.phase, "graded");
  assert.equal(record.status, LEARNING_STATUSES.NEW);
  assert.equal(record.answerCount, 1);
  assert.equal(record.correctCount, 1);
  assert.equal(record.errorCount, 0);
});

test("correct answer can be explicitly moved to remembered", () => {
  const answered = recordAnswer({
    learning: createLearning(),
    activeQuestion: createActiveQuestion(),
    isCorrect: true,
    answeredAt: "2026-07-16T08:00:00.000Z"
  });
  const decided = applyMasteryDecision({
    learning: answered.learning,
    activeQuestion: answered.activeQuestion,
    status: LEARNING_STATUSES.REMEMBERED
  });

  assert.equal(decided.applied, true);
  assert.equal(getLearningRecord(decided.learning, "critical").status, LEARNING_STATUSES.REMEMBERED);
  assert.equal(decided.activeQuestion.phase, "graded");
  assert.equal(decided.activeQuestion.result.decision, LEARNING_STATUSES.REMEMBERED);
});

test("correct answer can be explicitly moved to review", () => {
  const answered = recordAnswer({
    learning: createLearning(),
    activeQuestion: createActiveQuestion(),
    isCorrect: true,
    answeredAt: "2026-07-16T08:00:00.000Z"
  });
  const decided = applyMasteryDecision({
    learning: answered.learning,
    activeQuestion: answered.activeQuestion,
    status: LEARNING_STATUSES.REVIEW
  });

  assert.equal(getLearningRecord(decided.learning, "critical").status, LEARNING_STATUSES.REVIEW);
  assert.equal(decided.activeQuestion.result.decision, LEARNING_STATUSES.REVIEW);
});

test("the same active question cannot increment statistics twice", () => {
  const first = recordAnswer({
    learning: createLearning(),
    activeQuestion: createActiveQuestion(),
    isCorrect: true,
    answeredAt: "2026-07-16T08:00:00.000Z"
  });
  const duplicate = recordAnswer({
    learning: first.learning,
    activeQuestion: first.activeQuestion,
    isCorrect: true,
    answeredAt: "2026-07-16T08:01:00.000Z"
  });
  const record = getLearningRecord(duplicate.learning, "critical");

  assert.equal(duplicate.applied, false);
  assert.equal(record.answerCount, 1);
  assert.equal(record.correctCount, 1);
});
