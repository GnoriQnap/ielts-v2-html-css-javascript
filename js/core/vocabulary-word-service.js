import { getLearningRecord } from "./learning-service.js";
import { normalizeWordKey } from "./normalization.js";

export function addVocabularyWord(vocabulary, displayValue, groupIds) {
  const vocabularyList = getVocabularyList(vocabulary);
  const displayText = normalizeDisplayText(displayValue);
  const wordKey = normalizeWordKey(displayText);
  if (!wordKey) {
    throw new RangeError("英文词条不能为空。");
  }

  const existingWordKeys = new Set(
    vocabularyList.flatMap((group) => Array.isArray(group?.words) ? group.words : [])
      .map(normalizeWordKey)
      .filter(Boolean)
  );
  if (existingWordKeys.has(wordKey)) {
    throw new RangeError("该 wordKey 已存在，不能重复新增。");
  }

  const requestedGroupIds = new Set(Array.isArray(groupIds) ? groupIds : []);
  const validGroupIds = new Set(
    vocabularyList
      .map((group) => group?.group_id)
      .filter((groupId) => Number.isInteger(groupId))
  );
  const selectedGroupIds = vocabularyList
    .filter((group) => requestedGroupIds.has(group?.group_id))
    .map((group) => group.group_id);
  if (requestedGroupIds.size === 0) {
    throw new RangeError("请至少选择一个所属分类。");
  }
  if ([...requestedGroupIds].some((groupId) => !validGroupIds.has(groupId))) {
    throw new RangeError("选择的分类不存在。");
  }

  const selectedGroupIdSet = new Set(selectedGroupIds);
  const nextVocabulary = clonePlain({
    ...vocabulary,
    vocabulary_list: vocabularyList.map((group) => selectedGroupIdSet.has(group.group_id)
      ? { ...group, words: [...group.words, displayText] }
      : group
    )
  });

  return {
    vocabulary: nextVocabulary,
    word: {
      wordKey,
      displayText,
      groupIds: selectedGroupIds
    }
  };
}

export function editVocabularyWord(vocabulary, wordKeyValue, displayValue, groupIds) {
  const vocabularyList = getVocabularyList(vocabulary);
  const wordKey = normalizeWordKey(wordKeyValue);
  const displayText = normalizeDisplayText(displayValue);
  if (!wordKey || !hasWordKey(vocabularyList, wordKey)) {
    throw new RangeError("要编辑的词条不存在。");
  }
  if (!displayText) {
    throw new RangeError("英文词条不能为空。");
  }
  if (normalizeWordKey(displayText) !== wordKey) {
    throw new RangeError("当前版本不支持修改词条唯一标识。");
  }

  const selectedGroupIds = validateSelectedGroupIds(vocabularyList, groupIds);
  const selectedGroupIdSet = new Set(selectedGroupIds);
  const nextVocabulary = clonePlain({
    ...vocabulary,
    vocabulary_list: vocabularyList.map((group) => ({
      ...group,
      words: updateGroupWords(
        group.words,
        wordKey,
        displayText,
        selectedGroupIdSet.has(group.group_id)
      )
    }))
  });

  return {
    vocabulary: nextVocabulary,
    word: {
      wordKey,
      displayText,
      groupIds: selectedGroupIds
    }
  };
}

export function createWordManagementEntries(index, learning) {
  if (!index?.allWordKeys || !index?.displayByWordKey || !index?.groupIdsByWordKey || !index?.groupById) {
    throw new TypeError("必须提供有效的 vocabulary index。");
  }

  return index.allWordKeys.map((wordKey) => ({
    wordKey,
    displayText: index.displayByWordKey.get(wordKey),
    status: getLearningRecord(learning, wordKey).status,
    categories: [...(index.groupIdsByWordKey.get(wordKey) ?? [])].map((groupId) => ({
      groupId,
      category: index.groupById.get(groupId)?.category ?? ""
    }))
  }));
}

export function filterWordManagementEntries(entries, query) {
  const normalizedQuery = String(query ?? "").trim().toLocaleLowerCase("en-US");
  if (!normalizedQuery) {
    return [...entries];
  }

  return entries.filter((entry) => (
    entry.wordKey.includes(normalizedQuery) ||
    entry.displayText.toLocaleLowerCase("en-US").includes(normalizedQuery)
  ));
}

function normalizeDisplayText(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function hasWordKey(vocabularyList, wordKey) {
  return vocabularyList.some((group) => (
    Array.isArray(group?.words) && group.words.some((word) => normalizeWordKey(word) === wordKey)
  ));
}

function validateSelectedGroupIds(vocabularyList, groupIds) {
  const requestedGroupIds = new Set(Array.isArray(groupIds) ? groupIds : []);
  if (requestedGroupIds.size === 0) {
    throw new RangeError("请至少选择一个所属分类。");
  }

  const validGroupIds = new Set(
    vocabularyList
      .map((group) => group?.group_id)
      .filter((groupId) => Number.isInteger(groupId))
  );
  if ([...requestedGroupIds].some((groupId) => !validGroupIds.has(groupId))) {
    throw new RangeError("选择的分类不存在。");
  }

  return vocabularyList
    .filter((group) => requestedGroupIds.has(group?.group_id))
    .map((group) => group.group_id);
}

function updateGroupWords(words, wordKey, displayText, shouldContainWord) {
  const nextWords = [];
  let inserted = false;
  for (const word of Array.isArray(words) ? words : []) {
    if (normalizeWordKey(word) !== wordKey) {
      nextWords.push(word);
    } else if (shouldContainWord && !inserted) {
      nextWords.push(displayText);
      inserted = true;
    }
  }
  if (shouldContainWord && !inserted) {
    nextWords.push(displayText);
  }
  return nextWords;
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
