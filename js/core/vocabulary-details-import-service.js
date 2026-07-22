import { normalizeWordKey } from "./normalization.js";
import {
  normalizeVocabularyDetails,
  validateVocabularyDetails
} from "./vocabulary-details.js";
import { validateVocabularyData } from "./vocabulary-validator.js";

export const MAX_VOCABULARY_DETAILS_IMPORT_BYTES = 5 * 1024 * 1024;

export const VOCABULARY_DETAILS_IMPORT_ERROR_CODES = Object.freeze({
  READ_ERROR: "read-error",
  JSON_ERROR: "json-error",
  INVALID_ROOT: "invalid-root",
  WORD_NOT_FOUND: "word-not-found",
  INVALID_WORD_KEY: "invalid-word-key",
  INVALID_DETAILS: "invalid-details",
  MISSING_FIELD: "missing-field",
  FILE_TOO_LARGE: "file-too-large",
  STALE_PREPARATION: "stale-preparation",
  SAVE_ERROR: "save-error"
});

export class VocabularyDetailsImportError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "VocabularyDetailsImportError";
    this.code = code;
  }
}

export async function prepareVocabularyDetailsImportFile(file, repository, options = {}) {
  const { maxBytes = MAX_VOCABULARY_DETAILS_IMPORT_BYTES } = options;
  if (!file || typeof file.text !== "function") {
    throw importError("READ_ERROR", "无法读取详情文件");
  }
  if (typeof file.name === "string" && !file.name.toLocaleLowerCase().endsWith(".json")) {
    throw importError("INVALID_ROOT", "详情文件必须是 JSON");
  }
  if (Number.isFinite(file.size) && file.size > maxBytes) {
    throw importError("FILE_TOO_LARGE", "详情文件过大，无法导入");
  }

  let text;
  try {
    text = await file.text();
  } catch (error) {
    throw importError("READ_ERROR", "无法读取详情文件", error);
  }
  return prepareVocabularyDetailsImportText(text, repository, options);
}

export function prepareVocabularyDetailsImportText(text, repository) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw importError("INVALID_ROOT", "详情 JSON 不能为空");
  }

  let draft;
  try {
    draft = JSON.parse(text);
  } catch (error) {
    throw importError("JSON_ERROR", "详情 JSON 格式错误", error);
  }
  return prepareVocabularyDetailsImportData(draft, repository);
}

export function prepareVocabularyDetailsImportData(draft, repository) {
  const index = getRepositoryIndex(repository);
  if (!isPlainObject(draft)) {
    throw importError("INVALID_ROOT", "详情 JSON 根结构必须是 wordKey 对象");
  }

  const entries = Object.entries(draft).map(([rawWordKey, candidate]) => (
    inspectDraftEntry(rawWordKey, candidate, index)
  ));
  const validEntries = entries
    .filter((entry) => entry.status === "ready")
    .map(({ wordKey, details }) => ({ wordKey, details: clonePlain(details) }));
  const failures = entries
    .filter((entry) => entry.status === "rejected")
    .map(({ wordKey, errors }) => ({ wordKey, errors: clonePlain(errors) }));

  return {
    entries: clonePlain(entries),
    validEntries,
    failures,
    summary: {
      totalCount: entries.length,
      successCount: validEntries.length,
      failureCount: failures.length
    }
  };
}

export function commitVocabularyDetailsImport(repository, preparedImport) {
  assertRepository(repository);
  if (!Array.isArray(preparedImport?.validEntries)) {
    throw importError("STALE_PREPARATION", "详情导入结果无效，请重新校验");
  }

  const currentIndex = getRepositoryIndex(repository);
  const entries = preparedImport.validEntries.map((entry) => {
    const inspected = inspectDraftEntry(entry?.wordKey, entry?.details, currentIndex);
    if (inspected.status !== "ready") {
      throw importError("STALE_PREPARATION", "词库已变化，请重新校验详情文件");
    }
    return { wordKey: inspected.wordKey, details: inspected.details };
  });
  const previousVocabulary = repository.getCurrentVocabulary();

  try {
    for (const entry of entries) {
      repository.setWordDetails(entry.wordKey, entry.details);
    }
  } catch (error) {
    try {
      repository.save(previousVocabulary);
    } catch {
      // Preserve the original failure as the public error.
    }
    throw importError("SAVE_ERROR", "词条详情保存失败", error);
  }

  return {
    importedCount: entries.length,
    importedWordKeys: entries.map((entry) => entry.wordKey),
    failureCount: Number(preparedImport.summary?.failureCount) || 0,
    failures: clonePlain(preparedImport.failures ?? [])
  };
}

function inspectDraftEntry(rawWordKey, candidate, index) {
  const wordKey = normalizeWordKey(rawWordKey);
  if (!wordKey || wordKey !== rawWordKey) {
    return rejected(rawWordKey, "INVALID_WORD_KEY", "wordKey 必须使用词库中的规范标识");
  }
  if (!index.displayByWordKey.has(wordKey)) {
    return rejected(wordKey, "WORD_NOT_FOUND", "wordKey 不存在于当前词库");
  }
  if (!isPlainObject(candidate)) {
    return rejected(wordKey, "INVALID_DETAILS", "词条详情必须是对象");
  }

  const draftErrors = validateDraftArrays(candidate);
  if (draftErrors.length > 0) {
    return {
      wordKey,
      status: "rejected",
      errors: draftErrors
    };
  }

  const canonicalCandidate = {
    ...candidate,
    collocations: Array.isArray(candidate.collocations)
      ? candidate.collocations.map(toCanonicalCollocation)
      : candidate.collocations
  };
  const canonicalErrors = validateVocabularyDetails(canonicalCandidate);
  if (canonicalErrors.length > 0) {
    return {
      wordKey,
      status: "rejected",
      errors: canonicalErrors.map((error) => ({
        code: VOCABULARY_DETAILS_IMPORT_ERROR_CODES.INVALID_DETAILS,
        message: error.message
      }))
    };
  }

  return {
    wordKey,
    status: "ready",
    details: normalizeVocabularyDetails(canonicalCandidate),
    errors: []
  };
}

function validateDraftArrays(candidate) {
  const errors = [];
  validateRequiredObjectArray(candidate, "meanings", ["partOfSpeech", "definitionZh"], errors);
  validateCollocations(candidate, errors);
  validateRequiredObjectArray(candidate, "examples", ["en", "zh"], errors);
  return errors;
}

function validateRequiredObjectArray(candidate, field, requiredFields, errors) {
  if (!(field in candidate)) {
    return;
  }
  if (!Array.isArray(candidate[field])) {
    errors.push(invalidDetails(`${field} 必须是数组`));
    return;
  }
  candidate[field].forEach((item, index) => {
    if (!isPlainObject(item)) {
      errors.push(invalidDetails(`${field}[${index}] 必须是对象`));
      return;
    }
    for (const requiredField of requiredFields) {
      if (!(requiredField in item)) {
        errors.push(missingField(`${field}[${index}].${requiredField} 缺失`));
      } else if (typeof item[requiredField] !== "string") {
        errors.push(invalidDetails(`${field}[${index}].${requiredField} 必须是字符串`));
      }
    }
  });
}

function validateCollocations(candidate, errors) {
  if (!("collocations" in candidate)) {
    return;
  }
  if (!Array.isArray(candidate.collocations)) {
    errors.push(invalidDetails("collocations 必须是数组"));
    return;
  }
  candidate.collocations.forEach((item, index) => {
    if (typeof item === "string") {
      return;
    }
    if (!isPlainObject(item)) {
      errors.push(invalidDetails(`collocations[${index}] 必须是字符串或对象`));
      return;
    }
    for (const field of ["phrase", "meaningZh"]) {
      if (!(field in item)) {
        errors.push(missingField(`collocations[${index}].${field} 缺失`));
      } else if (typeof item[field] !== "string") {
        errors.push(invalidDetails(`collocations[${index}].${field} 必须是字符串`));
      }
    }
  });
}

function toCanonicalCollocation(item) {
  if (typeof item === "string") {
    return item;
  }
  return item.meaningZh ? `${item.phrase} — ${item.meaningZh}` : item.phrase;
}

function getRepositoryIndex(repository) {
  assertRepository(repository);
  const validation = validateVocabularyData(repository.getCurrentVocabulary());
  if (!validation.isValid) {
    throw importError("INVALID_ROOT", "当前词库无效，无法导入详情");
  }
  return validation.index;
}

function assertRepository(repository) {
  if (
    !repository ||
    typeof repository.getCurrentVocabulary !== "function" ||
    typeof repository.setWordDetails !== "function" ||
    typeof repository.save !== "function"
  ) {
    throw new TypeError("必须提供有效的 vocabulary repository。");
  }
}

function rejected(wordKey, codeKey, message) {
  return {
    wordKey,
    status: "rejected",
    errors: [{ code: VOCABULARY_DETAILS_IMPORT_ERROR_CODES[codeKey], message }]
  };
}

function invalidDetails(message) {
  return { code: VOCABULARY_DETAILS_IMPORT_ERROR_CODES.INVALID_DETAILS, message };
}

function missingField(message) {
  return { code: VOCABULARY_DETAILS_IMPORT_ERROR_CODES.MISSING_FIELD, message };
}

function importError(codeKey, message, cause) {
  return new VocabularyDetailsImportError(
    VOCABULARY_DETAILS_IMPORT_ERROR_CODES[codeKey],
    message,
    cause ? { cause } : undefined
  );
}

function isPlainObject(candidate) {
  return Boolean(candidate && typeof candidate === "object" && !Array.isArray(candidate));
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}
