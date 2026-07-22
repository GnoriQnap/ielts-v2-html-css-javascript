export function createVocabularyDetailsViewModel({ displayText, details }) {
  const phonetics = [
    { label: "英式音标", value: details?.phonetics?.uk ?? "" },
    { label: "美式音标", value: details?.phonetics?.us ?? "" }
  ].filter((item) => item.value);
  const meanings = Array.isArray(details?.meanings)
    ? details.meanings
      .map((meaning) => ({
        partOfSpeech: meaning?.partOfSpeech ?? "",
        definitionZh: meaning?.definitionZh ?? ""
      }))
      .filter((meaning) => meaning.partOfSpeech || meaning.definitionZh)
    : [];
  const collocations = Array.isArray(details?.collocations)
    ? details.collocations.filter(Boolean)
    : [];
  const examples = Array.isArray(details?.examples)
    ? details.examples
      .map((example) => ({ en: example?.en ?? "", zh: example?.zh ?? "" }))
      .filter((example) => example.en || example.zh)
    : [];
  const notes = details?.notes ?? "";
  const source = details?.source ?? "";

  return {
    displayText: String(displayText ?? ""),
    phonetics,
    meanings,
    collocations,
    examples,
    notes,
    source,
    isEmpty: (
      phonetics.length === 0 &&
      meanings.length === 0 &&
      collocations.length === 0 &&
      examples.length === 0 &&
      !notes &&
      !source
    )
  };
}

export function createVocabularyDetailsView({
  displayText,
  details,
  documentRef = globalThis.document
}) {
  if (!documentRef?.createElement) {
    throw new TypeError("需要可用的 document 才能创建词条详情视图。");
  }
  const model = createVocabularyDetailsViewModel({ displayText, details });
  const view = createElement(documentRef, "article", "vocabulary-details-view");
  const title = createElement(documentRef, "h2", "vocabulary-details-word", model.displayText);
  view.append(title);

  if (model.isEmpty) {
    view.append(createElement(
      documentRef,
      "p",
      "vocabulary-details-empty",
      "暂未添加单词详情"
    ));
    return view;
  }

  for (const phonetic of model.phonetics) {
    const row = createElement(documentRef, "div", "vocabulary-details-phonetic");
    row.append(
      createElement(documentRef, "span", "vocabulary-details-label", phonetic.label),
      createElement(documentRef, "span", "vocabulary-details-phonetic-value", phonetic.value)
    );
    view.append(row);
  }
  if (model.meanings.length > 0) {
    const section = createSection(documentRef, "中文释义", "vocabulary-details-meanings");
    for (const meaning of model.meanings) {
      const item = createElement(documentRef, "div", "vocabulary-details-meaning");
      if (meaning.partOfSpeech) {
        item.append(createElement(
          documentRef,
          "span",
          "vocabulary-details-pos",
          meaning.partOfSpeech
        ));
      }
      if (meaning.definitionZh) {
        item.append(createElement(
          documentRef,
          "p",
          "vocabulary-details-definition",
          meaning.definitionZh
        ));
      }
      section.append(item);
    }
    view.append(section);
  }
  if (model.collocations.length > 0) {
    const section = createSection(documentRef, "常用搭配", "vocabulary-details-collocations");
    const list = createElement(documentRef, "ul", "vocabulary-details-collocation-list");
    for (const collocation of model.collocations) {
      list.append(createElement(documentRef, "li", "vocabulary-details-collocation", collocation));
    }
    section.append(list);
    view.append(section);
  }
  if (model.examples.length > 0) {
    const section = createSection(documentRef, "例句", "vocabulary-details-examples");
    for (const example of model.examples) {
      const item = createElement(documentRef, "div", "vocabulary-details-example");
      if (example.en) {
        item.append(createElement(documentRef, "p", "vocabulary-details-example-en", example.en));
      }
      if (example.zh) {
        item.append(createElement(documentRef, "p", "vocabulary-details-example-zh", example.zh));
      }
      section.append(item);
    }
    view.append(section);
  }
  if (model.notes) {
    view.append(createTextSection(documentRef, "备注", model.notes, "vocabulary-details-notes"));
  }
  if (model.source) {
    view.append(createTextSection(documentRef, "来源", model.source, "vocabulary-details-source"));
  }
  return view;
}

function createSection(documentRef, title, className) {
  const section = createElement(documentRef, "section", `vocabulary-details-section ${className}`);
  section.append(createElement(documentRef, "h3", "vocabulary-details-heading", title));
  return section;
}

function createTextSection(documentRef, title, value, className) {
  const section = createSection(documentRef, title, className);
  section.append(createElement(documentRef, "p", "vocabulary-details-text", value));
  return section;
}

function createElement(documentRef, tagName, className, text = null) {
  const element = documentRef.createElement(tagName);
  element.className = className;
  if (text !== null) {
    element.textContent = text;
  }
  return element;
}
