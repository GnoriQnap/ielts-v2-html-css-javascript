import test from "node:test";
import assert from "node:assert/strict";
import {
  createHomeDashboardModel,
  shouldShowCompletionModal
} from "../js/ui/home-dashboard.js";
import {
  applyMasteryDecision,
  createDefaultLearningRecord
} from "../js/core/learning-service.js";

test("dashboard derives global counts, round progress, and review ranking", () => {
  const allWordKeys = ["alpha", "beta", "gamma", "delta"];
  const model = createHomeDashboardModel({
    allWordKeys,
    displayByWordKey: new Map(allWordKeys.map((wordKey) => [wordKey, wordKey.toUpperCase()])),
    learning: {
      byWordKey: {
        alpha: { status: "remembered" },
        beta: { status: "review", errorCount: 1 },
        gamma: { status: "review", errorCount: 3 }
      }
    },
    currentRound: {
      id: "round-dashboard",
      wordKeys: ["alpha", "beta", "delta"],
      attemptCount: 7,
      progressByWord: {
        alpha: { mastered: true },
        beta: { mastered: false },
        delta: { mastered: false }
      }
    }
  });

  assert.equal(model.totalCount, 4);
  assert.equal(model.rememberedCount, 1);
  assert.equal(model.rememberedPercent, 25);
  assert.equal(model.reviewCount, 2);
  assert.deepEqual(model.round, {
    id: "round-dashboard",
    masteredCount: 1,
    totalCount: 3,
    remainingCount: 2,
    attemptCount: 7
  });
  assert.deepEqual(model.topReviewWords.map((item) => item.wordKey), ["gamma", "beta"]);
});

test("dashboard returns safe empty values without an active round", () => {
  const model = createHomeDashboardModel({ allWordKeys: [] });

  assert.equal(model.rememberedPercent, 0);
  assert.equal(model.round, null);
  assert.deepEqual(model.topReviewWords, []);
});

test("dashboard progress bar percentage changes from the first remembered word", () => {
  const model = createHomeDashboardModel({
    allWordKeys: Array.from({ length: 1119 }, (_, index) => `word-${index}`),
    learning: {
      byWordKey: {
        "word-0": { status: "remembered" }
      }
    }
  });

  assert.equal(model.rememberedCount, 1);
  assert.equal(model.rememberedPercent, 0.0894);
});

test("completion modal only opens for a newly completed round", () => {
  const summary = { roundId: "round-completed" };

  assert.equal(shouldShowCompletionModal({
    summary,
    currentRound: null,
    dismissedRoundId: null
  }), true);
  assert.equal(shouldShowCompletionModal({
    summary,
    currentRound: null,
    dismissedRoundId: "round-completed"
  }), false);
  assert.equal(shouldShowCompletionModal({
    summary,
    currentRound: { id: "round-active" },
    dismissedRoundId: null
  }), false);
});

test("overall progress advances once for each newly remembered system word", () => {
  const systemWordKeys = ["alpha", "beta", "gamma"];
  let learning = { byWordKey: {} };
  const remember = (wordKey) => {
    const activeQuestion = {
      wordKey,
      phase: "graded",
      result: { isCorrect: true, decision: null }
    };
    learning = applyMasteryDecision({
      learning,
      activeQuestion,
      status: "remembered",
      decidedAt: "2026-08-30T00:00:00.000Z"
    }).learning;
    return createHomeDashboardModel({ allWordKeys: systemWordKeys, learning });
  };

  assert.equal(remember("alpha").rememberedCount, 1);
  assert.equal(remember("beta").rememberedCount, 2);
  assert.equal(remember("gamma").rememberedCount, 3);
  assert.equal(remember("alpha").rememberedCount, 3);

  learning = {
    ...learning,
    byWordKey: {
      ...learning.byWordKey,
      custom: { ...createDefaultLearningRecord(), status: "remembered" }
    }
  };
  const model = createHomeDashboardModel({ allWordKeys: systemWordKeys, learning });
  assert.equal(model.rememberedCount, 3);
  assert.equal(model.totalCount, 3);
  assert.equal(model.rememberedPercent, 100);
});
