import { vocabularyData } from "./data/vocabulary.js";
import { validateVocabularyData } from "./core/vocabulary-validator.js";
import { createQuestion, isAnswerCorrect } from "./core/question-engine.js";

const report = validateVocabularyData(vocabularyData);
const elements = {
  card: document.querySelector("#practice-card"),
  type: document.querySelector("#question-type"),
  word: document.querySelector("#word-heading"),
  prompt: document.querySelector("#question-prompt"),
  options: document.querySelector("#options"),
  feedback: document.querySelector("#feedback"),
  submit: document.querySelector("#submit-answer"),
  next: document.querySelector("#next-question")
};

let currentQuestion = null;
let selectedGroupIds = new Set();
let isGraded = false;

elements.submit.addEventListener("click", submitAnswer);
elements.next.addEventListener("click", showNextQuestion);

if (report.isValid) {
  showNextQuestion();
} else {
  showFatalError(report.errors.map((item) => item.message).join(" "));
}

function showNextQuestion() {
  const previousWordKey = currentQuestion?.wordKey ?? null;
  currentQuestion = createQuestion(report.index, { excludeWordKey: previousWordKey });
  selectedGroupIds = new Set();
  isGraded = false;

  elements.type.textContent = currentQuestion.type === "single" ? "单选题" : "多选题";
  elements.word.textContent = currentQuestion.displayText;
  elements.prompt.textContent = currentQuestion.type === "single"
    ? "请选择最合适的语义分类"
    : "该词属于多个语义分类，请选择全部正确答案";
  elements.feedback.textContent = "";
  elements.feedback.className = "feedback";
  elements.submit.hidden = false;
  elements.submit.disabled = false;
  elements.next.hidden = true;
  renderOptions();
}

function renderOptions() {
  elements.options.replaceChildren();

  currentQuestion.options.forEach((option, index) => {
    const button = document.createElement("button");
    const letter = document.createElement("span");
    const label = document.createElement("span");
    button.type = "button";
    button.className = "option-button";
    button.dataset.groupId = String(option.groupId);
    button.setAttribute("aria-pressed", "false");
    letter.className = "option-letter";
    letter.textContent = String.fromCharCode(65 + index);
    label.className = "option-text";
    label.textContent = option.category;
    button.append(letter, label);
    button.addEventListener("click", () => toggleOption(option.groupId));
    elements.options.append(button);
  });
}

function toggleOption(groupId) {
  if (isGraded) {
    return;
  }

  if (currentQuestion.type === "single") {
    selectedGroupIds = new Set([groupId]);
  } else if (selectedGroupIds.has(groupId)) {
    selectedGroupIds.delete(groupId);
  } else {
    selectedGroupIds.add(groupId);
  }

  elements.feedback.textContent = "";
  elements.feedback.className = "feedback";
  updateSelectionStyles();
}

function updateSelectionStyles() {
  for (const button of elements.options.querySelectorAll(".option-button")) {
    const groupId = Number(button.dataset.groupId);
    const selected = selectedGroupIds.has(groupId);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function submitAnswer() {
  if (isGraded) {
    return;
  }
  if (selectedGroupIds.size === 0) {
    elements.feedback.textContent = "请先选择一个答案。";
    elements.feedback.className = "feedback validation";
    return;
  }

  isGraded = true;
  const correct = isAnswerCorrect(selectedGroupIds, currentQuestion.correctGroupIds);
  const correctGroupIds = new Set(currentQuestion.correctGroupIds);

  for (const button of elements.options.querySelectorAll(".option-button")) {
    const groupId = Number(button.dataset.groupId);
    button.disabled = true;
    button.classList.remove("selected");
    if (correctGroupIds.has(groupId)) {
      button.classList.add("correct");
    } else if (selectedGroupIds.has(groupId)) {
      button.classList.add("incorrect");
    }
  }

  elements.feedback.textContent = correct
    ? "回答正确！"
    : "回答错误。绿色为正确答案，红色为选错的答案。";
  elements.feedback.className = `feedback ${correct ? "success" : "error"}`;
  elements.submit.disabled = true;
  elements.submit.hidden = true;
  elements.next.hidden = false;
  elements.next.focus();
}

function showFatalError(message) {
  elements.type.textContent = "数据错误";
  elements.word.textContent = "无法开始练习";
  elements.prompt.textContent = "请先修复阶段 0 检测到的阻断问题。";
  elements.feedback.textContent = message;
  elements.feedback.className = "feedback fatal";
  elements.submit.disabled = true;
}
