import { normalizeCategoryName, normalizeWordKey } from "./normalization.js";
import {
  isOfficialGroupId,
  OFFICIAL_VOCABULARY_ERROR_CODES,
  officialVocabularyError
} from "./official-vocabulary-identity.js";

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
  if (isOfficialGroupId(groupId)) {
    throw officialVocabularyError(
      OFFICIAL_VOCABULARY_ERROR_CODES.CATEGORY_READ_ONLY,
      "系统分类不可重命名。",
      { groupId }
    );
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

export function deleteCategory(vocabulary, groupId, { protectedGroupIds = [] } = {}) {
  const vocabularyList = getVocabularyList(vocabulary);
  const group = vocabularyList.find((item) => item?.group_id === groupId);
  if (!group) {
    throw new RangeError("没有找到需要删除的分类。");
  }
  if (isOfficialGroupId(groupId)) {
    throw officialVocabularyError(
      OFFICIAL_VOCABULARY_ERROR_CODES.CATEGORY_READ_ONLY,
      "系统分类不可删除。",
      { groupId }
    );
  }

  const protectedIds = new Set(
    Array.isArray(protectedGroupIds) ? protectedGroupIds : []
  );
  if (protectedIds.has(groupId)) {
    throw new RangeError("当前题正在使用该分类，暂时无法删除。");
  }

  const relationCounts = createWordRelationCounts(vocabularyList);
  const wordKeys = [...new Set(
    (Array.isArray(group.words) ? group.words : [])
      .map(normalizeWordKey)
      .filter(Boolean)
  )];
  if (wordKeys.some((wordKey) => (relationCounts.get(wordKey) ?? 0) <= 1)) {
    throw new RangeError(
      "该分类包含只能属于此分类的词条。请先删除这些词条或将它们加入其他分类。"
    );
  }

  return {
    vocabulary: clonePlain({
      ...vocabulary,
      vocabulary_list: vocabularyList.filter((item) => item?.group_id !== groupId)
    }),
    group: clonePlain(group),
    removedRelationCount: wordKeys.length
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

function createWordRelationCounts(vocabularyList) {
  const counts = new Map();
  for (const group of vocabularyList) {
    const groupWordKeys = new Set(
      (Array.isArray(group?.words) ? group.words : [])
        .map(normalizeWordKey)
        .filter(Boolean)
    );
    for (const wordKey of groupWordKeys) {
      counts.set(wordKey, (counts.get(wordKey) ?? 0) + 1);
    }
  }
  return counts;
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}
