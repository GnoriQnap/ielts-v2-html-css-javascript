import {
  getLearningRecord,
  LEARNING_STATUSES,
  setLearningStatus
} from "./learning-service.js?v=10.7c";
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
    const entry = {
      wordKey,
      displayText: index.displayByWordKey.get(wordKey),
      status: getLearningRecord(learning, wordKey).status,
      categories: groupIds.map((groupId) => ({
        groupId,
        category: index.groupById.get(groupId)?.category ?? ""
      }))
    };
    if (detailsRepository && typeof detailsRepository.getWordDetails === "function") {
      entry.details = readWordDetails(detailsRepository, wordKey);
    }
    return entry;
  });
}

export function createWordbookCategoryTree(index, learning, detailsRepository = null) {
  const entries = createWordbookEntries(index, learning, detailsRepository);
  return createWordbookCategoryTreeFromEntries(index, entries);
}

export function createWordbookCategoryTreeFromEntries(index, entries) {
  const wordsByGroupId = new Map(
    [...index.groupById.keys()].map((groupId) => [groupId, []])
  );

  for (const entry of entries) {
    for (const { groupId } of entry.categories) {
      wordsByGroupId.get(groupId)?.push(entry);
    }
  }

  return [...index.groupById.entries()].map(([groupId, group]) => ({
    groupId,
    category: group.category,
    words: wordsByGroupId.get(groupId) ?? []
  }));
}

export function createWordbookDataCache() {
  let cached = null;
  return {
    get(index, learning) {
      if (cached?.index === index && cached?.learning === learning) {
        return cached;
      }
      const entries = createWordbookEntries(index, learning);
      const categoryTree = createWordbookCategoryTreeFromEntries(index, entries);
      cached = {
        index,
        learning,
        entries,
        categoryTree,
        categoryTreeByGroupId: new Map(categoryTree.map((group) => [group.groupId, group]))
      };
      return cached;
    },
    clear() {
      cached = null;
    }
  };
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
  const activeQuestionInvalidated = state.practice.activeQuestion?.wordKey === wordKey;
  const learningResult = setLearningStatus({
    learning: state.learning,
    wordKey,
    status,
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
        activeQuestion: activeQuestionInvalidated ? null : state.practice.activeQuestion,
        reviewQueue
      },
      rounds
    },
    applied: true,
    reason: null,
    activeQuestionInvalidated
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
