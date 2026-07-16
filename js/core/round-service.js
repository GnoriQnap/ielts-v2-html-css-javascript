import {
  createDefaultLearningRecord,
  getLearningRecord,
  LEARNING_STATUSES
} from "./learning-service.js";

export const MIN_ROUND_SIZE = 5;
export const PRESET_ROUND_SIZES = Object.freeze([20, 30, 50]);

export function createRound(options) {
  const {
    eligibleWordKeys = [],
    learning = { byWordKey: {} },
    requestedSize,
    createdAt = new Date().toISOString(),
    id = createRoundId(createdAt),
    random = Math.random
  } = options;
  const availableWordKeys = [...new Set(eligibleWordKeys)].filter(
    (wordKey) => getLearningRecord(learning, wordKey).status !== LEARNING_STATUSES.REMEMBERED
  );

  if (availableWordKeys.length < MIN_ROUND_SIZE) {
    throw new RangeError("当前可用词不足 5 个，无法创建轮次。");
  }
  if (
    !Number.isInteger(requestedSize) ||
    requestedSize < MIN_ROUND_SIZE ||
    requestedSize > availableWordKeys.length
  ) {
    throw new RangeError(`轮次数量必须在 ${MIN_ROUND_SIZE} 到 ${availableWordKeys.length} 之间。`);
  }

  const reviewWords = availableWordKeys
    .filter((wordKey) => getLearningRecord(learning, wordKey).status === LEARNING_STATUSES.REVIEW)
    .map((wordKey) => ({ wordKey, tieBreaker: checkedRandom(random) }))
    .sort((left, right) => compareReviewWords(left, right, learning))
    .map((item) => item.wordKey);
  const unseenNewWords = shuffle(
    availableWordKeys.filter((wordKey) => {
      const record = getLearningRecord(learning, wordKey);
      return record.status === LEARNING_STATUSES.NEW && record.roundsEntered === 0;
    }),
    random
  );
  const seenNewWords = shuffle(
    availableWordKeys.filter((wordKey) => {
      const record = getLearningRecord(learning, wordKey);
      return record.status === LEARNING_STATUSES.NEW && record.roundsEntered > 0;
    }),
    random
  );
  const wordKeys = [...reviewWords, ...unseenNewWords, ...seenNewWords].slice(0, requestedSize);

  return {
    id,
    createdAt,
    requestedSize,
    wordKeys,
    attemptCount: 0,
    correctAttemptCount: 0,
    progressByWord: Object.fromEntries(
      wordKeys.map((wordKey) => [wordKey, createDefaultRoundProgress()])
    )
  };
}

export function createDefaultRoundProgress() {
  return {
    hasBeenShown: false,
    firstAttemptCorrect: null,
    firstDecision: null,
    everWrong: false,
    everChoseReview: false,
    masteredViaExternalChange: false,
    mastered: false,
    attemptCount: 0,
    correctCount: 0,
    errorCount: 0
  };
}

export function markRoundWordShown({ round, learning, wordKey }) {
  const progress = assertRoundWord(round, wordKey);
  if (progress.hasBeenShown) {
    return { round, learning, applied: false };
  }

  const previousRecord = getLearningRecord(learning, wordKey);
  const enteredRoundIds = [...new Set([
    ...(Array.isArray(previousRecord.enteredRoundIds) ? previousRecord.enteredRoundIds : []),
    round.id
  ])];

  return {
    round: updateProgress(round, wordKey, { ...progress, hasBeenShown: true }),
    learning: {
      ...learning,
      byWordKey: {
        ...learning.byWordKey,
        [wordKey]: {
          ...createDefaultLearningRecord(),
          ...previousRecord,
          enteredRoundIds,
          roundsEntered: enteredRoundIds.length
        }
      }
    },
    applied: true
  };
}

export function recordRoundAnswer(round, wordKey, isCorrect) {
  const progress = assertRoundWord(round, wordKey);
  if (typeof isCorrect !== "boolean") {
    throw new TypeError("isCorrect 必须是布尔值。");
  }

  const firstAttemptCorrect = progress.firstAttemptCorrect === null
    ? isCorrect
    : progress.firstAttemptCorrect;
  const nextProgress = {
    ...progress,
    firstAttemptCorrect,
    everWrong: progress.everWrong || !isCorrect,
    attemptCount: progress.attemptCount + 1,
    correctCount: progress.correctCount + (isCorrect ? 1 : 0),
    errorCount: progress.errorCount + (isCorrect ? 0 : 1)
  };

  return {
    ...updateProgress(round, wordKey, nextProgress),
    attemptCount: round.attemptCount + 1,
    correctAttemptCount: round.correctAttemptCount + (isCorrect ? 1 : 0)
  };
}

export function applyRoundDecision(round, wordKey, status) {
  const progress = assertRoundWord(round, wordKey);
  if (![LEARNING_STATUSES.REVIEW, LEARNING_STATUSES.REMEMBERED].includes(status)) {
    throw new RangeError("轮次决定必须是 review 或 remembered。");
  }

  return updateProgress(round, wordKey, {
    ...progress,
    firstDecision: progress.firstDecision ?? status,
    everChoseReview: progress.everChoseReview || status === LEARNING_STATUSES.REVIEW,
    mastered: status === LEARNING_STATUSES.REMEMBERED
  });
}

export function getRoundEligibleWordKeys(round, learning, mode) {
  if (!round) {
    return [];
  }

  return round.wordKeys.filter((wordKey) => {
    const progress = round.progressByWord[wordKey];
    if (!progress || progress.mastered) {
      return false;
    }
    return mode !== "intensive" || (
      getLearningRecord(learning, wordKey).status === LEARNING_STATUSES.REVIEW
    );
  });
}

export function abandonRound(rounds) {
  return {
    current: null,
    lastCompletedSummary: rounds?.lastCompletedSummary ?? null
  };
}

export function completeRound(rounds, completedAt = new Date().toISOString()) {
  const round = rounds?.current;
  if (!round || !round.wordKeys.every((wordKey) => round.progressByWord[wordKey]?.mastered)) {
    return { rounds, completed: false };
  }

  const summary = Object.freeze({
    roundId: round.id,
    completedAt,
    totalWords: round.wordKeys.length,
    masteredCount: round.wordKeys.length,
    firstAttemptCorrectCount: round.wordKeys.filter(
      (wordKey) => round.progressByWord[wordKey].firstAttemptCorrect === true
    ).length
  });

  return {
    rounds: {
      current: null,
      lastCompletedSummary: summary
    },
    completed: true
  };
}

export function normalizeRounds(candidate, validWordKeys = new Set()) {
  return {
    current: normalizeCurrentRound(candidate?.current, validWordKeys),
    lastCompletedSummary: normalizeSummary(candidate?.lastCompletedSummary)
  };
}

function normalizeCurrentRound(candidate, validWordKeys) {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    typeof candidate.createdAt !== "string" ||
    !Number.isInteger(candidate.requestedSize)
  ) {
    return null;
  }

  const wordKeys = [...new Set(
    (Array.isArray(candidate.wordKeys) ? candidate.wordKeys : [])
      .filter((wordKey) => validWordKeys.has(wordKey))
  )];
  if (wordKeys.length < MIN_ROUND_SIZE || wordKeys.length !== candidate.requestedSize) {
    return null;
  }

  return {
    id: candidate.id,
    createdAt: candidate.createdAt,
    requestedSize: candidate.requestedSize,
    wordKeys,
    attemptCount: normalizeCount(candidate.attemptCount),
    correctAttemptCount: normalizeCount(candidate.correctAttemptCount),
    progressByWord: Object.fromEntries(wordKeys.map((wordKey) => [
      wordKey,
      normalizeProgress(candidate.progressByWord?.[wordKey])
    ]))
  };
}

function normalizeProgress(candidate) {
  const defaults = createDefaultRoundProgress();
  if (!candidate || typeof candidate !== "object") {
    return defaults;
  }

  return {
    hasBeenShown: candidate.hasBeenShown === true,
    firstAttemptCorrect: typeof candidate.firstAttemptCorrect === "boolean"
      ? candidate.firstAttemptCorrect
      : null,
    firstDecision: [LEARNING_STATUSES.REVIEW, LEARNING_STATUSES.REMEMBERED]
      .includes(candidate.firstDecision) ? candidate.firstDecision : null,
    everWrong: candidate.everWrong === true,
    everChoseReview: candidate.everChoseReview === true,
    masteredViaExternalChange: candidate.masteredViaExternalChange === true,
    mastered: candidate.mastered === true,
    attemptCount: normalizeCount(candidate.attemptCount),
    correctCount: normalizeCount(candidate.correctCount),
    errorCount: normalizeCount(candidate.errorCount)
  };
}

function normalizeSummary(candidate) {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.roundId !== "string" ||
    typeof candidate.completedAt !== "string"
  ) {
    return null;
  }
  return {
    roundId: candidate.roundId,
    completedAt: candidate.completedAt,
    totalWords: normalizeCount(candidate.totalWords),
    masteredCount: normalizeCount(candidate.masteredCount),
    firstAttemptCorrectCount: normalizeCount(candidate.firstAttemptCorrectCount)
  };
}

function compareReviewWords(left, right, learning) {
  const leftRecord = getLearningRecord(learning, left.wordKey);
  const rightRecord = getLearningRecord(learning, right.wordKey);
  const errorDifference = rightRecord.errorCount - leftRecord.errorCount;
  if (errorDifference !== 0) {
    return errorDifference;
  }

  const leftSince = leftRecord.reviewSince ?? "9999";
  const rightSince = rightRecord.reviewSince ?? "9999";
  const sinceDifference = leftSince.localeCompare(rightSince);
  return sinceDifference !== 0 ? sinceDifference : left.tieBreaker - right.tieBreaker;
}

function updateProgress(round, wordKey, progress) {
  return {
    ...round,
    progressByWord: {
      ...round.progressByWord,
      [wordKey]: progress
    }
  };
}

function assertRoundWord(round, wordKey) {
  const progress = round?.progressByWord?.[wordKey];
  if (!progress || !round.wordKeys.includes(wordKey)) {
    throw new RangeError(`词条“${wordKey}”不属于当前轮次。`);
  }
  return progress;
}

function createRoundId(createdAt) {
  const uniquePart = globalThis.crypto?.randomUUID?.()
    ?? `${createdAt.replace(/\D/g, "").slice(0, 17)}-${Math.random().toString(36).slice(2, 10)}`;
  return `round-${uniquePart}`;
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(checkedRandom(random) * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function checkedRandom(random) {
  if (typeof random !== "function") {
    throw new TypeError("random 必须是函数。");
  }
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("random 必须返回大于等于 0 且小于 1 的数。");
  }
  return value;
}

function normalizeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
