import { normalizeWordKey } from "./normalization.js";

export function createVocabularyIndex(vocabularyList) {
  const displayByWordKey = new Map();
  const groupIdsByWordKey = new Map();
  const groupById = new Map();
  const rawVariantsByWordKey = new Map();
  const allWordKeys = [];

  for (const group of Array.isArray(vocabularyList) ? vocabularyList : []) {
    if (!group || typeof group !== "object") {
      continue;
    }

    if (!groupById.has(group.group_id)) {
      groupById.set(group.group_id, group);
    }

    for (const rawWord of Array.isArray(group.words) ? group.words : []) {
      const wordKey = normalizeWordKey(rawWord);
      if (!wordKey) {
        continue;
      }

      if (!displayByWordKey.has(wordKey)) {
        displayByWordKey.set(wordKey, rawWord);
        groupIdsByWordKey.set(wordKey, new Set());
        rawVariantsByWordKey.set(wordKey, new Set());
        allWordKeys.push(wordKey);
      }

      groupIdsByWordKey.get(wordKey).add(group.group_id);
      rawVariantsByWordKey.get(wordKey).add(rawWord);
    }
  }

  return {
    displayByWordKey,
    groupIdsByWordKey,
    groupById,
    rawVariantsByWordKey,
    allWordKeys
  };
}
