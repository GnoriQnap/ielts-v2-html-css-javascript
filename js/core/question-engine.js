export const DEFAULT_OPTION_COUNT = 6;

export function getEligibleWordKeys(index, optionCount = DEFAULT_OPTION_COUNT) {
  assertUsableIndex(index, optionCount);

  return index.allWordKeys.filter((wordKey) => {
    const correctGroupCount = index.groupIdsByWordKey.get(wordKey)?.size ?? 0;
    return correctGroupCount > 0 && correctGroupCount <= optionCount;
  });
}

export function selectRandomWordKey(index, options = {}) {
  const {
    optionCount = DEFAULT_OPTION_COUNT,
    random = Math.random,
    excludeWordKey = null
  } = options;
  const eligibleWordKeys = getEligibleWordKeys(index, optionCount);

  if (eligibleWordKeys.length === 0) {
    throw new Error("没有可生成合法题目的词条。");
  }

  const candidates = eligibleWordKeys.length > 1 && excludeWordKey
    ? eligibleWordKeys.filter((wordKey) => wordKey !== excludeWordKey)
    : eligibleWordKeys;

  return candidates[randomIndex(candidates.length, random)];
}

export function createQuestion(index, options = {}) {
  const {
    wordKey = null,
    optionCount = DEFAULT_OPTION_COUNT,
    random = Math.random,
    excludeWordKey = null
  } = options;

  assertUsableIndex(index, optionCount);

  const selectedWordKey = wordKey ?? selectRandomWordKey(index, {
    optionCount,
    random,
    excludeWordKey
  });
  const correctGroupSet = index.groupIdsByWordKey.get(selectedWordKey);

  if (!correctGroupSet || correctGroupSet.size === 0) {
    throw new Error(`词条“${selectedWordKey}”没有有效分类。`);
  }
  if (correctGroupSet.size > optionCount) {
    throw new Error(`词条“${selectedWordKey}”的正确分类超过 ${optionCount} 个。`);
  }

  const correctGroupIds = [...correctGroupSet];
  const distractorGroupIds = [...index.groupById.keys()].filter(
    (groupId) => !correctGroupSet.has(groupId)
  );
  const distractorsNeeded = optionCount - correctGroupIds.length;

  if (distractorGroupIds.length < distractorsNeeded) {
    throw new Error(`有效分类不足，无法为词条“${selectedWordKey}”生成 ${optionCount} 个不同选项。`);
  }

  const chosenDistractors = shuffle(distractorGroupIds, random).slice(0, distractorsNeeded);
  const optionGroupIds = shuffle([...correctGroupIds, ...chosenDistractors], random);

  return {
    wordKey: selectedWordKey,
    displayText: index.displayByWordKey.get(selectedWordKey),
    type: correctGroupIds.length === 1 ? "single" : "multiple",
    correctGroupIds,
    options: optionGroupIds.map((groupId) => ({
      groupId,
      category: index.groupById.get(groupId).category
    }))
  };
}

export function isAnswerCorrect(selectedGroupIds, correctGroupIds) {
  const selected = toSet(selectedGroupIds);
  const correct = toSet(correctGroupIds);

  if (selected.size !== correct.size) {
    return false;
  }

  for (const groupId of correct) {
    if (!selected.has(groupId)) {
      return false;
    }
  }

  return true;
}

function assertUsableIndex(index, optionCount) {
  if (!index?.allWordKeys || !index?.groupIdsByWordKey || !index?.groupById) {
    throw new TypeError("必须提供有效的 vocabulary index。");
  }
  if (!Number.isInteger(optionCount) || optionCount < 1) {
    throw new RangeError("optionCount 必须是正整数。");
  }
  if (index.groupById.size < optionCount) {
    throw new Error(`有效分类不足 ${optionCount} 个。`);
  }
}

function shuffle(values, random) {
  const result = [...values];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, random);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function randomIndex(length, random) {
  if (typeof random !== "function") {
    throw new TypeError("random 必须是函数。");
  }
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("random 必须返回大于等于 0 且小于 1 的数。");
  }
  return Math.floor(value * length);
}

function toSet(values) {
  if (values instanceof Set || Array.isArray(values)) {
    return new Set(values);
  }
  throw new TypeError("答案必须是数组或 Set。");
}
