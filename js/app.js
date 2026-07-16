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
import { loadAppState, saveAppState } from "./core/storage.js";
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
  recordRoundAnswer
} from "./core/round-service.js";

const report = validateVocabularyData(vocabularyData);
const elements = {
  type: document.querySelector("#question-type"),
  word: document.querySelector("#word-heading"),
  prompt: document.querySelector("#question-prompt"),
  questionRoundStatus: document.querySelector("#question-round-status"),
  questionRoundProgress: document.querySelector("#question-round-progress"),
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
  roundSummary: document.querySelector("#round-summary")
};

let appState = null;
let persistenceError = "";

elements.submit.addEventListener("click", submitAnswer);
elements.markReview.addEventListener("click", () => chooseMasteryStatus(LEARNING_STATUSES.REVIEW));
elements.markRemembered.addEventListener("click", () => chooseMasteryStatus(LEARNING_STATUSES.REMEMBERED));
elements.next.addEventListener("click", showNextQuestion);
elements.modeRandom.addEventListener("click", () => changeMode(PRACTICE_MODES.RANDOM));
elements.modeIntensive.addEventListener("click", () => changeMode(PRACTICE_MODES.INTENSIVE));
elements.roundSize.addEventListener("change", renderRoundControls);
elements.startRound.addEventListener("click", startNewRound);
elements.abandonRound.addEventListener("click", abandonCurrentRound);

if (report.isValid) {
  appState = loadAppState({
    vocabulary: vocabularyData,
    validWordKeys: new Set(report.index.allWordKeys),
    validGroupIds: new Set(report.index.groupById.keys()),
    correctGroupIdsByWordKey: report.index.groupIdsByWordKey
  });

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
      activeQuestion: question ? {
        wordKey: question.wordKey,
        optionGroupIds: question.options.map((option) => option.groupId),
        correctGroupIds: [...question.correctGroupIds],
        selectedGroupIds: [],
        phase: "answering",
        result: null
      } : null
    },
    rounds: {
      ...appState.rounds,
      current: nextRound
    }
  };
  persistState();
}

function renderActiveQuestion() {
  const activeQuestion = appState.practice.activeQuestion;
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
    ? "该词对应多个分类，请全部选择"
    : "请选择对应的语义分类";
  elements.wordStatus.textContent = `状态：${statusLabel(record.status)}`;
  elements.wordStatus.dataset.status = record.status;
  renderOptions(activeQuestion, isMultiple);
  renderQuestionActions(activeQuestion);
}

function renderOptions(activeQuestion, isMultiple) {
  elements.options.replaceChildren();
  const selectedGroupIds = new Set(activeQuestion.selectedGroupIds);
  const correctGroupIds = new Set(activeQuestion.correctGroupIds);
  const isLocked = activeQuestion.phase !== "answering";

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
    if (isLocked && correctGroupIds.has(groupId)) {
      button.classList.add("correct");
    } else if (isLocked && selected) {
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
  renderActiveQuestion();
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
  const isDecisionPending = activeQuestion?.phase === "graded";
  elements.modeRandom.disabled = isDecisionPending;
  elements.modeIntensive.disabled = isDecisionPending;
}

function renderEmptyState() {
  const isRoundIntensive = appState.rounds.current && appState.practice.mode === PRACTICE_MODES.INTENSIVE;
  elements.type.textContent = appState.practice.mode === PRACTICE_MODES.INTENSIVE
    ? "强化模式"
    : "轮次完成";
  elements.word.textContent = isRoundIntensive ? "本轮暂无待强化词" : "暂无待强化词";
  elements.prompt.textContent = isRoundIntensive
    ? "切换到随机模式继续本轮学习。"
    : "答错或主动加入待强化后，可在这里集中练习。";
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
  const requestedSize = elements.roundSize.value === "custom"
    ? Number(elements.customRoundSize.value)
    : Number(elements.roundSize.value);

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
        activeQuestion: null
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

function abandonCurrentRound() {
  if (!appState.rounds.current || appState.practice.activeQuestion?.phase === "graded") {
    return;
  }

  appState = {
    ...appState,
    practice: {
      ...appState.practice,
      activeQuestion: null
    },
    rounds: abandonRound(appState.rounds)
  };
  replaceActiveQuestion();
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
  elements.customRoundSize.min = "5";
  elements.customRoundSize.max = String(availableCount);
  elements.startRound.disabled = availableCount < 5 || isGraded;
  elements.abandonRound.disabled = isGraded;
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
    elements.roundProgress.textContent = `本轮已掌握 ${masteredCount}/${currentRound.wordKeys.length} · 答题 ${currentRound.attemptCount} 次`;
  }

  const summary = appState.rounds.lastCompletedSummary;
  elements.roundSummary.hidden = !summary;
  if (summary) {
    elements.roundSummary.textContent = `上一轮完成：掌握 ${summary.masteredCount}/${summary.totalWords}，首次答对 ${summary.firstAttemptCorrectCount}`;
  }
}

function renderQuestionRoundStatus() {
  const counts = getCurrentRoundCounts();
  elements.questionRoundStatus.hidden = !counts;
  if (!counts) {
    elements.lastRoundWordHint.hidden = true;
    return;
  }

  elements.questionRoundProgress.textContent = `当前轮次进度：已掌握 ${counts.masteredCount} / 总数 ${counts.totalCount}`;
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
  elements.feedback.textContent = message;
  elements.feedback.className = "feedback fatal";
  elements.submit.disabled = true;
}
