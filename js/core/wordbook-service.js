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
import { createDefaultWordDetails } from "./vocabulary-details.js";

export const WORDBOOK_FILTERS = Object.freeze({
  ALL: "all",
  NEW: LEARNING_STATUSES.NEW,
  REVIEW: LEARNING_STATUSES.REVIEW,
  REMEMBERED: LEARNING_STATUSES.REMEMBERED
});

export function createWordbookEntries(index, learning, detailsRepository = null) {
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
      details: readWordDetails(detailsRepository, wordKey)
    };
  });
}

export function createWordbookCategoryTree(index, learning, detailsRepository = null) {
  const entries = createWordbookEntries(index, learning, detailsRepository);
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

export function hasWordDetails(details) {
  return Boolean(
    details?.phonetics?.uk ||
    details?.phonetics?.us ||
    details?.meanings?.some((meaning) => meaning.partOfSpeech || meaning.definitionZh) ||
    details?.collocations?.length ||
    details?.examples?.some((example) => example.en || example.zh) ||
    details?.notes ||
    details?.source
  );
}

function readWordDetails(detailsRepository, wordKey) {
  if (!detailsRepository || typeof detailsRepository.getWordDetails !== "function") {
    return createDefaultWordDetails();
  }
  return detailsRepository.getWordDetails(wordKey);
}
