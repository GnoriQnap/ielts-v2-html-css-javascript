import { PRACTICE_MODES } from "../core/review-scheduler.js";

export const MAIN_VIEWS = Object.freeze({
  PRACTICE: "practice",
  WORDBOOK: "wordbook",
  VOCABULARY_MANAGER: "vocabulary-manager"
});

export function createMainNavigationState(view, practiceMode) {
  return Object.freeze({
    random: view === MAIN_VIEWS.PRACTICE && practiceMode === PRACTICE_MODES.RANDOM,
    intensive: view === MAIN_VIEWS.PRACTICE && practiceMode === PRACTICE_MODES.INTENSIVE,
    wordbook: view === MAIN_VIEWS.WORDBOOK,
    vocabularyManager: view === MAIN_VIEWS.VOCABULARY_MANAGER
  });
}
