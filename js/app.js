import { vocabularyData } from "./data/vocabulary.js";
import { defaultVocabularyData } from "./data/default-vocabulary.js";
import { validateVocabularyData } from "./core/vocabulary-validator.js?v=8.1";
import {
  createQuestion,
  getEligibleWordKeys,
  isAnswerCorrect
} from "./core/question-engine.js";
import {
  applyMasteryDecision,
  getLearningRecord,
  LEARNING_STATUSES,
  removeLearningRecord,
  recordAnswer
} from "./core/learning-service.js?v=7.2c3b";
import {
  createDefaultAppState,
  loadAppState,
  normalizeAppState,
  saveAppState,
  STORAGE_KEY
} from "./core/storage.js?v=8.4c1";
import { createVocabularyRepository } from "./core/vocabulary-repository.js?v=8.4c1";
import { downloadVocabularyExport } from "./core/vocabulary-export-service.js?v=7.3a";
import {
  assertVocabularyImportAllowed,
  commitVocabularyImport,
  createVocabularyImportSummary,
  prepareVocabularyImportFile,
  resetVocabularyImportInput,
  VOCABULARY_IMPORT_ERROR_CODES
} from "./core/vocabulary-import-service.js?v=7.3b";
import {
  addCategory,
  createCategoryList,
  deleteCategory,
  renameCategory
} from "./core/vocabulary-category-service.js?v=7.2c1";
import {
  addVocabularyWord,
  createWordManagementEntries,
  deleteCustomVocabularyWord,
  detectWordIdentityChange,
  editVocabularyWord,
  removeVocabularyWordRelation
} from "./core/vocabulary-word-service.js?v=7.2c3b";
import { normalizeWordKey } from "./core/normalization.js";
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
} from "./ui/home-dashboard.js?v=9.1a";
import {
  applyWordbookStatusChange,
  createWordbookDataCache,
  filterWordbookEntries,
  WORDBOOK_FILTERS
} from "./core/wordbook-service.js?v=8.4c3";
import { createVocabularyCard } from "./ui/vocabulary-card.js?v=8.4c";
import {
  createVocabularyCardOverlayController
} from "./ui/vocabulary-card-overlay.js?v=8.3.1";

const vocabularyRepository = createVocabularyRepository({
  fallbackVocabulary: defaultVocabularyData,
  legacyStateKey: STORAGE_KEY
});
const systemWordKeys = new Set(
  vocabularyData.vocabulary_list
    .flatMap((group) => Array.isArray(group?.words) ? group.words : [])
    .map(normalizeWordKey)
    .filter(Boolean)
);
const systemWordKeyList = [...systemWordKeys];
let currentVocabulary = vocabularyRepository.load();
let report = vocabularyRepository.getCurrentValidation();
const elements = {
  siteHeader: document.querySelector("#site-header"),
  practiceMain: document.querySelector("#practice-main"),
  wordbookMain: document.querySelector("#wordbook-main"),
  vocabularyManagerMain: document.querySelector("#vocabulary-manager-main"),
  homeLink: document.querySelector("#home-link"),
  practiceNav: document.querySelector("#practice-nav"),
  startRoundNav: document.querySelector(".nav-start-round"),
  wordbookNav: document.querySelector("#wordbook-nav"),
  vocabularyManagerNav: document.querySelector("#vocabulary-manager-nav"),
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
  viewQuestionDetails: document.querySelector("#view-question-details"),
  modeRandom: document.querySelector("#mode-random"),
  modeIntensive: document.querySelector("#mode-intensive"),
  empty: document.querySelector("#empty-state"),
  roundSetup: document.querySelector("#round-setup"),
  roundPanel: document.querySelector("#round-panel"),
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
  vocabularyCardOverlay: document.querySelector("#vocabulary-card-overlay"),
  vocabularyCardHost: document.querySelector("#vocabulary-card-host"),
  vocabularyManagerBack: document.querySelector("#vocabulary-manager-back"),
  toggleAddCategory: document.querySelector("#toggle-add-category"),
  importVocabulary: document.querySelector("#import-vocabulary"),
  vocabularyImportInput: document.querySelector("#vocabulary-import-input"),
  exportVocabulary: document.querySelector("#export-vocabulary"),
  addCategoryForm: document.querySelector("#add-category-form"),
  newCategoryName: document.querySelector("#new-category-name"),
  newCategoryWords: document.querySelector("#new-category-words"),
  addCategoryWordRow: document.querySelector("#add-category-word-row"),
  cancelAddCategory: document.querySelector("#cancel-add-category"),
  categoryManagerSearch: document.querySelector("#category-manager-search"),
  clearCategoryManagerSearch: document.querySelector("#clear-category-manager-search"),
  categoryManagerCount: document.querySelector("#category-manager-count"),
  categoryManagerNotice: document.querySelector("#category-manager-notice"),
  categoryManagerList: document.querySelector("#category-manager-list"),
  categoryManagerSection: document.querySelector("#category-manager-section"),
  categoryManagerEmpty: document.querySelector("#category-manager-empty"),
  vocabularyDeleteModal: document.querySelector("#vocabulary-delete-modal"),
  vocabularyDeleteTitle: document.querySelector("#vocabulary-delete-title"),
  vocabularyDeleteMessage: document.querySelector("#vocabulary-delete-message"),
  cancelVocabularyDelete: document.querySelector("#cancel-vocabulary-delete"),
  confirmVocabularyDelete: document.querySelector("#confirm-vocabulary-delete"),
  vocabularyImportModal: document.querySelector("#vocabulary-import-modal"),
  currentVocabularyCategoryCount: document.querySelector("#current-vocabulary-category-count"),
  currentVocabularyWordCount: document.querySelector("#current-vocabulary-word-count"),
  importVocabularyCategoryCount: document.querySelector("#import-vocabulary-category-count"),
  importVocabularyWordCount: document.querySelector("#import-vocabulary-word-count"),
  cancelVocabularyImport: document.querySelector("#cancel-vocabulary-import"),
  confirmVocabularyImport: document.querySelector("#confirm-vocabulary-import")
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
const wordbookDataCache = createWordbookDataCache();
const expandedWordbookGroupIds = new Set();
let editingCategoryGroupId = null;
let categoryManagerNotice = "";
let categoryManagerNoticeTone = "success";
let categoryManagerQuery = "";
let isCategoryCreateOpen = false;
let newCategoryWordRowCount = 1;
let editingCategoryWordKey = null;
let addingWordGroupId = null;
let pendingVocabularyDeleteAction = null;
let pendingVocabularyImport = null;
const expandedManagerGroupIds = new Set();
let editingWordKey = null;

const vocabularyCardOverlayController = createVocabularyCardOverlayController({
  overlay: elements.vocabularyCardOverlay,
  host: elements.vocabularyCardHost,
  body: document.body,
  backgroundElements: [
    elements.siteHeader,
    elements.practiceMain,
    elements.wordbookMain,
    elements.vocabularyManagerMain
  ],
  documentRef: document
});

elements.submit.addEventListener("click", submitAnswer);
elements.markReview.addEventListener("click", () => chooseMasteryStatus(LEARNING_STATUSES.REVIEW));
elements.markRemembered.addEventListener("click", () => chooseMasteryStatus(LEARNING_STATUSES.REMEMBERED));
elements.next.addEventListener("click", showNextQuestion);
elements.viewQuestionDetails.addEventListener("click", openActiveQuestionDetails);
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
elements.completionIntensive.addEventListener("click", returnFromCompletion);
elements.homeLink.addEventListener("click", openPracticeFromLink);
elements.practiceNav.addEventListener("click", openPracticeFromLink);
elements.startRoundNav.addEventListener("click", () => openPracticeView());
elements.wordbookNav.addEventListener("click", openWordbookView);
elements.wordbookBack.addEventListener("click", openPracticeView);
elements.vocabularyManagerNav.addEventListener("click", openVocabularyManagerView);
elements.vocabularyManagerBack.addEventListener("click", openPracticeView);
elements.toggleAddCategory.addEventListener("click", openCategoryCreateFormB3);
elements.importVocabulary.addEventListener("click", () => elements.vocabularyImportInput.click());
elements.vocabularyImportInput.addEventListener("change", handleVocabularyImportSelection);
elements.exportVocabulary.addEventListener("click", exportCurrentVocabulary);
elements.addCategoryForm.addEventListener("submit", handleAddCategoryB3);
elements.addCategoryWordRow.addEventListener("click", addCategoryCreateWordRowB3);
elements.cancelAddCategory.addEventListener("click", closeCategoryCreateFormB3);
elements.newCategoryWords.addEventListener("click", handleCategoryCreateWordsClickB3);
elements.categoryManagerSearch.addEventListener("input", handleCategoryManagerSearchB3);
elements.clearCategoryManagerSearch.addEventListener("click", clearCategoryManagerSearchB3);
elements.categoryManagerList.addEventListener("click", handleCategoryManagerClickB3);
elements.categoryManagerList.addEventListener("submit", handleCategoryManagerSubmitB3);
elements.categoryManagerList.addEventListener("keydown", handleCategoryManagerKeydownB3);
elements.cancelVocabularyDelete.addEventListener("click", closeVocabularyDeleteConfirmationB3);
elements.confirmVocabularyDelete.addEventListener("click", confirmVocabularyDeleteB3);
elements.cancelVocabularyImport.addEventListener("click", closeVocabularyImportConfirmation);
elements.confirmVocabularyImport.addEventListener("click", confirmVocabularyImport);
elements.wordbookSearch.addEventListener("input", handleWordbookSearch);
elements.clearWordbookSearch.addEventListener("click", clearWordbookSearch);
elements.wordbookFilters.addEventListener("click", handleWordbookFilter);
elements.wordbookList.addEventListener("click", handleWordbookListClick);
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

function exportCurrentVocabulary() {
  try {
    downloadVocabularyExport(vocabularyRepository);
    setCategoryManagerNotice("词库已导出", "success");
  } catch {
    setCategoryManagerNotice("词库导出失败，请重试", "error");
  }
  renderCategoryTreeManagerB3();
}

async function handleVocabularyImportSelection(event) {
  const file = event.target.files?.[0] ?? null;
  if (!file) {
    return;
  }

  try {
    const preparedImport = await prepareVocabularyImportFile(file);
    assertVocabularyImportAllowed(preparedImport, {
      activeQuestion: appState.practice.activeQuestion,
      activeRound: appState.rounds.current
    });
    openVocabularyImportConfirmation(preparedImport);
  } catch (error) {
    setCategoryManagerNotice(getVocabularyImportErrorMessage(error), "error");
    renderCategoryTreeManagerB3();
  } finally {
    resetVocabularyImportInput(elements.vocabularyImportInput);
  }
}

function openVocabularyImportConfirmation(preparedImport) {
  const currentSummary = createVocabularyImportSummary(
    vocabularyRepository.getCurrentVocabulary(),
    report
  );
  pendingVocabularyImport = preparedImport;
  elements.currentVocabularyCategoryCount.textContent = String(currentSummary.categoryCount);
  elements.currentVocabularyWordCount.textContent = String(currentSummary.uniqueWordCount);
  elements.importVocabularyCategoryCount.textContent = String(preparedImport.summary.categoryCount);
  elements.importVocabularyWordCount.textContent = String(preparedImport.summary.uniqueWordCount);
  elements.vocabularyImportModal.hidden = false;
  document.body.classList.add("modal-open");
  elements.cancelVocabularyImport.focus();
}

function closeVocabularyImportConfirmation() {
  pendingVocabularyImport = null;
  elements.vocabularyImportModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function confirmVocabularyImport() {
  if (!pendingVocabularyImport) {
    return;
  }

  const preparedImport = pendingVocabularyImport;
  const nextState = normalizeAppState(appState, {
    defaultState: createDefaultAppState(),
    validWordKeys: new Set(preparedImport.validation.index.allWordKeys),
    validGroupIds: new Set(preparedImport.validation.index.groupById.keys()),
    correctGroupIdsByWordKey: preparedImport.validation.index.groupIdsByWordKey
  });

  try {
    const result = commitVocabularyImport(vocabularyRepository, preparedImport, {
      activeQuestion: appState.practice.activeQuestion,
      activeRound: appState.rounds.current,
      relatedState: nextState,
      saveRelatedState: saveAppState
    });
    currentVocabulary = result.vocabulary;
    report = result.validation;
    appState = result.relatedState;
    persistenceError = "";
    pendingVocabularyImport = null;
    elements.vocabularyImportModal.hidden = true;
    document.body.classList.remove("modal-open");
    editingCategoryGroupId = null;
    editingCategoryWordKey = null;
    addingWordGroupId = null;
    expandedManagerGroupIds.clear();
    setCategoryManagerNotice(
      `词库导入成功\n${result.summary.categoryCount} 个分类\n${result.summary.uniqueWordCount} 个唯一词条`,
      "success"
    );
    renderActiveQuestion();
    renderVocabularyManager();
  } catch (error) {
    setCategoryManagerNotice(getVocabularyImportErrorMessage(error), "error");
    closeVocabularyImportConfirmation();
    renderCategoryTreeManagerB3();
  }
}

function getVocabularyImportErrorMessage(error) {
  return {
    [VOCABULARY_IMPORT_ERROR_CODES.READ_ERROR]: "无法读取文件",
    [VOCABULARY_IMPORT_ERROR_CODES.JSON_ERROR]: "JSON 格式错误",
    [VOCABULARY_IMPORT_ERROR_CODES.INVALID_DATA]: "词库数据不合法",
    [VOCABULARY_IMPORT_ERROR_CODES.FILE_TOO_LARGE]: "文件过大，无法导入",
    [VOCABULARY_IMPORT_ERROR_CODES.ACTIVE_STATE]: "当前题或活动轮次正在使用旧词库，请先完成或结束本轮学习后再导入",
    [VOCABULARY_IMPORT_ERROR_CODES.SAVE_ERROR]: "保存失败"
  }[error?.code] ?? "词库数据不合法";
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
  elements.practiceMain.classList.remove("practice-empty-state");
  elements.options.hidden = false;
  const isMultiple = activeQuestion.correctGroupIds.length > 1;
  const record = getLearningRecord(appState.learning, activeQuestion.wordKey);

  elements.type.textContent = isMultiple ? "多选题" : "单选题";
  elements.word.textContent = report.index.displayByWordKey.get(activeQuestion.wordKey);
  elements.prompt.textContent = isMultiple ? "多选题" : "请选择对应的语义分类";
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
  const isLocked = isGraded;

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
  elements.viewQuestionDetails.hidden = (
    activeQuestion.phase === "answering"
  );
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
  if (activeQuestion.phase !== "answering") {
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
  renderOptions(appState.practice.activeQuestion, isMultiple);
  renderQuestionActions(appState.practice.activeQuestion);
}

function submitAnswer() {
  const activeQuestion = appState.practice.activeQuestion;
  if (activeQuestion.phase !== "answering") {
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
  if (appState.practice.mode === mode) {
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
  elements.modeRandom.disabled = false;
  elements.modeIntensive.disabled = false;
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
  elements.practiceMain.classList.add("practice-empty-state");
  elements.wordStatus.textContent = "";
  elements.wordStatus.removeAttribute("data-status");
  elements.options.replaceChildren();
  elements.options.hidden = true;
  elements.empty.hidden = false;
  elements.feedback.textContent = "";
  elements.submit.hidden = true;
  elements.decisions.hidden = true;
  elements.next.hidden = true;
  elements.viewQuestionDetails.hidden = true;
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
    const round = createRound({
      eligibleWordKeys: getEligibleWordKeys(report.index),
      learning: appState.learning,
      requestedSize,
      createdAt: new Date().toISOString()
    });
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
  enterFreePracticeAfterRound();
}

function startNextRoundFromCompletion() {
  dismissedCompletionRoundId = appState.rounds.lastCompletedSummary?.roundId ?? null;
  openPracticeView();
  enterFreePracticeAfterRound();
}

function enterFreePracticeAfterRound() {
  const previousRoundSize = appState.rounds.current?.requestedSize ??
    appState.rounds.lastCompletedSummary?.totalWords ??
    getSelectedRoundSize();
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
    rounds: abandonRound(appState.rounds)
  };
  applyRoundSizeToControls(previousRoundSize);
  replaceActiveQuestion();
  renderActiveQuestion();
  elements.word.focus();
}

function applyRoundSizeToControls(size) {
  if (PRESET_ROUND_SIZES.includes(size)) {
    elements.roundSize.value = String(size);
    return;
  }
  if (Number.isInteger(size) && size >= 5) {
    elements.roundSize.value = "custom";
    elements.customRoundSize.value = String(size);
  }
}

function returnFromCompletion() {
  dismissedCompletionRoundId = appState.rounds.lastCompletedSummary?.roundId ?? null;
  openPracticeView();
  if (appState.practice.mode !== PRACTICE_MODES.RANDOM) {
    appState = {
      ...appState,
      practice: {
        ...appState.practice,
        mode: PRACTICE_MODES.RANDOM
      }
    };
  }
  if (!isActiveQuestionAllowedInMode()) {
    replaceActiveQuestion();
  } else {
    persistState();
  }
  renderActiveQuestion();
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

  elements.roundSetup.hidden = Boolean(currentRound);
  elements.roundActive.hidden = !currentRound;
  elements.roundPanel.dataset.activeRound = String(Boolean(currentRound));
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
  elements.vocabularyManagerMain.toggleAttribute("inert", isModalOpen);
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
  renderRoundControls();
}

function getSelectedRoundSize() {
  return elements.roundSize.value === "custom"
    ? Number(elements.customRoundSize.value)
    : Number(elements.roundSize.value);
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
    allWordKeys: systemWordKeyList,
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
  elements.vocabularyManagerMain.hidden = true;
  elements.practiceNav.classList.add("nav-link-current");
  elements.wordbookNav.classList.remove("nav-link-current");
  elements.vocabularyManagerNav.classList.remove("nav-link-current");
  if (
    updateRoute &&
    ["#wordbook", "#vocabulary-manager"].includes(window.location.hash)
  ) {
    updateViewRoute("#practice-card");
  }
}

function openWordbookView(updateRoute = true) {
  isWordbookOpen = true;
  elements.practiceMain.hidden = true;
  elements.wordbookMain.hidden = false;
  elements.vocabularyManagerMain.hidden = true;
  elements.practiceNav.classList.remove("nav-link-current");
  elements.wordbookNav.classList.add("nav-link-current");
  elements.vocabularyManagerNav.classList.remove("nav-link-current");
  if (updateRoute && window.location.hash !== "#wordbook") {
    updateViewRoute("#wordbook");
  }
  renderWordbook();
}

function openVocabularyManagerView(updateRoute = true) {
  isWordbookOpen = false;
  elements.practiceMain.hidden = true;
  elements.wordbookMain.hidden = true;
  elements.vocabularyManagerMain.hidden = false;
  elements.practiceNav.classList.remove("nav-link-current");
  elements.wordbookNav.classList.remove("nav-link-current");
  elements.vocabularyManagerNav.classList.add("nav-link-current");
  if (updateRoute && window.location.hash !== "#vocabulary-manager") {
    updateViewRoute("#vocabulary-manager");
  }
  renderVocabularyManager();
}

function renderViewFromLocation() {
  if (window.location.hash === "#wordbook") {
    openWordbookView(false);
  } else if (window.location.hash === "#vocabulary-manager") {
    openVocabularyManagerView(false);
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

function handleVocabularyManagerTab(event) {
  const button = event.target.closest("[data-manager-section]");
  if (!button || !elements.vocabularyManagerTabs.contains(button)) {
    return;
  }
  vocabularyManagerSection = button.dataset.managerSection;
  renderVocabularyManager();
}

function renderVocabularyManager() {
  elements.addCategoryForm.hidden = !isCategoryCreateOpen;
  elements.toggleAddCategory.hidden = isCategoryCreateOpen;
  renderCategoryCreateWordRowsB3();
  renderCategoryTreeManagerB3();
}

function openCategoryCreateFormB3() {
  isCategoryCreateOpen = true;
  newCategoryWordRowCount = Math.max(1, newCategoryWordRowCount);
  renderVocabularyManager();
  elements.newCategoryName.focus();
}

function closeCategoryCreateFormB3() {
  isCategoryCreateOpen = false;
  elements.newCategoryName.value = "";
  newCategoryWordRowCount = 1;
  elements.newCategoryWords.replaceChildren();
  renderVocabularyManager();
}

function addCategoryCreateWordRowB3() {
  const values = getCategoryCreateWordValuesB3();
  newCategoryWordRowCount += 1;
  renderCategoryCreateWordRowsB3(values);
  const inputs = elements.newCategoryWords.querySelectorAll("input");
  inputs[inputs.length - 1]?.focus();
}

function handleCategoryCreateWordsClickB3(event) {
  const button = event.target.closest("[data-remove-new-category-word]");
  if (!button || !elements.newCategoryWords.contains(button)) {
    return;
  }
  const removeIndex = Number(button.dataset.removeNewCategoryWord);
  const values = getCategoryCreateWordValuesB3().filter((value, index) => index !== removeIndex);
  newCategoryWordRowCount = Math.max(1, values.length);
  renderCategoryCreateWordRowsB3(values);
}

function getCategoryCreateWordValuesB3() {
  return [...elements.newCategoryWords.querySelectorAll("input")].map((input) => input.value);
}

function renderCategoryCreateWordRowsB3(values = getCategoryCreateWordValuesB3()) {
  if (!isCategoryCreateOpen) {
    return;
  }
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < newCategoryWordRowCount; index += 1) {
    const row = document.createElement("div");
    const number = document.createElement("strong");
    const input = document.createElement("input");
    const remove = document.createElement("button");
    row.className = "category-create-word-row";
    number.textContent = `${index + 1}.`;
    input.type = "text";
    input.value = values[index] ?? "";
    input.autocomplete = "off";
    input.placeholder = "输入英文词条";
    input.setAttribute("aria-label", `词条 ${index + 1}`);
    remove.type = "button";
    remove.className = "button button-quiet button-compact";
    remove.dataset.removeNewCategoryWord = String(index);
    remove.textContent = "删除";
    remove.disabled = newCategoryWordRowCount === 1;
    row.append(number, input, remove);
    fragment.append(row);
  }
  elements.newCategoryWords.replaceChildren(fragment);
}

function handleAddCategoryB3(event) {
  event.preventDefault();
  try {
    const categoryResult = addCategory(currentVocabulary, elements.newCategoryName.value);
    let candidate = categoryResult.vocabulary;
    const nextGroupId = categoryResult.group.group_id;
    const seenWordKeys = new Set();
    const words = getCategoryCreateWordValuesB3().map((value) => value.trim()).filter(Boolean);

    for (const displayText of words) {
      const wordKey = normalizeWordKey(displayText);
      if (!wordKey || seenWordKeys.has(wordKey)) {
        continue;
      }
      seenWordKeys.add(wordKey);
      if (report.index.displayByWordKey.has(wordKey)) {
        const existingGroupIds = [...report.index.groupIdsByWordKey.get(wordKey)];
        const result = editVocabularyWord(
          candidate,
          wordKey,
          report.index.displayByWordKey.get(wordKey),
          [...existingGroupIds, nextGroupId]
        );
        candidate = result.vocabulary;
      } else {
        candidate = addVocabularyWord(candidate, displayText, [nextGroupId]).vocabulary;
      }
    }

    if (!saveVocabularyCandidate(candidate)) {
      renderCategoryTreeManagerB3();
      return;
    }
    expandedManagerGroupIds.add(nextGroupId);
    isCategoryCreateOpen = false;
    elements.newCategoryName.value = "";
    newCategoryWordRowCount = 1;
    elements.newCategoryWords.replaceChildren();
    setCategoryManagerNotice(`已创建分类“${categoryResult.group.category}”。`, "success");
  } catch (error) {
    setCategoryManagerNotice(error.message, "error");
  }
  renderVocabularyManager();
}

function handleCategoryManagerSearchB3(event) {
  categoryManagerQuery = event.target.value;
  renderCategoryTreeManagerB3();
}

function clearCategoryManagerSearchB3() {
  elements.categoryManagerSearch.value = "";
  categoryManagerQuery = "";
  renderCategoryTreeManagerB3();
  elements.categoryManagerSearch.focus();
}

function handleCategoryManagerClickB3(event) {
  const button = event.target.closest("[data-tree-action]");
  if (!button || !elements.categoryManagerList.contains(button)) {
    return;
  }
  const action = button.dataset.treeAction;
  const groupId = Number(button.dataset.groupId);
  const wordKey = button.dataset.wordKey;

  if (action === "submit-category") {
    elements.categoryManagerList.querySelector(
      `[data-tree-form="rename-category"][data-group-id="${groupId}"]`
    )?.requestSubmit();
    return;
  }
  if (action === "submit-word") {
    elements.categoryManagerList.querySelector(
      `[data-tree-form="edit-word"][data-word-key="${wordKey}"]`
    )?.requestSubmit();
    return;
  }
  if (action === "view-details") {
    openVocabularyDetails(wordKey);
    return;
  }
  if (action === "toggle") {
    if (expandedManagerGroupIds.has(groupId)) {
      expandedManagerGroupIds.delete(groupId);
    } else {
      expandedManagerGroupIds.add(groupId);
    }
  } else if (action === "edit-category") {
    editingCategoryGroupId = groupId;
    expandedManagerGroupIds.add(groupId);
  } else if (action === "cancel-category") {
    editingCategoryGroupId = null;
  } else if (action === "delete-category") {
    deleteCategoryFromTreeB3(groupId);
    return;
  } else if (action === "edit-word") {
    editingCategoryWordKey = wordKey;
    addingWordGroupId = null;
    expandedManagerGroupIds.add(groupId);
  } else if (action === "cancel-word") {
    editingCategoryWordKey = null;
  } else if (action === "delete-word-relation") {
    if (systemWordKeys.has(wordKey)) {
      deleteWordRelationB3(groupId, wordKey);
    } else {
      deleteCustomWordB3(wordKey);
    }
    return;
  } else if (action === "add-word") {
    addingWordGroupId = groupId;
    editingCategoryWordKey = null;
    expandedManagerGroupIds.add(groupId);
  } else if (action === "cancel-add-word") {
    addingWordGroupId = null;
  }

  setCategoryManagerNotice("", "success");
  renderCategoryTreeManagerB3();
  if (action === "edit-category") {
    elements.categoryManagerList.querySelector(`[data-tree-category-input="${groupId}"]`)?.focus();
  } else if (action === "edit-word") {
    elements.categoryManagerList.querySelector(`[data-tree-word-input="${wordKey}"]`)?.focus();
  } else if (action === "add-word") {
    elements.categoryManagerList.querySelector(`[data-tree-add-word-input="${groupId}"]`)?.focus();
  }
}

function handleCategoryManagerSubmitB3(event) {
  const form = event.target.closest("[data-tree-form]");
  if (!form || !elements.categoryManagerList.contains(form)) {
    return;
  }
  event.preventDefault();
  const groupId = Number(form.dataset.groupId);
  if (form.dataset.treeForm === "rename-category") {
    renameCategoryFromTreeB3(groupId, form.querySelector("input")?.value ?? "");
  } else if (form.dataset.treeForm === "edit-word") {
    editCategoryWordFromTreeB3(
      form.dataset.wordKey,
      form.querySelector("input")?.value ?? ""
    );
  } else if (form.dataset.treeForm === "add-word") {
    addWordToCategoryB3(groupId, form.querySelector("input")?.value ?? "");
  }
}

function handleCategoryManagerKeydownB3(event) {
  if (event.key !== "Escape") {
    return;
  }
  if (event.target.matches("[data-tree-category-input]")) {
    editingCategoryGroupId = null;
  } else if (event.target.matches("[data-tree-word-input]")) {
    editingCategoryWordKey = null;
  } else if (event.target.matches("[data-tree-add-word-input]")) {
    addingWordGroupId = null;
  } else {
    return;
  }
  renderCategoryTreeManagerB3();
}

function renameCategoryFromTreeB3(groupId, value) {
  try {
    const result = renameCategory(currentVocabulary, groupId, value);
    if (!saveVocabularyCandidate(result.vocabulary)) {
      renderCategoryTreeManagerB3();
      return;
    }
    editingCategoryGroupId = null;
    setCategoryManagerNotice(`分类名称已更新为“${result.group.category}”。`, "success");
  } catch (error) {
    setCategoryManagerNotice(error.message, "error");
  }
  renderCategoryTreeManagerB3();
}

function editCategoryWordFromTreeB3(wordKey, value) {
  try {
    const identityChange = detectWordIdentityChange(wordKey, value);
    if (identityChange.newWordKey && identityChange.changed) {
      setCategoryManagerNotice(
        [
          "当前修改会改变词条唯一标识。",
          `旧标识：${identityChange.oldWordKey}`,
          `新标识：${identityChange.newWordKey}`,
          "当前版本暂不支持直接修改词条身份。",
          "请保持原词条名称。"
        ].join("\n"),
        "error"
      );
      renderCategoryTreeManagerB3();
      return;
    }
    const groupIds = [...(report.index.groupIdsByWordKey.get(wordKey) ?? [])];
    const result = editVocabularyWord(currentVocabulary, wordKey, value, groupIds);
    if (!saveVocabularyCandidate(result.vocabulary)) {
      renderCategoryTreeManagerB3();
      return;
    }
    editingCategoryWordKey = null;
    setCategoryManagerNotice(`已更新词条“${result.word.displayText}”。`, "success");
  } catch (error) {
    setCategoryManagerNotice(error.message, "error");
  }
  renderCategoryTreeManagerB3();
}

function addWordToCategoryB3(groupId, value) {
  try {
    const wordKey = normalizeWordKey(value);
    let result;
    if (report.index.displayByWordKey.has(wordKey)) {
      const groupIds = [...report.index.groupIdsByWordKey.get(wordKey)];
      if (groupIds.includes(groupId)) {
        throw new RangeError("该词条已属于当前分类。");
      }
      result = editVocabularyWord(
        currentVocabulary,
        wordKey,
        report.index.displayByWordKey.get(wordKey),
        [...groupIds, groupId]
      );
    } else {
      result = addVocabularyWord(currentVocabulary, value, [groupId]);
    }
    if (!saveVocabularyCandidate(result.vocabulary)) {
      renderCategoryTreeManagerB3();
      return;
    }
    addingWordGroupId = null;
    setCategoryManagerNotice(`已向当前分类新增词条“${result.word.displayText}”。`, "success");
  } catch (error) {
    setCategoryManagerNotice(error.message, "error");
  }
  renderCategoryTreeManagerB3();
}

function deleteWordRelationB3(groupId, wordKey) {
  try {
    const removal = createWordRelationRemovalB3(groupId, wordKey);
    openVocabularyDeleteConfirmationB3({
      title: `移除词条：${removal.word.displayText}`,
      message: `与分类：${removal.category.category} 的关系？`,
      confirmLabel: "确认移除",
      action: () => performDeleteWordRelationB3(groupId, wordKey)
    });
  } catch (error) {
    setCategoryManagerNotice(error.message, "error");
    renderCategoryTreeManagerB3();
  }
}

function deleteCustomWordB3(wordKey) {
  try {
    const deletion = createCustomWordDeletionB3(wordKey);
    openVocabularyDeleteConfirmationB3({
      title: `删除自定义词条「${deletion.word.displayText}」`,
      message: `将解除 ${deletion.word.removedRelationCount} 个分类关系，并清理该词条的学习记录和待强化队列。确认删除？`,
      confirmLabel: "确认删除",
      action: () => performDeleteCustomWordB3(wordKey)
    });
  } catch (error) {
    setCategoryManagerNotice(error.message, "error");
    renderCategoryTreeManagerB3();
  }
}

function createCustomWordDeletionB3(wordKey) {
  return deleteCustomVocabularyWord(currentVocabulary, wordKey, {
    systemWordKeys,
    activeQuestionWordKey: appState.practice.activeQuestion?.wordKey ?? null,
    activeRoundWordKeys: appState.rounds.current?.wordKeys ?? []
  });
}

function performDeleteCustomWordB3(wordKey) {
  try {
    const deletion = createCustomWordDeletionB3(wordKey);
    if (!saveVocabularyCandidate(deletion.vocabulary)) {
      renderCategoryTreeManagerB3();
      return;
    }
    appState = {
      ...appState,
      learning: removeLearningRecord(appState.learning, wordKey),
      practice: {
        ...appState.practice,
        reviewQueue: removeReviewItem(appState.practice.reviewQueue, wordKey)
      }
    };
    persistState();
    editingCategoryWordKey = null;
    setCategoryManagerNotice(`已删除自定义词条“${deletion.word.displayText}”。`, "success");
  } catch (error) {
    setCategoryManagerNotice(error.message, "error");
  }
  renderCategoryTreeManagerB3();
}

function createWordRelationRemovalB3(groupId, wordKey) {
  const activeWordKey = appState.practice.activeQuestion?.wordKey;
  return removeVocabularyWordRelation(currentVocabulary, wordKey, groupId, {
    protectedWordKeys: activeWordKey ? [activeWordKey] : []
  });
}

function performDeleteWordRelationB3(groupId, wordKey) {
  try {
    const removal = createWordRelationRemovalB3(groupId, wordKey);
    if (!saveVocabularyCandidate(removal.vocabulary)) {
      renderCategoryTreeManagerB3();
      return;
    }
    editingCategoryWordKey = null;
    setCategoryManagerNotice(
      `已移除“${removal.word.displayText}”与分类“${removal.category.category}”的关系。`,
      "success"
    );
  } catch (error) {
    setCategoryManagerNotice(error.message, "error");
  }
  renderCategoryTreeManagerB3();
}

function deleteCategoryFromTreeB3(groupId) {
  try {
    const deletion = createCategoryDeletionB3(groupId);
    openVocabularyDeleteConfirmationB3({
      title: `删除分类「${deletion.group.category}」`,
      message: `将解除 ${deletion.removedRelationCount} 个词条关系。确认删除？`,
      confirmLabel: "确认删除",
      action: () => performDeleteCategoryB3(groupId)
    });
  } catch (error) {
    setCategoryManagerNotice(error.message, "error");
    renderCategoryTreeManagerB3();
  }
}

function createCategoryDeletionB3(groupId) {
  return deleteCategory(currentVocabulary, groupId, {
    protectedGroupIds: appState.practice.activeQuestion?.optionGroupIds ?? []
  });
}

function performDeleteCategoryB3(groupId) {
  try {
    const deletion = createCategoryDeletionB3(groupId);
    if (!saveVocabularyCandidate(deletion.vocabulary)) {
      renderCategoryTreeManagerB3();
      return;
    }
    expandedManagerGroupIds.delete(groupId);
    editingCategoryGroupId = null;
    setCategoryManagerNotice(`已删除分类“${deletion.group.category}”。`, "success");
  } catch (error) {
    setCategoryManagerNotice(error.message, "error");
  }
  renderCategoryTreeManagerB3();
}

function openVocabularyDeleteConfirmationB3({ title, message, confirmLabel, action }) {
  pendingVocabularyDeleteAction = action;
  elements.vocabularyDeleteTitle.textContent = title;
  elements.vocabularyDeleteMessage.textContent = message;
  elements.confirmVocabularyDelete.textContent = confirmLabel;
  elements.vocabularyDeleteModal.hidden = false;
  document.body.classList.add("modal-open");
  elements.cancelVocabularyDelete.focus();
}

function closeVocabularyDeleteConfirmationB3() {
  pendingVocabularyDeleteAction = null;
  elements.vocabularyDeleteModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function confirmVocabularyDeleteB3() {
  const action = pendingVocabularyDeleteAction;
  closeVocabularyDeleteConfirmationB3();
  action?.();
}

function renderCategoryTreeManagerB3() {
  const query = categoryManagerQuery.trim().toLocaleLowerCase("zh-CN");
  const categories = createCategoryList(currentVocabulary);
  const visibleCategories = categories.filter((item) => (
    !query || item.category.toLocaleLowerCase("zh-CN").includes(query)
  ));
  const entriesByWordKey = new Map(
    createWordManagementEntries(report.index, appState.learning)
      .map((entry) => [entry.wordKey, entry])
  );
  const fragment = document.createDocumentFragment();

  for (const item of visibleCategories) {
    const article = document.createElement("article");
    const header = document.createElement("div");
    article.className = "category-tree-item";
    article.dataset.groupId = String(item.groupId);
    header.className = "category-tree-header";
    header.append(
      createTreeToggleB3(item),
      item.groupId === editingCategoryGroupId
        ? createTreeCategoryEditFormB3(item)
        : createTreeCategorySummaryB3(item),
      createTreeCategoryActionsB3(item)
    );
    article.append(header);

    if (expandedManagerGroupIds.has(item.groupId)) {
      article.append(createTreeCategoryBodyB3(item, entriesByWordKey));
    }
    fragment.append(article);
  }

  elements.categoryManagerList.replaceChildren(fragment);
  elements.categoryManagerCount.textContent = `${visibleCategories.length} 个分类`;
  elements.categoryManagerNotice.textContent = categoryManagerNotice;
  elements.categoryManagerNotice.dataset.tone = categoryManagerNoticeTone;
  elements.clearCategoryManagerSearch.hidden = !categoryManagerQuery;
  elements.categoryManagerEmpty.hidden = visibleCategories.length > 0;
  elements.categoryManagerList.hidden = visibleCategories.length === 0;
}

function createTreeToggleB3(item) {
  const button = document.createElement("button");
  const isExpanded = expandedManagerGroupIds.has(item.groupId);
  button.type = "button";
  button.className = "category-tree-toggle";
  button.dataset.treeAction = "toggle";
  button.dataset.groupId = String(item.groupId);
  button.setAttribute("aria-expanded", String(isExpanded));
  button.setAttribute("aria-label", `${isExpanded ? "收起" : "展开"}分类：${item.category}`);
  button.textContent = isExpanded ? "▾" : "▸";
  return button;
}

function createTreeCategorySummaryB3(item) {
  const summary = document.createElement("div");
  const name = document.createElement("strong");
  const count = document.createElement("span");
  summary.className = "category-tree-summary";
  name.textContent = item.category;
  count.textContent = `${item.wordCount} 个词`;
  summary.append(name, count);
  return summary;
}

function createTreeCategoryEditFormB3(item) {
  const form = document.createElement("form");
  const input = document.createElement("input");
  form.className = "category-tree-inline-form category-tree-name-form";
  form.dataset.treeForm = "rename-category";
  form.dataset.groupId = String(item.groupId);
  input.type = "text";
  input.value = item.category;
  input.dataset.treeCategoryInput = String(item.groupId);
  input.setAttribute("aria-label", `编辑分类名称：${item.category}`);
  form.append(input);
  return form;
}

function createTreeCategoryActionsB3(item) {
  const actions = document.createElement("div");
  actions.className = "category-tree-actions";
  if (item.groupId === editingCategoryGroupId) {
    actions.append(
      createTreeActionButtonB3("保存", "submit-category", item.groupId, "button-primary"),
      createTreeActionButtonB3("取消", "cancel-category", item.groupId, "button-quiet")
    );
  } else {
    actions.append(
      createTreeActionButtonB3("编辑", "edit-category", item.groupId, "button-quiet"),
      createTreeActionButtonB3("删除", "delete-category", item.groupId, "button-danger")
    );
  }
  return actions;
}

function createTreeCategoryBodyB3(item, entriesByWordKey) {
  const body = document.createElement("div");
  const list = document.createElement("div");
  const group = report.index.groupById.get(item.groupId);
  body.className = "category-tree-body";
  list.className = "category-tree-words";
  for (const wordKey of getGroupWordKeysB3(group)) {
    const entry = entriesByWordKey.get(wordKey);
    if (entry) {
      list.append(createTreeWordRowB3(item.groupId, entry));
    }
  }
  body.append(list, createTreeAddWordAreaB3(item.groupId));
  return body;
}

function createTreeWordRowB3(groupId, entry) {
  const row = document.createElement("div");
  row.className = "category-tree-word-row";
  row.dataset.wordKey = entry.wordKey;
  if (entry.wordKey === editingCategoryWordKey) {
    const form = document.createElement("form");
    const input = document.createElement("input");
    const identity = document.createElement("span");
    form.className = "category-tree-inline-form category-tree-word-form";
    form.dataset.treeForm = "edit-word";
    form.dataset.groupId = String(groupId);
    form.dataset.wordKey = entry.wordKey;
    input.type = "text";
    input.value = entry.displayText;
    input.dataset.treeWordInput = entry.wordKey;
    input.setAttribute("aria-label", `编辑词条：${entry.displayText}`);
    identity.textContent = `wordKey：${entry.wordKey}`;
    form.append(input, identity);
    row.append(
      form,
      createTreeWordActionsB3(groupId, entry.wordKey, true)
    );
  } else {
    const word = document.createElement("strong");
    word.textContent = entry.displayText;
    row.append(word, createTreeWordActionsB3(groupId, entry.wordKey, false));
  }
  return row;
}

function createTreeWordActionsB3(groupId, wordKey, isEditing) {
  const actions = document.createElement("div");
  actions.className = "category-tree-word-actions";
  if (isEditing) {
    const save = createTreeActionButtonB3("保存", "submit-word", groupId, "button-primary", wordKey);
    actions.append(save, createTreeActionButtonB3("取消", "cancel-word", groupId, "button-quiet", wordKey));
  } else {
    actions.append(
      createTreeActionButtonB3("查看单词释义", "view-details", groupId, "button-quiet", wordKey),
      createTreeActionButtonB3("编辑", "edit-word", groupId, "button-quiet", wordKey),
      createTreeActionButtonB3("删除", "delete-word-relation", groupId, "button-danger", wordKey)
    );
  }
  return actions;
}

function createTreeAddWordAreaB3(groupId) {
  if (addingWordGroupId !== groupId) {
    const button = createTreeActionButtonB3("＋ 新增词条", "add-word", groupId, "button-quiet");
    button.classList.add("category-tree-add-word");
    return button;
  }
  const form = document.createElement("form");
  const input = document.createElement("input");
  const actions = document.createElement("div");
  const save = document.createElement("button");
  form.className = "category-tree-add-form";
  form.dataset.treeForm = "add-word";
  form.dataset.groupId = String(groupId);
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = "输入英文词条";
  input.dataset.treeAddWordInput = String(groupId);
  input.setAttribute("aria-label", "新增英文词条");
  actions.className = "category-tree-word-actions";
  save.type = "submit";
  save.className = "button button-primary button-compact";
  save.textContent = "保存";
  actions.append(save, createTreeActionButtonB3("取消", "cancel-add-word", groupId, "button-quiet"));
  form.append(input, actions);
  return form;
}

function createTreeActionButtonB3(label, action, groupId, styleClass, wordKey = null) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button button-compact ${styleClass}`;
  button.textContent = label;
  button.dataset.treeAction = action;
  button.dataset.groupId = String(groupId);
  if (wordKey) {
    button.dataset.wordKey = wordKey;
  }
  return button;
}

function getGroupWordKeysB3(group) {
  const seen = new Set();
  const keys = [];
  for (const word of Array.isArray(group?.words) ? group.words : []) {
    const wordKey = normalizeWordKey(word);
    if (wordKey && !seen.has(wordKey)) {
      seen.add(wordKey);
      keys.push(wordKey);
    }
  }
  return keys;
}

function handleAddVocabularyWord(event) {
  event.preventDefault();
  const selectedGroupIds = [...elements.newWordCategoryOptions.querySelectorAll("input:checked")]
    .map((input) => Number(input.value));

  try {
    const result = addVocabularyWord(
      currentVocabulary,
      elements.newWordText.value,
      selectedGroupIds
    );
    if (!saveVocabularyCandidate(result.vocabulary, setWordManagerNotice)) {
      renderWordManager();
      return;
    }
    elements.newWordText.value = "";
    for (const checkbox of elements.newWordCategoryOptions.querySelectorAll("input:checked")) {
      checkbox.checked = false;
    }
    setWordManagerNotice(`已新增词条“${result.word.displayText}”。`, "success");
  } catch (error) {
    setWordManagerNotice(error.message, "error");
  }
  renderWordManager();
}

function handleWordManagerSearch(event) {
  wordManagerQuery = event.target.value;
  renderWordManager();
}

function clearWordManagerSearch() {
  elements.wordManagerSearch.value = "";
  wordManagerQuery = "";
  renderWordManager();
  elements.wordManagerSearch.focus();
}

function handleWordManagerClick(event) {
  const button = event.target.closest("[data-word-action]");
  if (!button || !elements.wordManagerList.contains(button)) {
    return;
  }

  if (button.dataset.wordAction === "edit") {
    editingWordKey = button.dataset.wordKey;
    setWordManagerNotice("", "success");
    renderWordManager();
    const input = elements.wordManagerList.querySelector("[data-word-edit-text]");
    input?.focus();
    input?.select();
  } else if (button.dataset.wordAction === "cancel") {
    editingWordKey = null;
    setWordManagerNotice("", "success");
    renderWordManager();
  }
}

function handleWordManagerSubmit(event) {
  const form = event.target.closest("[data-word-edit-form]");
  if (!form || !elements.wordManagerList.contains(form)) {
    return;
  }
  event.preventDefault();

  const selectedGroupIds = [...form.querySelectorAll("input[type=checkbox]:checked")]
    .map((input) => Number(input.value));
  const displayText = form.querySelector("[data-word-edit-text]")?.value ?? "";

  try {
    const result = editVocabularyWord(
      currentVocabulary,
      form.dataset.wordKey,
      displayText,
      selectedGroupIds
    );
    if (!saveVocabularyCandidate(result.vocabulary, setWordManagerNotice)) {
      renderWordManager();
      return;
    }
    editingWordKey = null;
    setWordManagerNotice(`已更新词条“${result.word.displayText}”。`, "success");
  } catch (error) {
    setWordManagerNotice(error.message, "error");
  }
  renderWordManager();
}

function setWordManagerNotice(message, tone) {
  wordManagerNotice = message;
  wordManagerNoticeTone = tone;
}

function renderWordCategoryOptions() {
  const categories = createCategoryList(currentVocabulary);
  const selectedGroupIds = new Set(
    [...elements.newWordCategoryOptions.querySelectorAll("input:checked")]
      .map((input) => Number(input.value))
  );
  const fragment = document.createDocumentFragment();

  for (const item of categories) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    const text = document.createElement("span");
    label.className = "word-category-option";
    checkbox.type = "checkbox";
    checkbox.value = String(item.groupId);
    checkbox.checked = selectedGroupIds.has(item.groupId);
    text.textContent = item.category;
    label.append(checkbox, text);
    fragment.append(label);
  }
  elements.newWordCategoryOptions.replaceChildren(fragment);
}

function renderWordManager() {
  const entries = createWordManagementEntries(report.index, appState.learning);
  const visibleEntries = filterWordManagementEntries(entries, wordManagerQuery);
  const fragment = document.createDocumentFragment();

  for (const entry of visibleEntries) {
    const row = document.createElement("article");
    row.dataset.wordKey = entry.wordKey;
    if (entry.wordKey === editingWordKey) {
      renderWordManagerEditRow(row, entry);
      fragment.append(row);
      continue;
    }
    const word = document.createElement("strong");
    const categories = document.createElement("div");
    const status = document.createElement("span");
    const actions = document.createElement("div");
    const edit = document.createElement("button");
    row.className = "word-manager-row";
    word.className = "word-manager-word";
    word.textContent = entry.displayText;
    categories.className = "word-manager-categories";
    for (const item of entry.categories) {
      const category = document.createElement("span");
      category.textContent = item.category;
      categories.append(category);
    }
    status.className = "wordbook-status-badge";
    status.dataset.status = entry.status;
    status.textContent = statusLabel(entry.status);
    actions.className = "word-manager-actions";
    edit.className = "button button-quiet button-compact";
    edit.type = "button";
    edit.dataset.wordAction = "edit";
    edit.dataset.wordKey = entry.wordKey;
    edit.textContent = "编辑";
    actions.append(status, edit);
    row.append(word, categories, actions);
    fragment.append(row);
  }

  elements.wordManagerList.replaceChildren(fragment);
  elements.wordManagerCount.textContent = `${visibleEntries.length} 个词条`;
  elements.wordManagerNotice.textContent = wordManagerNotice;
  elements.wordManagerNotice.dataset.tone = wordManagerNoticeTone;
  elements.clearWordManagerSearch.hidden = !wordManagerQuery;
  elements.wordManagerEmpty.hidden = visibleEntries.length > 0;
  elements.wordManagerList.hidden = visibleEntries.length === 0;
}

function renderWordManagerEditRow(row, entry) {
  const form = document.createElement("form");
  const heading = document.createElement("div");
  const title = document.createElement("strong");
  const identity = document.createElement("span");
  const displayLabel = document.createElement("label");
  const displayTitle = document.createElement("span");
  const displayInput = document.createElement("input");
  const categoryPicker = document.createElement("fieldset");
  const categoryLegend = document.createElement("legend");
  const categoryOptions = document.createElement("div");
  const actions = document.createElement("div");
  const save = document.createElement("button");
  const cancel = document.createElement("button");

  row.className = "word-manager-row word-manager-row-editing";
  form.className = "word-manager-edit-form";
  form.dataset.wordEditForm = "";
  form.dataset.wordKey = entry.wordKey;
  heading.className = "word-manager-edit-heading";
  title.textContent = "编辑词条";
  identity.textContent = `wordKey：${entry.wordKey}（不可修改）`;
  heading.append(title, identity);

  displayLabel.className = "word-manager-edit-display";
  displayTitle.textContent = "展示文本";
  displayInput.type = "text";
  displayInput.value = entry.displayText;
  displayInput.autocomplete = "off";
  displayInput.dataset.wordEditText = "";
  displayLabel.append(displayTitle, displayInput);

  categoryPicker.className = "word-category-picker";
  categoryLegend.textContent = "所属分类（可多选）";
  categoryOptions.className = "word-category-options word-manager-edit-categories";
  const selectedGroupIds = new Set(entry.categories.map(({ groupId }) => groupId));
  for (const item of createCategoryList(currentVocabulary)) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    const text = document.createElement("span");
    label.className = "word-category-option";
    checkbox.type = "checkbox";
    checkbox.value = String(item.groupId);
    checkbox.checked = selectedGroupIds.has(item.groupId);
    text.textContent = item.category;
    label.append(checkbox, text);
    categoryOptions.append(label);
  }
  categoryPicker.append(categoryLegend, categoryOptions);

  actions.className = "word-manager-edit-actions";
  save.className = "button button-primary button-compact";
  save.type = "submit";
  save.textContent = "保存";
  cancel.className = "button button-quiet button-compact";
  cancel.type = "button";
  cancel.dataset.wordAction = "cancel";
  cancel.textContent = "取消";
  actions.append(save, cancel);
  form.append(heading, displayLabel, categoryPicker, actions);
  row.append(form);
}

function handleAddCategory(event) {
  event.preventDefault();
  try {
    const result = addCategory(currentVocabulary, elements.newCategoryName.value);
    if (!saveVocabularyCandidate(result.vocabulary)) {
      renderCategoryManager();
      return;
    }
    elements.newCategoryName.value = "";
    editingCategoryGroupId = null;
    setCategoryManagerNotice(`已创建分类“${result.group.category}”。`, "success");
  } catch (error) {
    setCategoryManagerNotice(error.message, "error");
  }
  renderCategoryManager();
}

function handleCategoryManagerClick(event) {
  const button = event.target.closest("[data-category-action]");
  if (!button || !elements.categoryManagerList.contains(button)) {
    return;
  }

  const groupId = Number(button.dataset.groupId);
  if (button.dataset.categoryAction === "edit") {
    editingCategoryGroupId = groupId;
    setCategoryManagerNotice("", "success");
    renderCategoryManager();
    elements.categoryManagerList
      .querySelector(`[data-edit-category-id="${groupId}"]`)
      ?.focus();
    return;
  }
  if (button.dataset.categoryAction === "cancel") {
    editingCategoryGroupId = null;
    setCategoryManagerNotice("", "success");
    renderCategoryManager();
    return;
  }
  if (button.dataset.categoryAction === "save") {
    submitCategoryRename(groupId);
  }
}

function handleCategoryManagerKeydown(event) {
  if (!event.target.matches("[data-edit-category-id]")) {
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    submitCategoryRename(Number(event.target.dataset.editCategoryId));
  } else if (event.key === "Escape") {
    editingCategoryGroupId = null;
    setCategoryManagerNotice("", "success");
    renderCategoryManager();
  }
}

function submitCategoryRename(groupId) {
  const input = elements.categoryManagerList.querySelector(
    `[data-edit-category-id="${groupId}"]`
  );
  if (!input) {
    return;
  }

  try {
    const result = renameCategory(currentVocabulary, groupId, input.value);
    if (!saveVocabularyCandidate(result.vocabulary)) {
      renderCategoryManager();
      return;
    }
    editingCategoryGroupId = null;
    setCategoryManagerNotice(`分类名称已更新为“${result.group.category}”。`, "success");
  } catch (error) {
    setCategoryManagerNotice(error.message, "error");
  }
  renderCategoryManager();
}

function saveVocabularyCandidate(candidate, reportError = setCategoryManagerNotice) {
  const validation = validateVocabularyData(candidate);
  if (!validation.isValid) {
    reportError(
      validation.errors[0]?.message ?? "词库校验失败，未保存修改。",
      "error"
    );
    return false;
  }

  try {
    vocabularyRepository.save(candidate);
    currentVocabulary = vocabularyRepository.getCurrentVocabulary();
    report = vocabularyRepository.getCurrentValidation();
  } catch {
    reportError("词库保存失败，请检查浏览器存储权限。", "error");
    return false;
  }

  renderActiveQuestion();
  return true;
}

function setCategoryManagerNotice(message, tone) {
  categoryManagerNotice = message;
  categoryManagerNoticeTone = tone;
}

function renderCategoryManager() {
  const categories = createCategoryList(currentVocabulary);
  const fragment = document.createDocumentFragment();

  for (const item of categories) {
    const row = document.createElement("article");
    row.className = "category-manager-row";
    row.dataset.groupId = String(item.groupId);

    if (item.groupId === editingCategoryGroupId) {
      row.classList.add("editing");
      const input = document.createElement("input");
      input.className = "category-edit-input";
      input.value = item.category;
      input.dataset.editCategoryId = String(item.groupId);
      input.setAttribute("aria-label", `编辑分类名称：${item.category}`);
      row.append(input, createCategoryActions(item.groupId, true));
    } else {
      const information = document.createElement("div");
      const name = document.createElement("strong");
      const count = document.createElement("span");
      information.className = "category-manager-info";
      name.textContent = item.category;
      count.textContent = `${item.wordCount} 个词`;
      information.append(name, count);
      row.append(information, createCategoryActions(item.groupId, false));
    }
    fragment.append(row);
  }

  elements.categoryManagerList.replaceChildren(fragment);
  elements.categoryManagerCount.textContent = `${categories.length} 个分类`;
  elements.categoryManagerNotice.textContent = categoryManagerNotice;
  elements.categoryManagerNotice.dataset.tone = categoryManagerNoticeTone;
}

function createCategoryActions(groupId, isEditing) {
  const actions = document.createElement("div");
  actions.className = "category-manager-actions";

  if (!isEditing) {
    actions.append(createCategoryActionButton("编辑", "edit", groupId, "button-quiet"));
    return actions;
  }
  actions.append(
    createCategoryActionButton("保存", "save", groupId, "button-primary"),
    createCategoryActionButton("取消", "cancel", groupId, "button-quiet")
  );
  return actions;
}

function createCategoryActionButton(label, action, groupId, styleClass) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button button-compact ${styleClass}`;
  button.textContent = label;
  button.dataset.categoryAction = action;
  button.dataset.groupId = String(groupId);
  return button;
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
  const { entries, categoryTree } = getWordbookData();
  const hasSearchQuery = Boolean(wordbookQuery.trim());
  const isCategoryTree = wordbookFilter === WORDBOOK_FILTERS.ALL && !hasSearchQuery;
  elements.clearWordbookSearch.hidden = !hasSearchQuery;
  elements.wordbookFilters.hidden = hasSearchQuery;
  if (isCategoryTree) {
    renderWordbookCategoryTree(categoryTree);
    elements.wordbookResultCount.textContent = `${categoryTree.length} 个分类`;
    elements.wordbookEmpty.hidden = categoryTree.length > 0;
    elements.wordbookList.hidden = categoryTree.length === 0;
    renderWordbookFilterState();
    return;
  }

  const visibleEntries = filterWordbookEntries(entries, {
    filter: hasSearchQuery ? WORDBOOK_FILTERS.ALL : wordbookFilter,
    query: wordbookQuery
  });
  const fragment = document.createDocumentFragment();

  for (const entry of visibleEntries) {
    const nextStatus = hasSearchQuery
      ? null
      : wordbookFilter === WORDBOOK_FILTERS.REVIEW
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

function getWordbookData() {
  return wordbookDataCache.get(report.index, appState.learning);
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
      section.append(createWordbookCategoryWords(group));
    }
    fragment.append(section);
  }
  elements.wordbookList.replaceChildren(fragment);
  elements.wordbookNotice.textContent = wordbookNotice;
}

function createWordbookCategoryWords(group) {
  const words = document.createElement("div");
  words.className = "wordbook-category-words";
  for (const entry of group.words) {
    words.append(createWordbookRow(entry, {
      categories: [group.category],
      nextStatus: null
    }));
  }
  return words;
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
  detailButton.textContent = "查看单词释义";
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
    const section = categoryToggle.closest(".wordbook-category-node");
    if (expandedWordbookGroupIds.has(groupId)) {
      expandedWordbookGroupIds.delete(groupId);
      section?.querySelector(":scope > .wordbook-category-words")?.remove();
    } else {
      expandedWordbookGroupIds.add(groupId);
      const group = getWordbookData().categoryTreeByGroupId.get(groupId);
      if (group && section) {
        section.append(createWordbookCategoryWords(group));
      }
    }
    categoryToggle.setAttribute(
      "aria-expanded",
      String(expandedWordbookGroupIds.has(groupId))
    );
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
    openVocabularyDetails(detailButton.dataset.detailWordKey);
  }
}

function openActiveQuestionDetails() {
  const wordKey = appState.practice.activeQuestion?.wordKey;
  if (wordKey && appState.practice.activeQuestion.phase === "graded") {
    openVocabularyDetails(wordKey);
  }
}

function openVocabularyDetails(wordKey) {
  const displayText = report.index.displayByWordKey.get(wordKey);
  if (!displayText) {
    return;
  }
  const returnFocusElement = document.activeElement;
  try {
    const card = createVocabularyCard({
      displayText,
      details: vocabularyRepository.getWordDetails(wordKey),
      onClose: closeWordDetail
    });
    vocabularyCardOverlayController.open(card, { returnFocusElement });
  } catch {
    vocabularyCardOverlayController.close({ restoreFocus: true });
  }
}

function closeWordDetail() {
  vocabularyCardOverlayController.close();
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
