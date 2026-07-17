import {
  getLearningRecord,
  LEARNING_STATUSES,
  setLearningStatus
} from "./learning-service.js";
import { removeReviewItem } from "./review-scheduler.js";
import {
  completeRound,
  syncRoundWordLearningStatus
} from "./round-service.js";

export const WORDBOOK_FILTERS = Object.freeze({
  ALL: "all",
  NEW: LEARNING_STATUSES.NEW,
  REVIEW: LEARNING_STATUSES.REVIEW,
  REMEMBERED: LEARNING_STATUSES.REMEMBERED
});

export function createWordbookEntries(index, learning, annotations = {}) {
  return index.allWordKeys.map((wordKey) => {
    const groupIds = [...(index.groupIdsByWordKey.get(wordKey) ?? [])];
    return {
      wordKey,
      displayText: index.displayByWordKey.get(wordKey),
      status: getLearningRecord(learning, wordKey).status,
      categories: groupIds.map((groupId) => ({
        groupId,
        category: index.groupById.get(groupId)?.category ?? ""
      })),
      details: normalizeWordDetails(annotations[wordKey])
    };
  });
}

export function createWordbookCategoryTree(index, learning, annotations = {}) {
  const entries = createWordbookEntries(index, learning, annotations);
  return [...index.groupById.entries()].map(([groupId, group]) => ({
    groupId,
    category: group.category,
    words: entries.filter(
      (entry) => index.groupIdsByWordKey.get(entry.wordKey)?.has(groupId)
    )
  }));
}

export function filterWordbookEntries(entries, options = {}) {
  const filter = Object.values(WORDBOOK_FILTERS).includes(options.filter)
    ? options.filter
    : WORDBOOK_FILTERS.ALL;
  const query = String(options.query ?? "").trim().toLocaleLowerCase();

  return entries.filter((entry) => {
    if (filter !== WORDBOOK_FILTERS.ALL && entry.status !== filter) {
      return false;
    }
    if (!query) {
      return true;
    }
    return (
      entry.displayText.toLocaleLowerCase().includes(query) ||
      entry.wordKey.toLocaleLowerCase().includes(query) ||
      entry.categories.some(({ category }) => category.toLocaleLowerCase().includes(query))
    );
  });
}

export function applyWordbookStatusChange({ state, wordKey, status, changedAt }) {
  const learningResult = setLearningStatus({
    learning: state.learning,
    wordKey,
    status,
    activeQuestion: state.practice.activeQuestion,
    changedAt
  });
  if (!learningResult.applied) {
    return { state, applied: false, reason: learningResult.reason };
  }

  const reviewQueue = status === LEARNING_STATUSES.REVIEW
    ? state.practice.reviewQueue
    : removeReviewItem(state.practice.reviewQueue, wordKey);
  const currentRound = syncRoundWordLearningStatus(state.rounds.current, wordKey, status);
  const rounds = completeRound({
    ...state.rounds,
    current: currentRound
  }, changedAt).rounds;

  return {
    state: {
      ...state,
      learning: learningResult.learning,
      practice: {
        ...state.practice,
        reviewQueue
      },
      rounds
    },
    applied: true,
    reason: null
  };
}

export function normalizeWordDetails(candidate) {
  const details = candidate && typeof candidate === "object" ? candidate : {};
  return {
    phonetic: typeof details.phonetic === "string" ? details.phonetic : "",
    definition: typeof details.definition === "string" ? details.definition : "",
    collocations: Array.isArray(details.collocations)
      ? details.collocations.filter((item) => typeof item === "string" && item.trim())
      : [],
    examples: Array.isArray(details.examples)
      ? details.examples.filter((item) => typeof item === "string" && item.trim())
      : []
  };
}

export function hasWordDetails(details) {
  return Boolean(
    details?.phonetic ||
    details?.definition ||
    details?.collocations?.length ||
    details?.examples?.length
  );
}
