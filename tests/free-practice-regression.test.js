import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { vocabularyData } from "../js/data/vocabulary.js";
import { createVocabularyIndex } from "../js/core/vocabulary-index.js";
import {
  createQuestion,
  getEligibleWordKeys,
  isAnswerCorrect
} from "../js/core/question-engine.js";
import {
  createDefaultLearningRecord,
  LEARNING_STATUSES,
  recordAnswer
} from "../js/core/learning-service.js";
import {
  PRACTICE_MODES,
  selectPracticeWordKey
} from "../js/core/review-scheduler.js";
import { abandonRound, createRound } from "../js/core/round-service.js";

const index = createVocabularyIndex(vocabularyData.vocabulary_list);
const eligibleWordKeys = getEligibleWordKeys(index);

test("free practice can select and grade a question without an active round", () => {
  const learning = { byWordKey: {} };
  const wordKey = selectPracticeWordKey({
    mode: PRACTICE_MODES.RANDOM,
    eligibleWordKeys,
    learning,
    reviewQueue: [],
    attemptCount: 0,
    random: () => 0
  });
  const question = createQuestion(index, { wordKey, random: () => 0 });
  const activeQuestion = {
    wordKey,
    optionGroupIds: question.options.map((option) => option.groupId),
    correctGroupIds: question.correctGroupIds,
    selectedGroupIds: [...question.correctGroupIds],
    phase: "answering",
    result: null
  };
  const result = recordAnswer({
    learning,
    activeQuestion,
    isCorrect: isAnswerCorrect(
      activeQuestion.selectedGroupIds,
      activeQuestion.correctGroupIds
    ),
    answeredAt: "2026-08-01T00:00:00.000Z"
  });

  assert.equal(result.applied, true);
  assert.equal(result.activeQuestion.phase, "graded");
  assert.equal(result.activeQuestion.result.isCorrect, true);
  assert.equal(result.learning.byWordKey[wordKey].answerCount, 1);
});

test("random free practice can continuously select new questions", () => {
  let previousWordKey = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const wordKey = selectPracticeWordKey({
      mode: PRACTICE_MODES.RANDOM,
      eligibleWordKeys,
      learning: { byWordKey: {} },
      reviewQueue: [],
      attemptCount: attempt,
      excludeWordKey: previousWordKey,
      random: () => (attempt % 10) / 10
    });
    assert.equal(typeof wordKey, "string");
    assert.notEqual(wordKey, previousWordKey);
    assert.equal(createQuestion(index, { wordKey }).options.length, 6);
    previousWordKey = wordKey;
  }
});

test("intensive free practice selects review words and returns a normal empty result otherwise", () => {
  const reviewWordKey = eligibleWordKeys[0];
  const learning = {
    byWordKey: {
      [reviewWordKey]: {
        ...createDefaultLearningRecord(),
        status: LEARNING_STATUSES.REVIEW,
        reviewSince: "2026-08-01T00:00:00.000Z"
      }
    }
  };

  assert.equal(selectPracticeWordKey({
    mode: PRACTICE_MODES.INTENSIVE,
    eligibleWordKeys,
    learning,
    reviewQueue: [],
    attemptCount: 0
  }), reviewWordKey);
  assert.equal(selectPracticeWordKey({
    mode: PRACTICE_MODES.INTENSIVE,
    eligibleWordKeys,
    learning: { byWordKey: {} },
    reviewQueue: [],
    attemptCount: 0
  }), null);
});

test("abandoning a round leaves the same services ready for free practice", () => {
  const learning = { byWordKey: {} };
  const rounds = {
    current: createRound({
      eligibleWordKeys,
      learning,
      requestedSize: 20,
      createdAt: "2026-08-01T00:00:00.000Z",
      random: () => 0
    }),
    lastCompletedSummary: null
  };
  const abandoned = abandonRound(rounds);
  const wordKey = selectPracticeWordKey({
    mode: PRACTICE_MODES.RANDOM,
    eligibleWordKeys,
    learning,
    reviewQueue: [],
    attemptCount: 0,
    random: () => 0
  });

  assert.equal(abandoned.current, null);
  assert.equal(createQuestion(index, { wordKey }).options.length, 6);
});

test("practice UI no longer locks options or mode buttons for round setup", async () => {
  const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");

  assert.match(appSource, /const isLocked = isGraded;/);
  assert.match(appSource, /elements\.modeRandom\.disabled = false;/);
  assert.match(appSource, /elements\.modeIntensive\.disabled = false;/);
  assert.match(appSource, /enterFreePracticeAfterRound\(\);/);
  assert.doesNotMatch(appSource, /appState\.practice\.roundPreparation \|\| activeQuestion\.phase/);
  assert.doesNotMatch(appSource, /controlsLocked/);
});
