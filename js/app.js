import { vocabularyData } from "./data/vocabulary.js";
import { validateVocabularyData } from "./core/vocabulary-validator.js";
import { createQuestion, isAnswerCorrect } from "./core/question-engine.js";
import {
  applyMasteryDecision,
  getLearningRecord,
  LEARNING_STATUSES,
  recordAnswer
} from "./core/learning-service.js";
import { loadAppState, saveAppState } from "./core/storage.js";

const report = validateVocabularyData(vocabularyData);
const elements = {
  type: document.querySelector("#question-type"),
  word: document.querySelector("#word-heading"),
  prompt: document.querySelector("#question-prompt"),
  wordStatus: document.querySelector("#word-status"),
  options: document.querySelector("#options"),
  feedback: document.querySelector("#feedback"),
  submit: document.querySelector("#submit-answer"),
  decisions: document.querySelector("#decision-actions"),
  markReview: document.querySelector("#mark-review"),
  markRemembered: document.querySelector("#mark-remembered"),
  next: document.querySelector("#next-question")
};

let appState = null;
let persistenceError = "";

elements.submit.addEventListener("click", submitAnswer);
elements.markReview.addEventListener("click", () => chooseMasteryStatus(LEARNING_STATUSES.REVIEW));
elements.markRemembered.addEventListener("click", () => chooseMasteryStatus(LEARNING_STATUSES.REMEMBERED));
elements.next.addEventListener("click", showNextQuestion);

if (report.isValid) {
  appState = loadAppState({
    vocabulary: vocabularyData,
    validWordKeys: new Set(report.index.allWordKeys),
    validGroupIds: new Set(report.index.groupById.keys()),
    correctGroupIdsByWordKey: report.index.groupIdsByWordKey
  });

  if (!appState.practice.activeQuestion) {
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
  const question = createQuestion(report.index, { excludeWordKey: previousWordKey });
  appState = {
    ...appState,
    practice: {
      ...appState.practice,
      activeQuestion: {
        wordKey: question.wordKey,
        optionGroupIds: question.options.map((option) => option.groupId),
        correctGroupIds: [...question.correctGroupIds],
        selectedGroupIds: [],
        phase: "answering",
        result: null
      }
    }
  };
  persistState();
}

function renderActiveQuestion() {
  const activeQuestion = appState.practice.activeQuestion;
  const isMultiple = activeQuestion.correctGroupIds.length > 1;
  const record = getLearningRecord(appState.learning, activeQuestion.wordKey);

  elements.type.textContent = isMultiple ? "多选题" : "单选题";
  elements.word.textContent = report.index.displayByWordKey.get(activeQuestion.wordKey);
  elements.prompt.textContent = isMultiple
    ? "该词属于多个语义分类，请选择全部正确答案"
    : "请选择最合适的语义分类";
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
    elements.feedback.textContent = "回答错误，已自动加入待强化";
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

  appState = {
    ...appState,
    learning: answerResult.learning,
    practice: {
      ...appState.practice,
      activeQuestion: answerResult.activeQuestion
    }
  };
  persistState();
  renderActiveQuestion();
}

function chooseMasteryStatus(status) {
  const decision = applyMasteryDecision({
    learning: appState.learning,
    activeQuestion: appState.practice.activeQuestion,
    status
  });
  if (!decision.applied) {
    return;
  }

  appState = {
    ...appState,
    learning: decision.learning,
    practice: {
      ...appState.practice,
      activeQuestion: decision.activeQuestion
    }
  };
  replaceActiveQuestion();
  renderActiveQuestion();
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
