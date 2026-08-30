import { getLearningRecord, LEARNING_STATUSES } from "../core/learning-service.js";

export function createHomeDashboardModel(options) {
  const {
    allWordKeys = [],
    learning = { byWordKey: {} },
    currentRound = null,
    displayByWordKey = new Map()
  } = options;
  let rememberedCount = 0;
  let reviewCount = 0;
  const reviewWords = [];

  for (const wordKey of allWordKeys) {
    const record = getLearningRecord(learning, wordKey);
    if (record.status === LEARNING_STATUSES.REMEMBERED) {
      rememberedCount += 1;
    } else if (record.status === LEARNING_STATUSES.REVIEW) {
      reviewCount += 1;
      reviewWords.push({
        wordKey,
        displayText: displayByWordKey.get(wordKey) ?? wordKey,
        errorCount: record.errorCount
      });
    }
  }

  reviewWords.sort((left, right) => (
    right.errorCount - left.errorCount ||
    left.displayText.localeCompare(right.displayText, "en")
  ));

  const totalCount = allWordKeys.length;
  const rememberedPercent = totalCount === 0
    ? 0
    : Number(((rememberedCount / totalCount) * 100).toFixed(4));
  const round = currentRound ? createRoundView(currentRound) : null;

  return {
    totalCount,
    rememberedCount,
    rememberedPercent,
    reviewCount,
    round,
    topReviewWords: reviewWords.slice(0, 5)
  };
}

export function shouldShowCompletionModal({
  summary,
  currentRound,
  dismissedRoundId
}) {
  return Boolean(
    summary &&
    !currentRound &&
    summary.roundId !== dismissedRoundId
  );
}

function createRoundView(round) {
  const totalCount = round.wordKeys.length;
  const masteredCount = round.wordKeys.filter(
    (wordKey) => round.progressByWord[wordKey]?.mastered
  ).length;

  return {
    id: round.id,
    masteredCount,
    totalCount,
    remainingCount: totalCount - masteredCount,
    attemptCount: round.attemptCount
  };
}
