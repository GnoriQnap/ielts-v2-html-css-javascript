import { createVocabularyDetailsView } from "./vocabulary-details-view.js";

export function createVocabularyCard({
  displayText,
  details,
  onClose = () => {},
  documentRef = globalThis.document
}) {
  if (!documentRef?.createElement) {
    throw new TypeError("需要可用的 document 才能创建词条卡片。");
  }
  if (typeof onClose !== "function") {
    throw new TypeError("词条卡片的关闭操作必须是函数。");
  }

  const card = createElement(documentRef, "article", "vocabulary-card");
  const header = createElement(documentRef, "header", "vocabulary-card-header");
  const back = createActionButton(documentRef, "← 返回", "vocabulary-card-back", onClose);
  const heading = createElement(documentRef, "h1", "vocabulary-card-title", "词条详情");
  const headerBalance = createElement(documentRef, "span", "vocabulary-card-header-balance");
  headerBalance.setAttribute("aria-hidden", "true");
  header.append(back, heading, headerBalance);

  const content = createElement(documentRef, "main", "vocabulary-card-content");
  content.append(createVocabularyDetailsView({ displayText, details, documentRef }));

  const footer = createElement(documentRef, "footer", "vocabulary-card-footer");
  footer.append(createActionButton(
    documentRef,
    "关闭",
    "button button-primary vocabulary-card-close",
    onClose
  ));

  card.append(header, content, footer);
  return card;
}

function createActionButton(documentRef, text, className, onClose) {
  const button = createElement(documentRef, "button", className, text);
  button.type = "button";
  button.dataset.vocabularyCardClose = "true";
  button.addEventListener("click", onClose);
  return button;
}

function createElement(documentRef, tagName, className, text = null) {
  const element = documentRef.createElement(tagName);
  element.className = className;
  if (text !== null) {
    element.textContent = text;
  }
  return element;
}
