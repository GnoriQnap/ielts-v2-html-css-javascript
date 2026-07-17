import { vocabularyData } from "./data/vocabulary.js";
import { validateVocabularyData } from "./core/vocabulary-validator.js";
import {
  createQuestion,
  getEligibleWordKeys,
  isAnswerCorrect
} from "./core/question-engine.js";
import {
  applyMasteryDecision,
  getLearningRecord,
  LEARNING_STATUSES,
  recordAnswer
} from "./core/learning-service.js";
import { loadAppState, saveAppState, STORAGE_KEY } from "./core/storage.js?v=7.1";
import { createVocabularyRepository } from "./core/vocabulary-repository.js?v=7.1";
import {
  PRACTICE_MODES,
  removeReviewItem,
  scheduleReview,
  selectPracticeWordKey
} from "./core/review-scheduler.js";
import {
  abandonRound,
  applyRoundDecision,
  completeRound,
  createRound,
  getRoundEligibleWordKeys,
  markRoundWordShown,
  PRESET_ROUND_SIZES,
  recordRoundAnswer
} from "./core/round-service.js?v=5.13";
import {
  createHomeDashboardModel,
  shouldShowCompletionModal
} from "./ui/home-dashboard.js?v=5.9";
import {
  applyWordbookStatusChange,
  createWordbookCategoryTree,
  createWordbookEntries,
  filterWordbookEntries,
  hasWordDetails,
  WORDBOOK_FILTERS
} from "./core/wordbook-service.js?v=6.0";

const vocabularyRepository = createVocabularyRepository({
  fallbackVocabulary: vocabularyData,
  legacyStateKey: STORAGE_KEY
});
vocabularyRepository.load();
const currentVocabulary = vocabularyRepository.getCurrentVocabulary();
const report = validateVocabularyData(currentVocabulary);
const elements = {
  siteHeader: document.querySelector("#site-header"),
  practiceMain: document.querySelector("#practice-main"),
  wordbookMain: document.querySelector("#wordbook-main"),
  homeLink: document.querySelector("#home-link"),
  practiceNav: document.querySelector("#practice-nav"),
  startRoundNav: document.querySelector(".nav-start-round"),
  wordbookNav: document.querySelector("#wordbook-nav"),
  type: document.querySelector("#question-type"),
  word: document.querySelector("#word-heading"),
  prompt: document.querySelector("#question-prompt"),
  questionRoundStatus: document.querySelector("#question-round-status"),
  questionRoundProgress: document.querySelector("#question-round-progress"),
  questionRoundMastered: document.querySelector("#question-round-mastered"),
  questionRoundTotal: document.querySelector("#question-round-total"),
  lastRoundWordHint: document.querySelector("#last-round-word-hint"),
  wordStatus: document.querySelector("#word-status"),
  options: document.querySelector("#options"),
  feedback: document.querySelector("#feedback"),
  submit: document.querySelector("#submit-answer"),
  decisions: document.querySelector("#decision-actions"),
  markReview: document.querySelector("#mark-review"),
  markRemembered: document.querySelector("#mark-remembered"),
  next: document.querySelector("#next-question"),
  modeRandom: document.querySelector("#mode-random"),
  modeIntensive: document.querySelector("#mode-intensive"),
  empty: document.querySelector("#empty-state"),
  roundSetup: document.querySelector("#round-setup"),
  roundSize: document.querySelector("#round-size"),
  customRoundSize: document.querySelector("#custom-round-size"),
  startRound: document.querySelector("#start-round"),
  roundActive: document.querySelector("#round-active"),
  roundProgress: document.querySelector("#round-progress"),
  abandonRound: document.querySelector("#abandon-round"),
  roundSummary: document.querySelector("#round-summary"),
  completionModal: document.querySelector("#completion-modal"),
  completionTotal: document.querySelector("#completion-total"),
  startNextRound: document.querySelector("#start-next-round"),
  completionIntensive: document.querySelector("#completion-intensive"),
  abandonConfirmModal: document.querySelector("#abandon-confirm-modal"),
  cancelAbandon: document.querySelector("#cancel-abandon"),
  confirmAbandon: document.querySelector("#confirm-abandon"),
  overallProgressCount: document.querySelector("#overall-progress-count"),
  overallProgressBar: document.querySelector("#overall-progress-bar"),
  reviewCountStat: document.querySelector("#review-count-stat"),
  reviewRanking: document.querySelector("#review-ranking"),
  reviewRankingEmpty: document.querySelector("#review-ranking-empty"),
  wordbookBack: document.querySelector("#wordbook-back"),
  wordbookSearch: document.querySelector("#wordbook-search"),
  clearWordbookSearch: document.querySelector("#clear-wordbook-search"),
  wordbookFilters: document.querySelector("#wordbook-filters"),
  wordbookResultCount: document.querySelector("#wordbook-result-count"),
  wordbookNotice: document.querySelector("#wordbook-notice"),
  wordbookList: document.querySelector("#wordbook-list"),
  wordbookEmpty: document.querySelector("#wordbook-empty"),
  wordDetailModal: document.querySelector("#word-detail-modal"),
  wordDetailTitle: document.querySelector("#word-detail-title"),
  wordDetailContent: document.querySelector("#word-detail-content"),
  closeWordDetail: document.querySelector("#close-word-detail")
};

let appState = null;
let persistenceError = "";
let dismissedCompletionRoundId = null;
let completionWasOpen = false;
let isAbandonConfirmationOpen = false;
let isWordbookOpen = false;
let wordbookFilter = WORDBOOK_FILTERS.ALL;
let wordbookQuery = "";
let wordbookNotice = "";
const expandedWordbookGroupIds = new Set();

elements.submit.addEventListener("click", submitAnswer);
elements.markReview.addEventListener("click", () => chooseMasteryStatus(LEARNING_STATUSES.REVIEW));
elements.markRemembered.addEventListener("click", () => chooseMasteryStatus(LEARNING_STATUSES.REMEMBERED));
elements.next.addEventListener("click", showNextQuestion);
elements.modeRandom.addEventListener("click", () => {
  openPracticeView();
  changeMode(PRACTICE_MODES.RANDOM);
});
elements.modeIntensive.addEventListener("click", () => {
  openPracticeView();
  changeMode(PRACTICE_MODES.INTENSIVE);
});
elements.roundSize.addEventListener("change", handleRoundSizeChange);
elements.customRoundSize.addEventListener("input", handleRoundSizeChange);
elements.startRound.addEventListener("click", startNewRound);
elements.abandonRound.addEventListener("click", openAbandonConfirmation);
elements.cancelAbandon.addEventListener("click", closeAbandonConfirmation);
elements.confirmAbandon.addEventListener("click", confirmAbandonCurrentRound);
elements.startNextRound.addEventListener("click", startNextRoundFromCompletion);
elements.completionIntensive.addEventListener("click", openCompletionIntensive);
elements.homeLink.addEventListener("click", openPracticeFromLink);
elements.practiceNav.addEventListener("click", openPracticeFromLink);
elements.startRoundNav.addEventListener("click", () => openPracticeView());
elements.wordbookNav.addEventListener("click", openWordbookView);
elements.wordbookBack.addEventListener("click", openPracticeView);
elements.wordbookSearch.addEventListener("input", handleWordbookSearch);
elements.clearWordbookSearch.addEventListener("click", clearWordbookSearch);
elements.wordbookFilters.addEventListener("click", handleWordbookFilter);
elements.wordbookList.addEventListener("click", handleWordbookListClick);
elements.closeWordDetail.addEventListener("click", closeWordDetail);
window.addEventListener("popstate", renderViewFromLocation);
window.addEventListener("hashchange", renderViewFromLocation);

if (report.isValid) {
  appState = loadAppState({
    validWordKeys: new Set(report.index.allWordKeys),
    validGroupIds: new Set(report.index.groupById.keys()),
    correctGroupIdsByWordKey: report.index.groupIdsByWordKey
  });
  dismissedCompletionRoundId = appState.rounds.lastCompletedSummary?.roundId ?? null;

  if (!isActiveQuestionAllowedInMode()) {
    replaceActiveQuestion();
  } else if (
    appState.practice.activeQuestion.phase === "graded" &&
    appState.practice.activeQuestion.result?.isCorrect === true &&
    appState.practice.activeQuestion.result?.decision
  ) {
    replaceActiveQuestion();
  }
  renderActiveQuestion();
  renderViewFromLocation();
} else {
  showFatalError(report.errors.map((item) => item.message).join(" "));
}

function showNextQuestion() {
  replaceActiveQuestion();
  renderActiveQuestion();
}

function replaceActiveQuestion() {
  const previousWordKey = appState.practice.activeQuestion?.wordKey ?? null;
  const eligibleWordKeys = appState.rounds.current
    ? getRoundEligibleWordKeys(
      appState.rounds.current,
      appState.learning,
      appState.practice.mode
    )
    : getEligibleWordKeys(report.index);
  const wordKey = selectPracticeWordKey({
    mode: appState.practice.mode,
    eligibleWordKeys,
    learning: appState.learning,
    reviewQueue: appState.practice.reviewQueue,
    attemptCount: appState.practice.freeAttemptCount,
    excludeWordKey: previousWordKey
  });
  const question = wordKey ? createQuestion(report.index, { wordKey }) : null;
  let nextLearning = appState.learning;
  let nextRound = appState.rounds.current;
  if (question && nextRound) {
    const shown = markRoundWordShown({
      round: nextRound,
      learning: nextLearning,
      wordKey: question.wordKey
    });
    nextLearning = shown.learning;
    nextRound = shown.round;
  }
  appState = {
    ...appState,
    learning: nextLearning,
    practice: {
      ...appState.practice,
      activeQuestion: question ? createActiveQuestion(question) : null,
      roundPreparation: false,
      roundPreparationSize: null,
      roundPreparationCustom: false
    },
    rounds: {
      ...appState.rounds,
      current: nextRound
    }
  };
  persistState();
}

function createActiveQuestion(question) {
  return {
    wordKey: question.wordKey,
    optionGroupIds: question.options.map((option) => option.groupId),
    correctGroupIds: [...question.correctGroupIds],
    selectedGroupIds: [],
    phase: "answering",
    result: null
  };
}

function renderActiveQuestion() {
  const activeQuestion = appState.practice.activeQuestion;
  renderDashboard();
  renderRoundControls();
  renderQuestionRoundStatus();
  renderModeControls(activeQuestion);
  if (!activeQuestion) {
    renderEmptyState();
    return;
  }
  elements.empty.hidden = true;
  elements.options.hidden = false;
  const isMultiple = activeQuestion.correctGroupIds.length > 1;
  const record = getLearningRecord(appState.learning, activeQuestion.wordKey);

  elements.type.textContent = isMultiple ? "多选题" : "单选题";
  elements.word.textContent = report.index.displayByWordKey.get(activeQuestion.wordKey);
  elements.prompt.textContent = isMultiple
    ? "请选择所有对应的语义分类"
    : "请选择对应的语义分类";
  elements.prompt.classList.toggle("prompt-multiple", isMultiple);
  elements.wordStatus.textContent = `状态：${statusLabel(record.status)}`;
  elements.wordStatus.dataset.status = record.status;
  renderOptions(activeQuestion, isMultiple);
  renderQuestionActions(activeQuestion);
}

function renderOptions(activeQuestion, isMultiple) {
  elements.options.replaceChildren();
  const selectedGroupIds = new Set(activeQuestion.selectedGroupIds);
  const correctGroupIds = new Set(activeQuestion.correctGroupIds);
  const isGraded = activeQuestion.phase !== "answering";
  const isLocked = isGraded || appState.practice.roundPreparation;

  activeQuestion.optionGroupIds.forEach((groupId, index) => {
    const button = document.createElement("button");
    const letter = document.createElement("span");
    const label = document.createElement("span");
    const selected = selectedGroupIds.has(groupId);
    button.type = "button";
    button.className = "option-button";
    button.dataset.groupId = String(groupId);
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = isLocked;

    if (!isLocked && selected) {
      button.classList.add("selected");
    }
    if (isGraded && correctGroupIds.has(groupId)) {
      button.classList.add("correct");
    } else if (isGraded && selected) {
      button.classList.add("incorrect");
    }

    letter.className = "option-letter";
    letter.textContent = String.fromCharCode(65 + index);
    label.className = "option-text";
    label.textContent = report.index.groupById.get(groupId).category;
    button.append(letter, label);
    button.addEventListener("click", () => toggleOption(groupId, isMultiple));
    elements.options.append(button);
  });
}

function renderQuestionActions(activeQuestion) {
  elements.feedback.textContent = "";
  elements.feedback.className = "feedback";
  if (appState.practice.roundPreparation) {
    elements.submit.hidden = true;
    elements.submit.disabled = true;
    elements.decisions.hidden = true;
    elements.next.hidden = true;
    return;
  }
  elements.submit.hidden = activeQuestion.phase !== "answering";
  elements.submit.disabled = activeQuestion.phase !== "answering";
  const isCorrectWaitingDecision = (
    activeQuestion.phase === "graded" &&
    activeQuestion.result?.isCorrect === true &&
    !activeQuestion.result?.decision
  );
  const isWrong = (
    activeQuestion.phase === "graded" &&
    activeQuestion.result?.isCorrect === false
  );
  elements.decisions.hidden = !isCorrectWaitingDecision;
  elements.next.hidden = !isWrong;

  if (isCorrectWaitingDecision) {
    elements.feedback.textContent = "回答正确";
    elements.feedback.classList.add("success");
  } else if (isWrong) {
    const isLastUnmasteredRoundWord = getCurrentRoundCounts()?.remainingCount === 1;
    elements.feedback.textContent = isLastUnmasteredRoundWord
      ? "这是本轮最后一个待掌握词，请继续强化"
      : "回答错误，已自动加入待强化";
    elements.feedback.classList.add("error");
  }

  if (persistenceError) {
    elements.feedback.textContent = persistenceError;
    elements.feedback.className = "feedback fatal";
  }
}

function toggleOption(groupId, isMultiple) {
  const activeQuestion = appState.practice.activeQuestion;
  if (appState.practice.roundPreparation || activeQuestion.phase !== "answering") {
    return;
  }

  const selectedGroupIds = new Set(activeQuestion.selectedGroupIds);
  if (!isMultiple) {
    selectedGroupIds.clear();
    selectedGroupIds.add(groupId);
  } else if (selectedGroupIds.has(groupId)) {
    selectedGroupIds.delete(groupId);
  } else {
    selectedGroupIds.add(groupId);
  }

  appState = {
    ...appState,
    practice: {
      ...appState.practice,
      activeQuestion: {
        ...activeQuestion,
        selectedGroupIds: [...selectedGroupIds]
      }
    }
  };
  persistState();
  renderActiveQuestion();
}

function submitAnswer() {
  const activeQuestion = appState.practice.activeQuestion;
  if (appState.practice.roundPreparation || activeQuestion.phase !== "answering") {
    return;
  }
  if (activeQuestion.selectedGroupIds.length === 0) {
    elements.feedback.textContent = "请先选择一个答案。";
    elements.feedback.className = "feedback validation";
    return;
  }

  const answerResult = recordAnswer({
    learning: appState.learning,
    activeQuestion,
    isCorrect: isAnswerCorrect(
      activeQuestion.selectedGroupIds,
      activeQuestion.correctGroupIds
    ),
    answeredAt: new Date().toISOString()
  });
  if (!answerResult.applied) {
    return;
  }

  const nextAttemptCount = appState.practice.freeAttemptCount + 1;
  const nextReviewQueue = answerResult.activeQuestion.result.isCorrect
    ? appState.practice.reviewQueue
    : scheduleReview(
      appState.practice.reviewQueue,
      activeQuestion.wordKey,
      nextAttemptCount,
      appState.rounds.current ? {
        scope: "round",
        roundId: appState.rounds.current.id
      } : undefined
    );
  const nextRound = appState.rounds.current?.wordKeys.includes(activeQuestion.wordKey)
    ? recordRoundAnswer(
      appState.rounds.current,
      activeQuestion.wordKey,
      answerResult.activeQuestion.result.isCorrect
    )
    : appState.rounds.current;
  appState = {
    ...appState,
    learning: answerResult.learning,
    practice: {
      ...appState.practice,
      activeQuestion: answerResult.activeQuestion,
      freeAttemptCount: nextAttemptCount,
      reviewQueue: nextReviewQueue
    },
    rounds: {
      ...appState.rounds,
      current: nextRound
    }
  };
  persistState();
  renderActiveQuestion();
}

function chooseMasteryStatus(status) {
  const decidedAt = new Date().toISOString();
  const decision = applyMasteryDecision({
    learning: appState.learning,
    activeQuestion: appState.practice.activeQuestion,
    status,
    decidedAt
  });
  if (!decision.applied) {
    return;
  }

  const nextReviewQueue = status === LEARNING_STATUSES.REVIEW
    ? scheduleReview(
      appState.practice.reviewQueue,
      appState.practice.activeQuestion.wordKey,
      appState.practice.freeAttemptCount,
      appState.rounds.current ? {
        scope: "round",
        roundId: appState.rounds.current.id
      } : undefined
    )
    : removeReviewItem(
      appState.practice.reviewQueue,
      appState.practice.activeQuestion.wordKey
    );
  let nextRounds = appState.rounds;
  if (nextRounds.current?.wordKeys.includes(appState.practice.activeQuestion.wordKey)) {
    nextRounds = {
      ...nextRounds,
      current: applyRoundDecision(
        nextRounds.current,
        appState.practice.activeQuestion.wordKey,
        status
      )
    };
    nextRounds = completeRound(nextRounds, decidedAt).rounds;
  }
  appState = {
    ...appState,
    learning: decision.learning,
    practice: {
      ...appState.practice,
      activeQuestion: decision.activeQuestion,
      reviewQueue: nextReviewQueue
    },
    rounds: nextRounds
  };
  replaceActiveQuestion();
  renderActiveQuestion();
}

function changeMode(mode) {
  if (
    appState.practice.mode === mode ||
    appState.practice.activeQuestion?.phase === "graded"
  ) {
    return;
  }

  appState = {
    ...appState,
    practice: {
      ...appState.practice,
      mode
    }
  };
  replaceActiveQuestion();
  renderActiveQuestion();
}

function isActiveQuestionAllowedInMode() {
  const activeQuestion = appState.practice.activeQuestion;
  if (!activeQuestion) {
    return false;
  }
  const currentRound = appState.rounds.current;
  if (
    currentRound &&
    (
      !currentRound.wordKeys.includes(activeQuestion.wordKey) ||
      currentRound.progressByWord[activeQuestion.wordKey]?.mastered
    )
  ) {
    return false;
  }
  return (
    appState.practice.mode !== PRACTICE_MODES.INTENSIVE ||
    getLearningRecord(appState.learning, activeQuestion.wordKey).status === LEARNING_STATUSES.REVIEW
  );
}

function renderModeControls(activeQuestion) {
  const isRandom = appState.practice.mode === PRACTICE_MODES.RANDOM;
  elements.modeRandom.setAttribute("aria-pressed", String(isRandom));
  elements.modeIntensive.setAttribute("aria-pressed", String(!isRandom));
  const controlsLocked = activeQuestion?.phase === "graded" || appState.practice.roundPreparation;
  elements.modeRandom.disabled = controlsLocked;
  elements.modeIntensive.disabled = controlsLocked;
}

function renderEmptyState() {
  const isRoundIntensive = appState.rounds.current && appState.practice.mode === PRACTICE_MODES.INTENSIVE;
  elements.type.textContent = appState.practice.mode === PRACTICE_MODES.INTENSIVE
    ? "待强化专练"
    : "轮次完成";
  elements.word.textContent = isRoundIntensive ? "本轮暂无待强化词" : "暂无待强化词";
  elements.prompt.textContent = isRoundIntensive
    ? "切换到随机练习继续本轮学习。"
    : "答错或主动加入待强化后，可在这里集中练习。";
  elements.prompt.classList.remove("prompt-multiple");
  elements.wordStatus.textContent = "";
  elements.wordStatus.removeAttribute("data-status");
  elements.options.replaceChildren();
  elements.options.hidden = true;
  elements.empty.hidden = false;
  elements.feedback.textContent = "";
  elements.submit.hidden = true;
  elements.decisions.hidden = true;
  elements.next.hidden = true;
}

function startNewRound() {
  if (appState.rounds.current || appState.practice.activeQuestion?.phase === "graded") {
    return;
  }

  const availableWordKeys = getEligibleWordKeys(report.index).filter(
    (wordKey) => getLearningRecord(appState.learning, wordKey).status !== LEARNING_STATUSES.REMEMBERED
  );
  const requestedSize = getSelectedRoundSize();

  try {
    const preparedQuestion = appState.practice.roundPreparation
      ? appState.practice.activeQuestion
      : null;
    const round = createRound({
      eligibleWordKeys: getEligibleWordKeys(report.index),
      learning: appState.learning,
      requestedSize,
      firstWordKey: preparedQuestion?.wordKey ?? null,
      createdAt: new Date().toISOString()
    });
    if (preparedQuestion) {
      const shown = markRoundWordShown({
        round,
        learning: appState.learning,
        wordKey: preparedQuestion.wordKey
      });
      appState = {
        ...appState,
        learning: shown.learning,
        practice: {
          ...appState.practice,
          mode: PRACTICE_MODES.RANDOM,
          activeQuestion: preparedQuestion,
          roundPreparation: false,
          roundPreparationSize: null,
          roundPreparationCustom: false
        },
        rounds: {
          ...appState.rounds,
          current: shown.round
        }
      };
      persistState();
      renderActiveQuestion();
      return;
    }
    appState = {
      ...appState,
      practice: {
        ...appState.practice,
        mode: PRACTICE_MODES.RANDOM,
        activeQuestion: null,
        roundPreparation: false,
        roundPreparationSize: null,
        roundPreparationCustom: false
      },
      rounds: {
        ...appState.rounds,
        current: round
      }
    };
    replaceActiveQuestion();
    renderActiveQuestion();
  } catch (error) {
    elements.roundSummary.hidden = false;
    elements.roundSummary.textContent = error.message;
  }

  elements.customRoundSize.max = String(availableWordKeys.length);
}

function openAbandonConfirmation() {
  if (!appState.rounds.current) {
    return;
  }

  isAbandonConfirmationOpen = true;
  renderRoundControls();
  elements.cancelAbandon.focus();
}

function closeAbandonConfirmation() {
  isAbandonConfirmationOpen = false;
  renderRoundControls();
  elements.abandonRound.focus();
}

function confirmAbandonCurrentRound() {
  if (!appState.rounds.current) {
    closeAbandonConfirmation();
    return;
  }

  dismissedCompletionRoundId = appState.rounds.lastCompletedSummary?.roundId ?? null;
  isAbandonConfirmationOpen = false;
  enterNextRoundPreparation();
}

function startNextRoundFromCompletion() {
  dismissedCompletionRoundId = appState.rounds.lastCompletedSummary?.roundId ?? null;
  openPracticeView();
  enterNextRoundPreparation();
}

function enterNextRoundPreparation() {
  const previousWordKey = appState.practice.activeQuestion?.wordKey ?? null;
  const previousRoundSize = appState.rounds.current?.requestedSize ??
    appState.rounds.lastCompletedSummary?.totalWords ??
    getSelectedRoundSize();
  const eligibleWordKeys = getEligibleWordKeys(report.index).filter(
    (wordKey) => getLearningRecord(appState.learning, wordKey).status !== LEARNING_STATUSES.REMEMBERED
  );
  const wordKey = selectPracticeWordKey({
    mode: PRACTICE_MODES.RANDOM,
    eligibleWordKeys,
    learning: appState.learning,
    reviewQueue: appState.practice.reviewQueue,
    attemptCount: appState.practice.freeAttemptCount,
    excludeWordKey: previousWordKey
  });
  const question = wordKey ? createQuestion(report.index, { wordKey }) : null;
  appState = {
    ...appState,
    practice: {
      ...appState.practice,
      mode: PRACTICE_MODES.RANDOM,
      activeQuestion: question ? createActiveQuestion(question) : null,
      roundPreparation: Boolean(question),
      roundPreparationSize: question ? previousRoundSize : null,
      roundPreparationCustom: Boolean(
        question && !PRESET_ROUND_SIZES.includes(previousRoundSize)
      )
    },
    rounds: abandonRound(appState.rounds)
  };
  persistState();
  renderActiveQuestion();
  elements.roundSize.focus();
}

function openCompletionIntensive() {
  dismissedCompletionRoundId = appState.rounds.lastCompletedSummary?.roundId ?? null;
  openPracticeView();
  changeMode(PRACTICE_MODES.INTENSIVE);
  renderRoundControls();
}

function renderRoundControls() {
  if (!appState) {
    return;
  }
  const currentRound = appState.rounds.current;
  const availableCount = getEligibleWordKeys(report.index).filter(
    (wordKey) => getLearningRecord(appState.learning, wordKey).status !== LEARNING_STATUSES.REMEMBERED
  ).length;
  const isGraded = appState.practice.activeQuestion?.phase === "graded";

  applyPreparedRoundSize();

  elements.roundSetup.hidden = Boolean(currentRound);
  elements.roundActive.hidden = !currentRound;
  elements.customRoundSize.min = "5";
  elements.customRoundSize.max = String(availableCount);
  elements.startRound.disabled = availableCount < 5 || isGraded;
  elements.startNextRound.disabled = availableCount < 5 || isGraded;
  elements.completionIntensive.disabled = isGraded;
  elements.abandonRound.disabled = false;
  for (const option of elements.roundSize.options) {
    if (option.value !== "custom") {
      option.disabled = Number(option.value) > availableCount;
    }
  }
  if (elements.roundSize.selectedOptions[0]?.disabled) {
    const firstAvailablePreset = [...elements.roundSize.options].find(
      (option) => option.value !== "custom" && !option.disabled
    );
    elements.roundSize.value = firstAvailablePreset?.value ?? "custom";
  }
  elements.customRoundSize.hidden = elements.roundSize.value !== "custom";

  if (currentRound) {
    const { masteredCount } = getCurrentRoundCounts();
    elements.roundProgress.textContent = `本轮已掌握 ${masteredCount} / 总数 ${currentRound.wordKeys.length} · 答题 ${currentRound.attemptCount} 次`;
  }

  const summary = appState.rounds.lastCompletedSummary;
  const showCompletion = !isAbandonConfirmationOpen && shouldShowCompletionModal({
    summary,
    currentRound,
    dismissedRoundId: dismissedCompletionRoundId
  });
  elements.completionModal.hidden = !showCompletion;
  elements.abandonConfirmModal.hidden = !isAbandonConfirmationOpen;
  const isModalOpen = showCompletion || isAbandonConfirmationOpen;
  elements.siteHeader.toggleAttribute("inert", isModalOpen);
  elements.practiceMain.toggleAttribute("inert", isModalOpen);
  elements.wordbookMain.toggleAttribute("inert", isModalOpen);
  if (isModalOpen) {
    elements.siteHeader.setAttribute("aria-hidden", "true");
    elements.practiceMain.setAttribute("aria-hidden", "true");
    elements.wordbookMain.setAttribute("aria-hidden", "true");
  } else {
    elements.siteHeader.removeAttribute("aria-hidden");
    elements.practiceMain.removeAttribute("aria-hidden");
    elements.wordbookMain.removeAttribute("aria-hidden");
  }
  document.body.classList.toggle("modal-open", isModalOpen);
  elements.roundSummary.hidden = true;
  if (showCompletion) {
    elements.completionTotal.textContent = String(summary.totalWords);
    if (!completionWasOpen) {
      elements.startNextRound.focus();
    }
  }
  completionWasOpen = showCompletion;
}

function handleRoundSizeChange() {
  if (appState.practice.roundPreparation) {
    appState = {
      ...appState,
      practice: {
        ...appState.practice,
        roundPreparationSize: getSelectedRoundSize(),
        roundPreparationCustom: elements.roundSize.value === "custom"
      }
    };
    persistState();
  }
  renderRoundControls();
}

function getSelectedRoundSize() {
  return elements.roundSize.value === "custom"
    ? Number(elements.customRoundSize.value)
    : Number(elements.roundSize.value);
}

function applyPreparedRoundSize() {
  const size = appState.practice.roundPreparationSize;
  if (!appState.practice.roundPreparation) {
    return;
  }
  if (appState.practice.roundPreparationCustom) {
    elements.roundSize.value = "custom";
    if (Number.isInteger(size) && size >= 5) {
      elements.customRoundSize.value = String(size);
    }
  } else if (PRESET_ROUND_SIZES.includes(size)) {
    elements.roundSize.value = String(size);
  } else if (Number.isInteger(size) && size >= 5) {
    elements.roundSize.value = "custom";
    elements.customRoundSize.value = String(size);
  }
}

function renderQuestionRoundStatus() {
  const counts = getCurrentRoundCounts();
  elements.questionRoundStatus.hidden = !counts;
  if (!counts) {
    elements.lastRoundWordHint.hidden = true;
    return;
  }

  elements.questionRoundMastered.textContent = String(counts.masteredCount);
  elements.questionRoundTotal.textContent = String(counts.totalCount);
  elements.lastRoundWordHint.hidden = counts.remainingCount !== 1;
}

function getCurrentRoundCounts() {
  const currentRound = appState?.rounds?.current;
  if (!currentRound) {
    return null;
  }

  const masteredCount = currentRound.wordKeys.filter(
    (wordKey) => currentRound.progressByWord[wordKey]?.mastered
  ).length;
  return {
    masteredCount,
    totalCount: currentRound.wordKeys.length,
    remainingCount: currentRound.wordKeys.length - masteredCount
  };
}

function renderDashboard() {
  const model = createHomeDashboardModel({
    allWordKeys: report.index.allWordKeys,
    learning: appState.learning,
    currentRound: appState.rounds.current,
    displayByWordKey: report.index.displayByWordKey
  });
  elements.overallProgressCount.textContent = `${model.rememberedCount} / ${model.totalCount}`;
  elements.overallProgressBar.style.width = `${model.rememberedPercent}%`;
  elements.reviewCountStat.textContent = String(model.reviewCount);

  elements.reviewRanking.replaceChildren();
  for (const item of model.topReviewWords) {
    const row = document.createElement("li");
    const word = document.createElement("span");
    const count = document.createElement("strong");
    word.textContent = item.displayText;
    count.textContent = `${item.errorCount}次`;
    row.append(word, count);
    elements.reviewRanking.append(row);
  }
  elements.reviewRankingEmpty.hidden = model.topReviewWords.length > 0;
  elements.reviewRanking.hidden = model.topReviewWords.length === 0;
}

function openPracticeFromLink(event) {
  event.preventDefault();
  openPracticeView();
  elements.word.focus();
}

function openPracticeView(updateRoute = true) {
  isWordbookOpen = false;
  elements.practiceMain.hidden = false;
  elements.wordbookMain.hidden = true;
  elements.practiceNav.classList.add("nav-link-current");
  elements.wordbookNav.classList.remove("nav-link-current");
  if (updateRoute && window.location.hash === "#wordbook") {
    updateViewRoute("#practice-card");
  }
}

function openWordbookView(updateRoute = true) {
  isWordbookOpen = true;
  elements.practiceMain.hidden = true;
  elements.wordbookMain.hidden = false;
  elements.practiceNav.classList.remove("nav-link-current");
  elements.wordbookNav.classList.add("nav-link-current");
  if (updateRoute && window.location.hash !== "#wordbook") {
    updateViewRoute("#wordbook");
  }
  renderWordbook();
}

function renderViewFromLocation() {
  if (window.location.hash === "#wordbook") {
    openWordbookView(false);
  } else {
    openPracticeView(false);
  }
}

function updateViewRoute(hash) {
  window.history.pushState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${hash}`
  );
}

function handleWordbookSearch(event) {
  wordbookQuery = event.target.value;
  wordbookNotice = "";
  renderWordbook();
}

function clearWordbookSearch() {
  elements.wordbookSearch.value = "";
  wordbookQuery = "";
  wordbookNotice = "";
  renderWordbook();
  elements.wordbookSearch.focus();
}

function handleWordbookFilter(event) {
  const button = event.target.closest("[data-filter]");
  if (!button || !elements.wordbookFilters.contains(button)) {
    return;
  }
  wordbookFilter = button.dataset.filter;
  wordbookNotice = "";
  renderWordbook();
}

function renderWordbook() {
  const annotations = currentVocabulary.word_details ?? currentVocabulary.wordDetails ?? {};
  const entries = createWordbookEntries(report.index, appState.learning, annotations);
  const isCategoryTree = wordbookFilter === WORDBOOK_FILTERS.ALL && !wordbookQuery.trim();
  elements.clearWordbookSearch.hidden = !wordbookQuery;
  if (isCategoryTree) {
    const categoryTree = createWordbookCategoryTree(report.index, appState.learning, annotations);
    renderWordbookCategoryTree(categoryTree);
    elements.wordbookResultCount.textContent = `${categoryTree.length} 个分类`;
    elements.wordbookEmpty.hidden = categoryTree.length > 0;
    elements.wordbookList.hidden = categoryTree.length === 0;
    renderWordbookFilterState();
    return;
  }

  const visibleEntries = filterWordbookEntries(entries, {
    filter: wordbookFilter,
    query: wordbookQuery
  });
  const fragment = document.createDocumentFragment();

  for (const entry of visibleEntries) {
    const nextStatus = wordbookFilter === WORDBOOK_FILTERS.REVIEW
      ? LEARNING_STATUSES.REMEMBERED
      : wordbookFilter === WORDBOOK_FILTERS.REMEMBERED
        ? LEARNING_STATUSES.REVIEW
        : null;
    fragment.append(createWordbookRow(entry, {
      nextStatus,
      compactSearchResult: Boolean(wordbookQuery.trim())
    }));
  }

  elements.wordbookList.replaceChildren(fragment);
  elements.wordbookResultCount.textContent = `${visibleEntries.length} 个词条`;
  elements.wordbookNotice.textContent = wordbookNotice;
  elements.wordbookEmpty.hidden = visibleEntries.length > 0;
  elements.wordbookList.hidden = visibleEntries.length === 0;
  renderWordbookFilterState();
}

function renderWordbookCategoryTree(categoryTree) {
  const fragment = document.createDocumentFragment();
  for (const group of categoryTree) {
    const section = document.createElement("section");
    const toggle = document.createElement("button");
    const arrow = document.createElement("span");
    const name = document.createElement("strong");
    const count = document.createElement("span");
    const isExpanded = expandedWordbookGroupIds.has(group.groupId);

    section.className = "wordbook-category-node";
    toggle.type = "button";
    toggle.className = "wordbook-category-toggle";
    toggle.dataset.categoryGroupId = String(group.groupId);
    toggle.setAttribute("aria-expanded", String(isExpanded));
    arrow.className = "wordbook-category-arrow";
    arrow.textContent = "▶";
    name.textContent = group.category;
    count.textContent = `${group.words.length} 个词`;
    toggle.append(arrow, name, count);
    section.append(toggle);

    if (isExpanded) {
      const words = document.createElement("div");
      words.className = "wordbook-category-words";
      for (const entry of group.words) {
        words.append(createWordbookRow(entry, {
          categories: [group.category],
          nextStatus: null
        }));
      }
      section.append(words);
    }
    fragment.append(section);
  }
  elements.wordbookList.replaceChildren(fragment);
  elements.wordbookNotice.textContent = wordbookNotice;
}

function createWordbookRow(entry, options = {}) {
  const row = document.createElement("article");
  const identity = document.createElement("div");
  const word = document.createElement("strong");
  const detailButton = document.createElement("button");
  const categories = document.createElement("div");
  const statusCell = document.createElement("div");
  const statusBadge = document.createElement("span");
  const categoryNames = options.categories ?? entry.categories.map(({ category }) => category);

  row.className = "wordbook-row";
  row.classList.toggle("wordbook-row-action", Boolean(options.nextStatus));
  row.classList.toggle("wordbook-row-search", Boolean(options.compactSearchResult));
  row.dataset.wordKey = entry.wordKey;
  identity.className = "wordbook-word";
  word.textContent = entry.displayText;
  detailButton.type = "button";
  detailButton.className = "word-detail-trigger";
  detailButton.dataset.detailWordKey = entry.wordKey;
  detailButton.textContent = "查看注释";
  identity.append(word, detailButton);

  categories.className = "wordbook-categories";
  categories.setAttribute("aria-label", "所属分类");
  for (const category of categoryNames) {
    const categoryElement = document.createElement("span");
    categoryElement.className = "wordbook-category";
    categoryElement.textContent = category;
    categories.append(categoryElement);
  }

  statusCell.className = "wordbook-status-cell";
  statusBadge.className = "wordbook-status-badge";
  statusBadge.dataset.status = entry.status;
  statusBadge.textContent = statusLabel(entry.status);
  if (!options.nextStatus) {
    statusCell.append(statusBadge);
  } else {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "button button-compact wordbook-status-action";
    action.dataset.statusWordKey = entry.wordKey;
    action.dataset.nextStatus = options.nextStatus;
    action.textContent = options.nextStatus === LEARNING_STATUSES.REMEMBERED
      ? "加入已记忆"
      : "加入待强化";
    statusCell.append(action);
    if (entry.wordKey === appState.practice.activeQuestion?.wordKey) {
      const currentNote = document.createElement("span");
      currentNote.className = "wordbook-current-note";
      currentNote.textContent = "当前题完成前不可修改";
      statusCell.append(currentNote);
    }
  }

  row.append(identity, categories, statusCell);
  return row;
}

function renderWordbookFilterState() {
  for (const button of elements.wordbookFilters.querySelectorAll("[data-filter]")) {
    const isActive = button.dataset.filter === wordbookFilter;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function handleWordbookStatusChange(wordKey, status) {
  const result = applyWordbookStatusChange({
    state: appState,
    wordKey,
    status,
    changedAt: new Date().toISOString()
  });
  if (!result.applied) {
    wordbookNotice = result.reason === "active-question"
      ? "请先完成当前题。"
      : "学习状态没有变化。";
    renderWordbook();
    return;
  }

  appState = result.state;
  persistState();
  wordbookNotice = persistenceError;
  renderActiveQuestion();
  if (isWordbookOpen) {
    renderWordbook();
  }
}

function handleWordbookListClick(event) {
  const categoryToggle = event.target.closest("[data-category-group-id]");
  if (categoryToggle && elements.wordbookList.contains(categoryToggle)) {
    const groupId = Number(categoryToggle.dataset.categoryGroupId);
    if (expandedWordbookGroupIds.has(groupId)) {
      expandedWordbookGroupIds.delete(groupId);
    } else {
      expandedWordbookGroupIds.add(groupId);
    }
    renderWordbook();
    return;
  }

  const statusAction = event.target.closest("[data-status-word-key]");
  if (statusAction && elements.wordbookList.contains(statusAction)) {
    handleWordbookStatusChange(
      statusAction.dataset.statusWordKey,
      statusAction.dataset.nextStatus
    );
    return;
  }

  const detailButton = event.target.closest("[data-detail-word-key]");
  if (detailButton && elements.wordbookList.contains(detailButton)) {
    openWordDetail(detailButton.dataset.detailWordKey);
  }
}

function openWordDetail(wordKey) {
  const annotations = currentVocabulary.word_details ?? currentVocabulary.wordDetails ?? {};
  const entry = createWordbookEntries(report.index, appState.learning, annotations)
    .find((item) => item.wordKey === wordKey);
  if (!entry) {
    return;
  }

  elements.wordDetailTitle.textContent = entry.displayText;
  elements.wordDetailContent.replaceChildren();
  if (!hasWordDetails(entry.details)) {
    const empty = document.createElement("p");
    empty.className = "word-detail-empty";
    empty.textContent = "暂未添加单词注释";
    elements.wordDetailContent.append(empty);
  } else {
    appendWordDetail("音标", entry.details.phonetic);
    appendWordDetail("释义", entry.details.definition);
    appendWordDetailList("常用搭配", entry.details.collocations);
    appendWordDetailList("例句", entry.details.examples);
  }
  elements.wordDetailModal.hidden = false;
  elements.siteHeader.setAttribute("inert", "");
  elements.practiceMain.setAttribute("inert", "");
  elements.wordbookMain.setAttribute("inert", "");
  document.body.classList.add("modal-open");
  elements.closeWordDetail.focus();
}

function appendWordDetail(title, value) {
  if (!value) {
    return;
  }
  const heading = document.createElement("h3");
  const content = document.createElement("p");
  heading.textContent = title;
  content.textContent = value;
  elements.wordDetailContent.append(heading, content);
}

function appendWordDetailList(title, values) {
  if (!values.length) {
    return;
  }
  const heading = document.createElement("h3");
  const list = document.createElement("ul");
  heading.textContent = title;
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  }
  elements.wordDetailContent.append(heading, list);
}

function closeWordDetail() {
  elements.wordDetailModal.hidden = true;
  renderRoundControls();
}

function persistState() {
  try {
    appState = saveAppState(appState);
    persistenceError = "";
    return true;
  } catch {
    persistenceError = "保存失败，请检查浏览器是否允许使用本地存储。";
    return false;
  }
}

function statusLabel(status) {
  return {
    [LEARNING_STATUSES.NEW]: "待学习",
    [LEARNING_STATUSES.REVIEW]: "待强化",
    [LEARNING_STATUSES.REMEMBERED]: "已记忆"
  }[status] ?? "待学习";
}

function showFatalError(message) {
  elements.type.textContent = "数据错误";
  elements.word.textContent = "无法开始练习";
  elements.prompt.textContent = "请先修复阶段 0 检测到的阻断问题。";
  elements.prompt.classList.remove("prompt-multiple");
  elements.feedback.textContent = message;
  elements.feedback.className = "feedback fatal";
  elements.submit.disabled = true;
}
