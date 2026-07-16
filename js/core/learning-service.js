export const LEARNING_STATUSES = Object.freeze({
  NEW: "new",
  REVIEW: "review",
  REMEMBERED: "remembered"
});

export function createDefaultLearningRecord() {
  return {
    status: LEARNING_STATUSES.NEW,
    correctCount: 0,
    errorCount: 0,
    answerCount: 0,
    lastAnsweredAt: null,
    reviewSince: null,
    enteredRoundIds: [],
    roundsEntered: 0
  };
}

export function getLearningRecord(learning, wordKey) {
  return {
    ...createDefaultLearningRecord(),
    ...(learning?.byWordKey?.[wordKey] ?? {})
  };
}

export function recordAnswer({ learning, activeQuestion, isCorrect, answeredAt }) {
  if (!activeQuestion || activeQuestion.phase !== "answering") {
    return { learning, activeQuestion, applied: false };
  }

  const previousRecord = getLearningRecord(learning, activeQuestion.wordKey);
  const nextRecord = {
    ...previousRecord,
    status: isCorrect ? previousRecord.status : LEARNING_STATUSES.REVIEW,
    correctCount: previousRecord.correctCount + (isCorrect ? 1 : 0),
    errorCount: previousRecord.errorCount + (isCorrect ? 0 : 1),
    answerCount: previousRecord.answerCount + 1,
    lastAnsweredAt: answeredAt,
    reviewSince: isCorrect
      ? previousRecord.reviewSince
      : previousRecord.status === LEARNING_STATUSES.REVIEW
        ? previousRecord.reviewSince ?? answeredAt
        : answeredAt
  };
  const nextLearning = {
    ...learning,
    byWordKey: {
      ...learning.byWordKey,
      [activeQuestion.wordKey]: nextRecord
    }
  };
  const nextActiveQuestion = {
    ...activeQuestion,
    phase: "graded",
    result: {
      isCorrect,
      submittedAt: answeredAt,
      decision: null
    }
  };

  return {
    learning: nextLearning,
    activeQuestion: nextActiveQuestion,
    applied: true
  };
}

export function applyMasteryDecision({ learning, activeQuestion, status, decidedAt = new Date().toISOString() }) {
  if (
    !activeQuestion ||
    activeQuestion.phase !== "graded" ||
    activeQuestion.result?.isCorrect !== true ||
    activeQuestion.result?.decision !== null ||
    ![LEARNING_STATUSES.REVIEW, LEARNING_STATUSES.REMEMBERED].includes(status)
  ) {
    return { learning, activeQuestion, applied: false };
  }

  const previousRecord = getLearningRecord(learning, activeQuestion.wordKey);
  const nextLearning = {
    ...learning,
    byWordKey: {
      ...learning.byWordKey,
      [activeQuestion.wordKey]: {
        ...previousRecord,
        status,
        reviewSince: status === LEARNING_STATUSES.REVIEW
          ? previousRecord.status === LEARNING_STATUSES.REVIEW
            ? previousRecord.reviewSince ?? decidedAt
            : decidedAt
          : null
      }
    }
  };
  const nextActiveQuestion = {
    ...activeQuestion,
    phase: "graded",
    result: {
      ...activeQuestion.result,
      decision: status
    }
  };

  return {
    learning: nextLearning,
    activeQuestion: nextActiveQuestion,
    applied: true
  };
}
