import test from "node:test";
import assert from "node:assert/strict";
import {
  createHomeDashboardModel,
  shouldShowCompletionModal
} from "../js/ui/home-dashboard.js";

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
