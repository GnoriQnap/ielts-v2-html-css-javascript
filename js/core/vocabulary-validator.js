import { normalizeCategoryName, normalizeWordKey } from "./normalization.js";
import { createVocabularyIndex } from "./vocabulary-index.js";
import { DEFAULT_OPTION_COUNT } from "./question-engine.js";

function issue(code, message, context = {}) {
  return { code, message, context };
}

export function validateVocabularyData(data) {
  const errors = [];
  const warnings = [];
  const vocabularyList = data?.vocabulary_list;

  if (!Array.isArray(vocabularyList)) {
    errors.push(issue("INVALID_VOCABULARY_LIST", "vocabulary_list 必须是数组。"));
    return {
      isValid: false,
      errors,
      warnings,
      summary: emptySummary(),
      details: emptyDetails(),
      index: createVocabularyIndex([])
    };
  }

  const ids = new Map();
  const categoryNames = new Map();
  const duplicateWordsWithinGroups = [];
  let rawWordCount = 0;

  vocabularyList.forEach((group, groupIndex) => {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      errors.push(issue("INVALID_GROUP", `第 ${groupIndex + 1} 个分类不是有效对象。`, { groupIndex }));
      return;
    }

    const groupId = group.group_id;
    if (!Number.isInteger(groupId) || groupId <= 0) {
      errors.push(issue("INVALID_GROUP_ID", `第 ${groupIndex + 1} 个分类的 group_id 必须是正整数。`, { groupIndex, groupId }));
    } else if (ids.has(groupId)) {
      errors.push(issue("DUPLICATE_GROUP_ID", `group_id ${groupId} 重复。`, { groupId, firstIndex: ids.get(groupId), groupIndex }));
    } else {
      ids.set(groupId, groupIndex);
    }

    const category = normalizeCategoryName(group.category);
    if (!category) {
      errors.push(issue("EMPTY_CATEGORY", `分类 ${groupId ?? groupIndex + 1} 的名称为空。`, { groupId, groupIndex }));
    } else if (categoryNames.has(category)) {
      errors.push(issue("DUPLICATE_CATEGORY", `分类名称“${category}”重复。`, { category, groupId, firstGroupId: categoryNames.get(category) }));
    } else {
      categoryNames.set(category, groupId);
    }

    if (!Array.isArray(group.words)) {
      errors.push(issue("INVALID_WORDS", `分类 ${groupId ?? groupIndex + 1} 的 words 必须是数组。`, { groupId, groupIndex }));
      return;
    }

    const localWordKeys = new Map();
    group.words.forEach((rawWord, wordIndex) => {
      rawWordCount += 1;
      const wordKey = normalizeWordKey(rawWord);
      if (!wordKey) {
        errors.push(issue("EMPTY_WORD", `分类 ${groupId ?? groupIndex + 1} 的第 ${wordIndex + 1} 个词条为空或不是字符串。`, { groupId, groupIndex, wordIndex }));
        return;
      }

      if (localWordKeys.has(wordKey)) {
        const duplicate = {
          groupId,
          category,
          wordKey,
          displayText: rawWord,
          firstWordIndex: localWordKeys.get(wordKey),
          duplicateWordIndex: wordIndex
        };
        duplicateWordsWithinGroups.push(duplicate);
        warnings.push(issue("DUPLICATE_WORD_IN_GROUP", `分类 ${groupId}“${category}”内重复词条：${rawWord}`, duplicate));
      } else {
        localWordKeys.set(wordKey, wordIndex);
      }
    });
  });

  const index = createVocabularyIndex(vocabularyList);
  const multiCategoryWords = [];
  const overTenCategoryWords = [];
  const rawVariantWords = [];
  let maxCategoriesPerWord = 0;

  for (const wordKey of index.allWordKeys) {
    const groupIds = [...index.groupIdsByWordKey.get(wordKey)];
    const variants = [...index.rawVariantsByWordKey.get(wordKey)];
    maxCategoriesPerWord = Math.max(maxCategoriesPerWord, groupIds.length);

    if (groupIds.length > 1) {
      multiCategoryWords.push({ wordKey, displayText: index.displayByWordKey.get(wordKey), groupIds });
    }
    if (groupIds.length > DEFAULT_OPTION_COUNT) {
      const detail = { wordKey, displayText: index.displayByWordKey.get(wordKey), groupIds };
      overTenCategoryWords.push(detail);
      errors.push(issue("TOO_MANY_CORRECT_GROUPS", `词条“${detail.displayText}”属于 ${groupIds.length} 个分类，无法生成 ${DEFAULT_OPTION_COUNT} 个选项。`, detail));
    }
    if (variants.length > 1) {
      const detail = { wordKey, variants };
      rawVariantWords.push(detail);
      warnings.push(issue("RAW_WORD_VARIANTS", `wordKey“${wordKey}”存在多个原始写法。`, detail));
    }
  }

  if (index.groupById.size < DEFAULT_OPTION_COUNT) {
    errors.push(issue("INSUFFICIENT_GROUPS", `有效分类只有 ${index.groupById.size} 个，无法生成 ${DEFAULT_OPTION_COUNT} 个选项。`, { validGroupCount: index.groupById.size }));
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    summary: {
      groupCount: vocabularyList.length,
      validGroupCount: index.groupById.size,
      rawWordCount,
      uniqueWordCount: index.allWordKeys.length,
      multiCategoryWordCount: multiCategoryWords.length,
      maxCategoriesPerWord
    },
    details: {
      duplicateWordsWithinGroups,
      multiCategoryWords,
      overTenCategoryWords,
      rawVariantWords
    },
    index
  };
}

function emptySummary() {
  return {
    groupCount: 0,
    validGroupCount: 0,
    rawWordCount: 0,
    uniqueWordCount: 0,
    multiCategoryWordCount: 0,
    maxCategoriesPerWord: 0
  };
}

function emptyDetails() {
  return {
    duplicateWordsWithinGroups: [],
    multiCategoryWords: [],
    overTenCategoryWords: [],
    rawVariantWords: []
  };
}
