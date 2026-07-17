export const VOCABULARY_STORAGE_KEY = "ielts_synonym_trainer_vocabulary";
export const VOCABULARY_CACHE_SCHEMA_VERSION = 1;

export function createVocabularyRepository(options = {}) {
  const {
    storage = globalThis.localStorage,
    fallbackVocabulary,
    legacyStateKey = null,
    now = () => new Date()
  } = options;
  const fallback = requireVocabularyData(fallbackVocabulary);
  let currentVocabulary = null;

  return {
    load() {
      const cached = readVocabularyCache(storage);
      const legacy = readLegacyVocabulary(storage, legacyStateKey);
      currentVocabulary = clonePlain(cached ?? legacy ?? fallback);
      if (cached) {
        removeLegacyVocabulary(storage, legacyStateKey);
      } else if (legacy) {
        migrateLegacyVocabulary(storage, legacyStateKey, currentVocabulary, now);
      }
      return clonePlain(currentVocabulary);
    },

    save(vocabulary) {
      const nextVocabulary = requireVocabularyData(vocabulary);
      const cached = createVocabularyCache(nextVocabulary, now);

      if (storage?.setItem) {
        storage.setItem(VOCABULARY_STORAGE_KEY, JSON.stringify(cached));
      }
      currentVocabulary = cached.vocabulary;
      return clonePlain(currentVocabulary);
    },

    getCurrentVocabulary() {
      return currentVocabulary ? clonePlain(currentVocabulary) : null;
    }
  };
}

function readVocabularyCache(storage) {
  const parsed = readJson(storage, VOCABULARY_STORAGE_KEY);
  if (!parsed) {
    return null;
  }

  const candidate = isVocabularyData(parsed)
    ? parsed
    : parsed.vocabulary;
  return isVocabularyData(candidate) ? candidate : null;
}

function readLegacyVocabulary(storage, legacyStateKey) {
  if (typeof legacyStateKey !== "string" || legacyStateKey.length === 0) {
    return null;
  }
  const parsed = readJson(storage, legacyStateKey);
  return isVocabularyData(parsed?.vocabulary) ? parsed.vocabulary : null;
}

function migrateLegacyVocabulary(storage, legacyStateKey, vocabulary, now) {
  try {
    if (!storage?.setItem) {
      return;
    }
    storage.setItem(
      VOCABULARY_STORAGE_KEY,
      JSON.stringify(createVocabularyCache(vocabulary, now))
    );
    removeLegacyVocabulary(storage, legacyStateKey);
  } catch {
    // Keep using the in-memory vocabulary. The untouched legacy state remains a safe fallback.
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

function createVocabularyCache(vocabulary, now) {
  return {
    schemaVersion: VOCABULARY_CACHE_SCHEMA_VERSION,
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

function isVocabularyData(candidate) {
  return Boolean(
    candidate &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    Array.isArray(candidate.vocabulary_list)
  );
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}
