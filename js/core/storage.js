import { createDefaultLearningRecord, LEARNING_STATUSES } from "./learning-service.js";
import {
  normalizeReviewQueue,
  PRACTICE_MODES
} from "./review-scheduler.js";
import { normalizeRounds } from "./round-service.js";
import { DEFAULT_OPTION_COUNT } from "./question-engine.js";

export const STORAGE_KEY = "ielts_synonym_trainer_state";
export const SCHEMA_VERSION = 1;

export function createDefaultAppState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: null,
    learning: {
      byWordKey: {}
    },
    practice: {
      mode: PRACTICE_MODES.RANDOM,
      activeQuestion: null,
      roundPreparation: false,
      roundPreparationSize: null,
      roundPreparationCustom: false,
      freeAttemptCount: 0,
      reviewQueue: []
    },
    rounds: {
      current: null,
      lastCompletedSummary: null
    }
  };
}

export function loadAppState(options) {
  const {
    storage = globalThis.localStorage,
    validWordKeys = new Set(),
    validGroupIds = new Set(),
    correctGroupIdsByWordKey = new Map()
  } = options;
  const defaultState = createDefaultAppState();

  try {
    const serialized = storage.getItem(STORAGE_KEY);
    if (!serialized) {
      return defaultState;
    }
    const parsed = JSON.parse(serialized);
    return normalizeAppState(parsed, {
      defaultState,
      validWordKeys,
      validGroupIds,
      correctGroupIdsByWordKey
    });
  } catch {
    return defaultState;
  }
}

export function saveAppState(state, options = {}) {
  const {
    storage = globalThis.localStorage,
    now = () => new Date()
  } = options;
  const savedState = {
    ...state,
    schemaVersion: SCHEMA_VERSION,
    savedAt: now().toISOString()
  };

  storage.setItem(STORAGE_KEY, JSON.stringify(savedState));
  return savedState;
}

export function normalizeAppState(candidate, context) {
  const {
    defaultState,
    validWordKeys,
    validGroupIds,
    correctGroupIdsByWordKey
  } = context;

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return defaultState;
  }

  const learning = normalizeLearning(candidate.learning, validWordKeys);
  const activeQuestion = normalizeActiveQuestion(candidate.practice?.activeQuestion, {
    validWordKeys,
    validGroupIds,
    correctGroupIdsByWordKey
  });
  const rounds = normalizeRounds(candidate.rounds, validWordKeys);
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : null,
    learning,
    practice: {
      mode: Object.values(PRACTICE_MODES).includes(candidate.practice?.mode)
        ? candidate.practice.mode
        : PRACTICE_MODES.RANDOM,
      activeQuestion,
      roundPreparation: false,
      roundPreparationSize: null,
      roundPreparationCustom: false,
      freeAttemptCount: normalizeCount(candidate.practice?.freeAttemptCount),
      reviewQueue: normalizeReviewQueue(candidate.practice?.reviewQueue, {
        validWordKeys,
        learning
      })
    },
    rounds
  };
}

function normalizeLearning(candidate, validWordKeys) {
  const byWordKey = {};
  const records = candidate?.byWordKey;

  if (!records || typeof records !== "object" || Array.isArray(records)) {
    return { byWordKey };
  }

  for (const [wordKey, record] of Object.entries(records)) {
    if (!validWordKeys.has(wordKey) || !record || typeof record !== "object") {
      continue;
    }
    const defaults = createDefaultLearningRecord();
    const enteredRoundIds = Array.isArray(record.enteredRoundIds)
      ? [...new Set(record.enteredRoundIds.filter((roundId) => typeof roundId === "string" && roundId.length > 0))]
      : [];
    byWordKey[wordKey] = {
      status: Object.values(LEARNING_STATUSES).includes(record.status)
        ? record.status
        : defaults.status,
      correctCount: normalizeCount(record.correctCount),
      errorCount: normalizeCount(record.errorCount),
      answerCount: normalizeCount(record.answerCount),
      lastAnsweredAt: typeof record.lastAnsweredAt === "string"
        ? record.lastAnsweredAt
        : null,
      reviewSince: typeof record.reviewSince === "string" ? record.reviewSince : null,
      enteredRoundIds,
      roundsEntered: enteredRoundIds.length
    };
  }

  return { byWordKey };
}

function normalizeActiveQuestion(candidate, context) {
  if (!candidate || typeof candidate !== "object" || !context.validWordKeys.has(candidate.wordKey)) {
    return null;
  }

  const optionGroupIds = normalizeGroupIds(candidate.optionGroupIds, context.validGroupIds);
  const correctGroupIds = normalizeGroupIds(candidate.correctGroupIds, context.validGroupIds);
  if (
    optionGroupIds.length !== DEFAULT_OPTION_COUNT ||
    correctGroupIds.length === 0 ||
    !correctGroupIds.every((groupId) => optionGroupIds.includes(groupId))
  ) {
    return null;
  }

  const selectedGroupIds = normalizeGroupIds(candidate.selectedGroupIds, new Set(optionGroupIds));
  if (candidate.phase === "answering") {
    return {
      wordKey: candidate.wordKey,
      optionGroupIds,
      correctGroupIds,
      selectedGroupIds,
      phase: "answering",
      result: null
    };
  }

  if (selectedGroupIds.length === 0 || typeof candidate.result?.isCorrect !== "boolean") {
    return null;
  }

  const submittedAt = typeof candidate.result.submittedAt === "string"
    ? candidate.result.submittedAt
    : null;
  const decision = [LEARNING_STATUSES.REVIEW, LEARNING_STATUSES.REMEMBERED].includes(candidate.result.decision)
    ? candidate.result.decision
    : null;

  if (candidate.result.isCorrect) {
    return {
      wordKey: candidate.wordKey,
      optionGroupIds,
      correctGroupIds,
      selectedGroupIds,
      phase: "graded",
      result: { isCorrect: true, submittedAt, decision }
    };
  }

  return {
    wordKey: candidate.wordKey,
    optionGroupIds,
    correctGroupIds,
    selectedGroupIds,
    phase: "graded",
    result: { isCorrect: false, submittedAt, decision: null }
  };
}

function normalizeGroupIds(candidate, validGroupIds) {
  if (!Array.isArray(candidate)) {
    return [];
  }
  return [...new Set(candidate.filter((groupId) => validGroupIds.has(groupId)))];
}

function normalizeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
