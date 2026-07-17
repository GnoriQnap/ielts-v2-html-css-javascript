import { normalizeCategoryName, normalizeWordKey } from "./normalization.js";

export function createCategoryList(vocabulary) {
  return getVocabularyList(vocabulary).map((group) => ({
    groupId: group.group_id,
    category: group.category,
    wordCount: new Set(
      (Array.isArray(group.words) ? group.words : [])
        .map(normalizeWordKey)
        .filter(Boolean)
    ).size
  }));
}

export function addCategory(vocabulary, categoryName) {
  const vocabularyList = getVocabularyList(vocabulary);
  const category = requireAvailableCategoryName(vocabularyList, categoryName);
  const groupId = vocabularyList.reduce(
    (maximum, group) => Number.isInteger(group?.group_id)
      ? Math.max(maximum, group.group_id)
      : maximum,
    0
  ) + 1;
  const group = { group_id: groupId, category, words: [] };

  return {
    vocabulary: clonePlain({
      ...vocabulary,
      vocabulary_list: [...vocabularyList, group]
    }),
    group: clonePlain(group)
  };
}

export function renameCategory(vocabulary, groupId, categoryName) {
  const vocabularyList = getVocabularyList(vocabulary);
  const groupIndex = vocabularyList.findIndex((group) => group?.group_id === groupId);
  if (groupIndex === -1) {
    throw new RangeError("没有找到需要编辑的分类。");
  }

  const category = requireAvailableCategoryName(vocabularyList, categoryName, groupId);
  const nextList = vocabularyList.map((group, index) => index === groupIndex
    ? { ...group, category }
    : group
  );

  return {
    vocabulary: clonePlain({ ...vocabulary, vocabulary_list: nextList }),
    group: clonePlain(nextList[groupIndex])
  };
}

function requireAvailableCategoryName(vocabularyList, value, excludedGroupId = null) {
  const category = normalizeCategoryName(value);
  if (!category) {
    throw new RangeError("分类名称不能为空。");
  }

  const duplicate = vocabularyList.some((group) => (
    group?.group_id !== excludedGroupId &&
    normalizeCategoryName(group?.category) === category
  ));
  if (duplicate) {
    throw new RangeError("分类名称不能重复。");
  }
  return category;
}

function getVocabularyList(vocabulary) {
  if (!vocabulary || !Array.isArray(vocabulary.vocabulary_list)) {
    throw new TypeError("词库必须包含 vocabulary_list 数组。");
  }
  return vocabulary.vocabulary_list;
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}
