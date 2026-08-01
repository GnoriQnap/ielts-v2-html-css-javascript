export function createVocabularyDetailsViewModel({ displayText, details }) {
  const phoneticUs = details?.phonetics?.us ?? "";
  const meanings = Array.isArray(details?.meanings)
    ? details.meanings
      .map((meaning) => ({
        partOfSpeech: meaning?.partOfSpeech ?? "",
        definitionZh: meaning?.definitionZh ?? ""
      }))
      .filter((meaning) => meaning.partOfSpeech || meaning.definitionZh)
    : [];
  const collocations = Array.isArray(details?.collocations)
    ? details.collocations.filter(Boolean).map(formatCollocation)
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
    phoneticUs,
    meanings,
    collocations,
    examples,
    notes,
    source,
    isEmpty: (
      !phoneticUs &&
      meanings.length === 0 &&
      collocations.length === 0 &&
      examples.length === 0
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
  const title = createElement(documentRef, "h1", "vocabulary-details-word", model.displayText);
  title.id = "vocabulary-card-title";
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

  if (model.phoneticUs) {
    view.append(createElement(documentRef, "p", "vocabulary-details-phonetic", model.phoneticUs));
  }
  if (model.meanings.length > 0) {
    const section = createElement(documentRef, "section", "vocabulary-details-meanings");
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
          "span",
          "vocabulary-details-definition",
          meaning.definitionZh
        ));
      }
      section.append(item);
    }
    view.append(section);
  }
  if (model.collocations.length > 0) {
    const section = createSection(documentRef, "搭配", "vocabulary-details-collocations");
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
  return view;
}

function createSection(documentRef, title, className) {
  const section = createElement(documentRef, "section", `vocabulary-details-section ${className}`);
  section.append(createElement(documentRef, "h3", "vocabulary-details-heading", title));
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

function formatCollocation(value) {
  return String(value).trim().replace(/\s*(?:[—–]+|-{2,})\s*/, "\u00A0\u00A0");
}
