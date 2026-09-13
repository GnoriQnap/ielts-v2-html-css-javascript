import { validateVocabularyData } from "./vocabulary-validator.js";

export const MAX_VOCABULARY_IMPORT_BYTES = 5 * 1024 * 1024;

export const VOCABULARY_IMPORT_ERROR_CODES = Object.freeze({
  READ_ERROR: "read-error",
  JSON_ERROR: "json-error",
  INVALID_DATA: "invalid-data",
  FILE_TOO_LARGE: "file-too-large",
  ACTIVE_STATE: "active-state",
  SAVE_ERROR: "save-error"
});

export class VocabularyImportError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "VocabularyImportError";
    this.code = code;
  }
}

export async function prepareVocabularyImportFile(file, options = {}) {
  const { maxBytes = MAX_VOCABULARY_IMPORT_BYTES } = options;
  if (!file || typeof file.text !== "function") {
    throw importError("READ_ERROR", "无法读取文件");
  }
  if (typeof file.name === "string" && !file.name.toLocaleLowerCase().endsWith(".json")) {
    throw importError("INVALID_DATA", "词库数据不合法");
  }
  if (Number.isFinite(file.size) && file.size > maxBytes) {
    throw importError("FILE_TOO_LARGE", "文件过大，无法导入");
  }

  let text;
  try {
    text = await file.text();
  } catch (error) {
    throw importError("READ_ERROR", "无法读取文件", error);
  }
  return prepareVocabularyImportText(text, options);
}

export function prepareVocabularyImportText(text, options = {}) {
  const { validator = validateVocabularyData } = options;
  if (typeof text !== "string" || text.trim().length === 0) {
    throw importError("INVALID_DATA", "词库数据不合法");
  }

  let candidate;
  try {
    candidate = JSON.parse(text);
  } catch (error) {
    throw importError("JSON_ERROR", "JSON 格式错误", error);
  }
  if (!hasVocabularyRoot(candidate)) {
    throw importError("INVALID_DATA", "词库数据不合法");
  }

  const validation = validator(candidate);
  if (!validation?.isValid) {
    throw importError("INVALID_DATA", "词库数据不合法");
  }
  const vocabulary = clonePlain(candidate);
  return {
    vocabulary,
    validation,
    summary: createVocabularyImportSummary(vocabulary, validation)
  };
}

export function createVocabularyImportSummary(vocabulary, validation = null) {
  const checked = validation ?? validateVocabularyData(vocabulary);
  if (!checked?.isValid) {
    throw importError("INVALID_DATA", "词库数据不合法");
  }
  return {
    categoryCount: checked.summary.groupCount,
    uniqueWordCount: checked.summary.uniqueWordCount
  };
}

export function assertVocabularyImportAllowed(preparedImport, context = {}) {
  const validWordKeys = new Set(preparedImport?.validation?.index?.allWordKeys ?? []);
  const activeQuestionWordKey = context.activeQuestion?.wordKey;
  const activeRoundWordKeys = Array.isArray(context.activeRound?.wordKeys)
    ? context.activeRound.wordKeys
    : [];
  if (
    (activeQuestionWordKey && !validWordKeys.has(activeQuestionWordKey)) ||
    activeRoundWordKeys.some((wordKey) => !validWordKeys.has(wordKey))
  ) {
    throw importError(
      "ACTIVE_STATE",
      "当前题或活动轮次正在使用旧词库，请先完成或结束本轮学习后再导入"
    );
  }
  return true;
}

export function commitVocabularyImport(repository, preparedImport, options = {}) {
  const {
    activeQuestion = null,
    activeRound = null,
    relatedState,
    saveRelatedState = null,
    validator = validateVocabularyData
  } = options;
  if (
    !repository ||
    typeof repository.saveMaintenanceVocabulary !== "function" ||
    typeof repository.getCurrentVocabulary !== "function"
  ) {
    throw new TypeError("完整词库导入必须使用 Developer Maintenance Repository 接口。");
  }

  const prepared = prepareVocabularyImportText(
    JSON.stringify(preparedImport?.vocabulary),
    { validator }
  );
  assertVocabularyImportAllowed(prepared, { activeQuestion, activeRound });
  const previousVocabulary = repository.getCurrentVocabulary();
  let repositorySaved = false;

  try {
    repository.saveMaintenanceVocabulary(prepared.vocabulary);
    repositorySaved = true;
    const savedRelatedState = typeof saveRelatedState === "function"
      ? saveRelatedState(relatedState)
      : relatedState;
    return {
      vocabulary: repository.getCurrentVocabulary(),
      validation: prepared.validation,
      summary: prepared.summary,
      relatedState: savedRelatedState
    };
  } catch (error) {
    if (repositorySaved && previousVocabulary) {
      try {
        repository.saveMaintenanceVocabulary(previousVocabulary);
      } catch {
        // The original error remains the most useful public failure reason.
      }
    }
    throw importError("SAVE_ERROR", "保存失败", error);
  }
}

export function resetVocabularyImportInput(input) {
  if (input && "value" in input) {
    input.value = "";
  }
}

function hasVocabularyRoot(candidate) {
  return Boolean(
    candidate &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    Array.isArray(candidate.vocabulary_list)
  );
}

function importError(codeKey, message, cause) {
  return new VocabularyImportError(
    VOCABULARY_IMPORT_ERROR_CODES[codeKey],
    message,
    cause ? { cause } : undefined
  );
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}
