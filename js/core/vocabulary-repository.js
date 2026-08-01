import { normalizeWordKey } from "./normalization.js";
import { validateVocabularyData } from "./vocabulary-validator.js";
import {
  createDefaultWordDetails,
  normalizeVocabularyDetails,
  requireVocabularyDetails
} from "./vocabulary-details.js";

export const VOCABULARY_STORAGE_KEY = "ielts_synonym_trainer_vocabulary";
export const VOCABULARY_CACHE_SCHEMA_VERSION = 1;
export const DEFAULT_DETAILS_VERSION = 1;

export function createVocabularyRepository(options = {}) {
  const {
    storage = globalThis.localStorage,
    fallbackVocabulary,
    legacyStateKey = null,
    now = () => new Date(),
    validator = validateVocabularyData
  } = options;
  const fallback = requireVocabularyData(fallbackVocabulary);
  const hasDefaultDetails = Object.keys(getWordDetailsMap(fallback)).length > 0;
  let fallbackValidation = null;
  let currentVocabulary = null;
  let currentValidation = null;

  function getFallbackValidation() {
    if (!fallbackValidation) {
      fallbackValidation = requireValidVocabularyData(fallback, validator).validation;
    }
    return fallbackValidation;
  }

  function saveCurrentVocabulary(vocabulary) {
    const candidate = requireVocabularyData(vocabulary);
    const supplemented = supplementDefaultWordDetails(candidate, fallback);
    const nextVocabulary = supplemented.vocabulary;
    const validation = validator(nextVocabulary);
    if (!validation.isValid) {
      throw new TypeError(validation.errors[0]?.message ?? "词库数据不合法。");
    }
    const cached = createVocabularyCache(nextVocabulary, now, hasDefaultDetails);

    if (storage?.setItem) {
      storage.setItem(VOCABULARY_STORAGE_KEY, JSON.stringify(cached));
    }
    currentVocabulary = cached.vocabulary;
    currentValidation = validation;
    return clonePlain(currentVocabulary);
  }

  return {
    load() {
      const cached = readVocabularyCache(storage, validator);
      const legacy = readLegacyVocabulary(storage, legacyStateKey, validator);
      const source = cached?.vocabulary ?? legacy?.vocabulary ?? fallback;
      const sourceValidation = cached?.validation ?? legacy?.validation ?? getFallbackValidation();
      const shouldSupplement = Boolean(
        hasDefaultDetails && cached?.defaultDetailsVersion !== DEFAULT_DETAILS_VERSION
      );
      const supplemented = shouldSupplement || legacy
        ? supplementDefaultWordDetails(source, fallback)
        : { vocabulary: source, changed: false };
      if (shouldSupplement || legacy) {
        getFallbackValidation();
      }
      currentVocabulary = clonePlain(supplemented.vocabulary);
      currentValidation = sourceValidation;
      if (cached) {
        if (shouldSupplement) {
          persistVocabularyCache(storage, currentVocabulary, now, hasDefaultDetails);
        }
        removeLegacyVocabulary(storage, legacyStateKey);
      } else if (legacy) {
        migrateLegacyVocabulary(
          storage,
          legacyStateKey,
          currentVocabulary,
          now,
          hasDefaultDetails
        );
      }
      return clonePlain(currentVocabulary);
    },

    save(vocabulary) {
      return saveCurrentVocabulary(vocabulary);
    },

    getCurrentVocabulary() {
      return currentVocabulary ? clonePlain(currentVocabulary) : null;
    },

    getCurrentValidation() {
      return currentValidation;
    },

    getWordDetails(wordKeyValue) {
      const wordKey = requireExistingWordKey(currentVocabulary, wordKeyValue);
      const details = getWordDetailsMap(currentVocabulary)[wordKey];
      return details
        ? normalizeVocabularyDetails(details)
        : createDefaultWordDetails();
    },

    setWordDetails(wordKeyValue, details) {
      const wordKey = requireExistingWordKey(currentVocabulary, wordKeyValue);
      const normalizedDetails = requireVocabularyDetails(details);
      const nextVocabulary = {
        ...currentVocabulary,
        word_details: {
          ...getWordDetailsMap(currentVocabulary),
          [wordKey]: normalizedDetails
        }
      };
      saveCurrentVocabulary(nextVocabulary);
      return clonePlain(normalizedDetails);
    }
  };
}

function readVocabularyCache(storage, validator) {
  const parsed = readJson(storage, VOCABULARY_STORAGE_KEY);
  if (!parsed) {
    return null;
  }

  const candidate = isVocabularyData(parsed)
    ? parsed
    : parsed.vocabulary;
  const validation = validateVocabularyCandidate(candidate, validator);
  return validation ? {
    vocabulary: candidate,
    validation,
    defaultDetailsVersion: parsed?.defaultDetailsVersion ?? 0
  } : null;
}

function readLegacyVocabulary(storage, legacyStateKey, validator) {
  if (typeof legacyStateKey !== "string" || legacyStateKey.length === 0) {
    return null;
  }
  const parsed = readJson(storage, legacyStateKey);
  const validation = validateVocabularyCandidate(parsed?.vocabulary, validator);
  return validation ? { vocabulary: parsed.vocabulary, validation } : null;
}

function migrateLegacyVocabulary(
  storage,
  legacyStateKey,
  vocabulary,
  now,
  hasDefaultDetails
) {
  try {
    if (!storage?.setItem) {
      return;
    }
    storage.setItem(
      VOCABULARY_STORAGE_KEY,
      JSON.stringify(createVocabularyCache(vocabulary, now, hasDefaultDetails))
    );
    removeLegacyVocabulary(storage, legacyStateKey);
  } catch {
    // Keep using the in-memory vocabulary. The untouched legacy state remains a safe fallback.
  }
}

function persistVocabularyCache(storage, vocabulary, now, hasDefaultDetails) {
  try {
    if (!storage?.setItem) {
      return;
    }
    storage.setItem(
      VOCABULARY_STORAGE_KEY,
      JSON.stringify(createVocabularyCache(vocabulary, now, hasDefaultDetails))
    );
  } catch {
    // The supplemented in-memory vocabulary remains usable when storage is unavailable.
  }
}

function removeLegacyVocabulary(storage, legacyStateKey) {
  try {
    if (
      typeof legacyStateKey !== "string" ||
      legacyStateKey.length === 0 ||
      !storage?.getItem ||
      !storage?.setItem
    ) {
      return;
    }
    const serialized = storage.getItem(legacyStateKey);
    if (!serialized) {
      return;
    }
    const state = JSON.parse(serialized);
    if (!state || typeof state !== "object" || !("vocabulary" in state)) {
      return;
    }
    delete state.vocabulary;
    storage.setItem(legacyStateKey, JSON.stringify(state));
  } catch {
    // A damaged or unavailable legacy store must not prevent the application from loading.
  }
}

function createVocabularyCache(vocabulary, now, hasDefaultDetails = false) {
  return {
    schemaVersion: VOCABULARY_CACHE_SCHEMA_VERSION,
    defaultDetailsVersion: hasDefaultDetails ? DEFAULT_DETAILS_VERSION : 0,
    savedAt: now().toISOString(),
    vocabulary: clonePlain(vocabulary)
  };
}

function readJson(storage, key) {
  try {
    if (!storage?.getItem) {
      return null;
    }
    const serialized = storage.getItem(key);
    return serialized ? JSON.parse(serialized) : null;
  } catch {
    return null;
  }
}

function requireVocabularyData(candidate) {
  if (!isVocabularyData(candidate)) {
    throw new TypeError("词库必须包含 vocabulary_list 数组。");
  }
  return clonePlain(candidate);
}

function requireValidVocabularyData(candidate, validator) {
  if (!isVocabularyData(candidate)) {
    throw new TypeError("词库必须包含 vocabulary_list 数组。");
  }
  const validation = validator(candidate);
  if (!validation.isValid) {
    throw new TypeError(validation.errors[0]?.message ?? "词库数据不合法。");
  }
  return { vocabulary: candidate, validation };
}

function isVocabularyData(candidate) {
  return Boolean(
    candidate &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    Array.isArray(candidate.vocabulary_list)
  );
}

function validateVocabularyCandidate(candidate, validator) {
  if (!isVocabularyData(candidate)) {
    return null;
  }
  const validation = validator(candidate);
  return validation.isValid ? validation : null;
}

function supplementDefaultWordDetails(vocabulary, fallback) {
  const defaultDetails = getWordDetailsMap(fallback);
  if (Object.keys(defaultDetails).length === 0) {
    return { vocabulary, changed: false };
  }

  const availableWordKeys = collectVocabularyWordKeys(vocabulary);
  const existingDetails = getWordDetailsMap(vocabulary);
  let nextDetails = existingDetails;
  let changed = false;

  for (const [wordKey, details] of Object.entries(defaultDetails)) {
    if (!availableWordKeys.has(wordKey) || hasNonEmptyDetails(existingDetails[wordKey])) {
      continue;
    }
    if (!changed) {
      nextDetails = { ...existingDetails };
      changed = true;
    }
    nextDetails[wordKey] = normalizeVocabularyDetails(details);
  }

  return changed
    ? { vocabulary: { ...vocabulary, word_details: nextDetails }, changed: true }
    : { vocabulary, changed: false };
}

function collectVocabularyWordKeys(vocabulary) {
  return new Set(vocabulary.vocabulary_list.flatMap((group) => (
    Array.isArray(group?.words) ? group.words.map(normalizeWordKey).filter(Boolean) : []
  )));
}

function hasNonEmptyDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return false;
  }
  const normalized = normalizeVocabularyDetails(details);
  return containsNonEmptyValue(normalized);
}

function containsNonEmptyValue(value) {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some(containsNonEmptyValue);
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(containsNonEmptyValue);
  }
  return false;
}

function requireExistingWordKey(vocabulary, wordKeyValue) {
  if (!vocabulary) {
    throw new Error("请先加载词库。");
  }
  const wordKey = normalizeWordKey(wordKeyValue);
  const exists = vocabulary.vocabulary_list.some((group) => (
    Array.isArray(group?.words) &&
    group.words.some((word) => normalizeWordKey(word) === wordKey)
  ));
  if (!wordKey || !exists) {
    throw new RangeError("词条不存在。");
  }
  return wordKey;
}

function getWordDetailsMap(vocabulary) {
  return vocabulary?.word_details &&
    typeof vocabulary.word_details === "object" &&
    !Array.isArray(vocabulary.word_details)
    ? vocabulary.word_details
    : {};
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}
