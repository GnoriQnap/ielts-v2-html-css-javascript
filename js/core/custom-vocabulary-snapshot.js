import { vocabularyData } from "../data/vocabulary.js";
import { normalizeCategoryName, normalizeWordKey } from "./normalization.js";
import {
  normalizeVocabularyDetails,
  validateVocabularyDetails
} from "./vocabulary-details.js";
import { validateVocabularyData } from "./vocabulary-validator.js";

export const CUSTOM_VOCABULARY_SCHEMA_VERSION = 1;

export const officialSystemWordKeys = Object.freeze(
  collectOfficialWordKeys(vocabularyData)
);

export const officialSystemGroupIds = Object.freeze(
  vocabularyData.vocabulary_list.map(({ group_id: groupId }) => groupId)
);

const CATEGORY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function createEmptyCustomVocabularySnapshot() {
  return {
    schemaVersion: CUSTOM_VOCABULARY_SCHEMA_VERSION,
    categories: [],
    words: []
  };
}

export function createStableCustomCategoryId(options = {}) {
  const randomUUID = Object.hasOwn(options, "randomUUID")
    ? options.randomUUID
    : globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (typeof randomUUID !== "function") {
    throw new Error("当前环境不支持 crypto.randomUUID；请注入安全的 randomUUID generator。");
  }
  const categoryId = randomUUID();
  if (!isValidCategoryId(categoryId)) {
    throw new TypeError("categoryId generator 必须返回有效 UUID。");
  }
  return categoryId.toLowerCase();
}

export function createCustomVocabularySnapshot(fullVocabulary, officialBaseline, options = {}) {
  const mutation = detectOfficialVocabularyMutations(fullVocabulary, officialBaseline);
  if (!mutation.isValid) {
    return failure(mutation.errors);
  }

  const fullValidation = validateVocabularyData(fullVocabulary);
  if (!fullValidation.isValid) {
    return failure(fullValidation.errors.map(({ code, message, context }) =>
      problem(code, message, context)));
  }

  const identityByGroupId = normalizeIdentityMetadata(options.identityMetadata);
  const official = createOfficialIdentity(officialBaseline);
  const categories = [];
  const categoryIdByGroupId = new Map();

  for (const group of fullVocabulary.vocabulary_list) {
    if (official.groupIds.has(group.group_id)) {
      continue;
    }
    let categoryId = identityByGroupId.get(group.group_id);
    if (!categoryId && typeof options.generateCategoryId === "function") {
      categoryId = options.generateCategoryId(group);
    }
    if (!isValidCategoryId(categoryId)) {
      return failure([problem(
        "MISSING_CUSTOM_CATEGORY_IDENTITY",
        `自定义分类“${group.category}”缺少稳定 categoryId。`,
        { groupId: group.group_id, category: group.category }
      )]);
    }
    categoryId = categoryId.toLowerCase();
    categoryIdByGroupId.set(group.group_id, categoryId);
    categories.push({ categoryId, category: group.category });
  }

  const customWords = new Map();
  for (const group of fullVocabulary.vocabulary_list) {
    for (const displayText of group.words) {
      const wordKey = normalizeWordKey(displayText);
      if (official.wordKeys.has(wordKey)) {
        if (!official.groupIds.has(group.group_id)) {
          return failure([problem(
            "SYSTEM_WORD_CUSTOM_CATEGORY_UNSUPPORTED",
            `官方词条“${wordKey}”加入自定义分类的关系无法由 schema v1 表达。`,
            { wordKey, groupId: group.group_id }
          )]);
        }
        continue;
      }
      if (!customWords.has(wordKey)) {
        customWords.set(wordKey, {
          wordKey,
          displayText,
          memberships: [],
          details: normalizeVocabularyDetails(fullVocabulary.word_details?.[wordKey])
        });
      }
      customWords.get(wordKey).memberships.push(
        official.groupIds.has(group.group_id)
          ? { kind: "system", groupId: group.group_id }
          : { kind: "custom", categoryId: categoryIdByGroupId.get(group.group_id) }
      );
    }
  }

  const snapshot = canonicalizeSnapshot({
    schemaVersion: CUSTOM_VOCABULARY_SCHEMA_VERSION,
    categories,
    words: [...customWords.values()]
  });
  const validation = validateCustomVocabularySnapshot(snapshot, officialBaseline);
  return validation.isValid
    ? { ok: true, snapshot: validation.snapshot, errors: [] }
    : failure(validation.errors);
}

export function validateCustomVocabularySnapshot(candidate, officialBaseline) {
  const errors = [];
  if (hasDangerousStructure(candidate)) {
    return invalid([problem("UNSAFE_SNAPSHOT_OBJECT", "Custom Vocabulary Snapshot 包含不安全对象或属性。")]);
  }
  if (!isPlainObject(candidate)) {
    return invalid([problem("INVALID_SNAPSHOT", "Custom Vocabulary Snapshot 必须是普通对象。")]);
  }
  if (candidate.schemaVersion !== CUSTOM_VOCABULARY_SCHEMA_VERSION) {
    errors.push(problem("INVALID_SCHEMA_VERSION", "Custom Vocabulary Snapshot schemaVersion 必须为 1。"));
  }
  if (!Array.isArray(candidate.categories)) {
    errors.push(problem("INVALID_CATEGORIES", "categories 必须是数组。"));
  }
  if (!Array.isArray(candidate.words)) {
    errors.push(problem("INVALID_WORDS", "words 必须是数组。"));
  }
  if (errors.length > 0) {
    return invalid(errors);
  }

  const official = createOfficialIdentity(officialBaseline, errors);
  const categoryIds = new Set();
  const categoryNames = new Set();
  const categories = [];
  for (const [index, category] of candidate.categories.entries()) {
    if (!isPlainObject(category)) {
      errors.push(problem("INVALID_CUSTOM_CATEGORY", `categories[${index}] 必须是普通对象。`, { index }));
      continue;
    }
    const categoryId = category.categoryId;
    const name = normalizeCategoryName(category.category);
    if (!isValidCategoryId(categoryId)) {
      errors.push(problem("INVALID_CATEGORY_ID", `categories[${index}].categoryId 必须是 UUID。`, { index }));
    } else if (categoryIds.has(categoryId.toLowerCase())) {
      errors.push(problem("DUPLICATE_CATEGORY_ID", `categoryId“${categoryId}”重复。`, { categoryId }));
    } else {
      categoryIds.add(categoryId.toLowerCase());
    }
    if (!name) {
      errors.push(problem("INVALID_CATEGORY_NAME", `categories[${index}].category 不能为空。`, { index }));
    } else if (categoryNames.has(name)) {
      errors.push(problem("DUPLICATE_CATEGORY_NAME", `自定义分类名称“${name}”重复。`, { category: name }));
    } else if (official.categoryNames.has(name)) {
      errors.push(problem("CATEGORY_NAME_COLLISION", `自定义分类名称“${name}”与官方分类冲突。`, { category: name }));
    } else {
      categoryNames.add(name);
    }
    categories.push({ categoryId: String(categoryId).toLowerCase(), category: name });
  }

  const wordKeys = new Set();
  const words = [];
  for (const [index, word] of candidate.words.entries()) {
    if (!isPlainObject(word)) {
      errors.push(problem("INVALID_CUSTOM_WORD", `words[${index}] 必须是普通对象。`, { index }));
      continue;
    }
    const wordKey = normalizeWordKey(word.wordKey);
    const displayText = typeof word.displayText === "string" ? word.displayText.normalize("NFC").trim() : "";
    if (!wordKey || word.wordKey !== wordKey) {
      errors.push(problem("INVALID_WORD_KEY", `words[${index}].wordKey 必须是规范 wordKey。`, { index }));
    } else if (official.wordKeys.has(wordKey)) {
      errors.push(problem("SYSTEM_WORD_COLLISION", `自定义词条“${wordKey}”与官方词条冲突。`, { wordKey }));
    } else if (wordKeys.has(wordKey)) {
      errors.push(problem("DUPLICATE_WORD_KEY", `自定义 wordKey“${wordKey}”重复。`, { wordKey }));
    } else {
      wordKeys.add(wordKey);
    }
    if (!displayText) {
      errors.push(problem("INVALID_DISPLAY_TEXT", `words[${index}].displayText 不能为空。`, { index }));
    } else if (normalizeWordKey(displayText) !== wordKey) {
      errors.push(problem("WORD_IDENTITY_MISMATCH", `词条“${displayText}”与 wordKey“${word.wordKey}”身份不一致。`, { wordKey: word.wordKey, displayText }));
    }
    const memberships = validateMemberships(word.memberships, index, categoryIds, official.groupIds, errors);
    const detailErrors = validateVocabularyDetails(word.details);
    for (const detailError of detailErrors) {
      errors.push(problem(detailError.code, `词条“${word.wordKey}”的 ${detailError.message}`, { wordKey: word.wordKey }));
    }
    words.push({
      wordKey,
      displayText,
      memberships,
      details: normalizeVocabularyDetails(word.details)
    });
  }

  if (errors.length > 0) {
    return invalid(errors);
  }
  return {
    isValid: true,
    errors: [],
    snapshot: canonicalizeSnapshot({
      schemaVersion: CUSTOM_VOCABULARY_SCHEMA_VERSION,
      categories,
      words
    })
  };
}

export function composeVocabulary(officialBaseline, customSnapshot) {
  const validation = validateCustomVocabularySnapshot(customSnapshot, officialBaseline);
  if (!validation.isValid) {
    return failure(validation.errors);
  }
  const baselineValidation = validateVocabularyData(officialBaseline);
  if (!baselineValidation.isValid) {
    return failure([problem("INVALID_OFFICIAL_BASELINE", "Official baseline 不是有效词库。")]);
  }

  const snapshot = validation.snapshot;
  const vocabulary = clonePlain(officialBaseline);
  const maxOfficialGroupId = Math.max(0, ...vocabulary.vocabulary_list.map(({ group_id: id }) => id));
  const customCategoryIdByGroupId = {};
  const groupIdByCategoryId = new Map();
  snapshot.categories.forEach((category, index) => {
    const groupId = maxOfficialGroupId + index + 1;
    groupIdByCategoryId.set(category.categoryId, groupId);
    customCategoryIdByGroupId[groupId] = category.categoryId;
    vocabulary.vocabulary_list.push({
      group_id: groupId,
      category: category.category,
      words: []
    });
  });
  const groupById = new Map(vocabulary.vocabulary_list.map((group) => [group.group_id, group]));
  vocabulary.word_details = { ...(vocabulary.word_details ?? {}) };
  for (const word of snapshot.words) {
    for (const membership of word.memberships) {
      const groupId = membership.kind === "system"
        ? membership.groupId
        : groupIdByCategoryId.get(membership.categoryId);
      groupById.get(groupId).words.push(word.displayText);
    }
    vocabulary.word_details[word.wordKey] = clonePlain(word.details);
  }
  const composedValidation = validateVocabularyData(vocabulary);
  if (!composedValidation.isValid) {
    return failure(composedValidation.errors.map(({ code, message, context }) =>
      problem(code, message, context)));
  }
  return {
    ok: true,
    vocabulary,
    // Stable IDs intentionally live beside the legacy Repository shape. The
    // integer group_id values are only a deterministic runtime adapter.
    identityMetadata: { customCategoryIdByGroupId },
    errors: []
  };
}

export function detectOfficialVocabularyMutations(fullVocabulary, officialBaseline) {
  const errors = [];
  if (!isPlainObject(fullVocabulary) || !Array.isArray(fullVocabulary.vocabulary_list)) {
    return invalid([problem("INVALID_FULL_VOCABULARY", "完整词库结构无效。")]);
  }
  const official = createOfficialIdentity(officialBaseline, errors);
  if (errors.length > 0) {
    return invalid(errors);
  }
  const fullGroupById = new Map(fullVocabulary.vocabulary_list.map((group) => [group?.group_id, group]));
  const currentOfficialGroupOrder = fullVocabulary.vocabulary_list
    .map((group) => group?.group_id)
    .filter((groupId) => official.groupIds.has(groupId));
  const baselineOfficialGroupOrder = officialBaseline.vocabulary_list.map(({ group_id: groupId }) => groupId);
  if (!deepEqual(currentOfficialGroupOrder, baselineOfficialGroupOrder)) {
    errors.push(problem("OFFICIAL_GROUP_ORDER_CHANGED", "官方分类顺序与 baseline 不一致。"));
  }
  for (const officialGroup of officialBaseline.vocabulary_list) {
    const currentGroup = fullGroupById.get(officialGroup.group_id);
    if (!currentGroup) {
      errors.push(problem("MISSING_OFFICIAL_GROUP", `官方分类 ${officialGroup.group_id} 缺失。`, { groupId: officialGroup.group_id }));
      continue;
    }
    if (currentGroup.category !== officialGroup.category) {
      errors.push(problem("RENAMED_OFFICIAL_GROUP", `官方分类 ${officialGroup.group_id} 名称被修改。`, { groupId: officialGroup.group_id }));
    }
    if (!deepEqual(omitWords(currentGroup), omitWords(officialGroup))) {
      errors.push(problem("OFFICIAL_GROUP_METADATA_OVERRIDE", `官方分类 ${officialGroup.group_id} 的 metadata 被修改。`, { groupId: officialGroup.group_id }));
    }
    const expectedKeys = new Set(officialGroup.words.map(normalizeWordKey));
    const currentKeys = new Set(Array.isArray(currentGroup.words) ? currentGroup.words.map(normalizeWordKey) : []);
    for (const wordKey of expectedKeys) {
      if (!currentKeys.has(wordKey)) {
        errors.push(problem("MISSING_OFFICIAL_RELATION", `官方词条关系 ${officialGroup.group_id} → ${wordKey} 缺失。`, { groupId: officialGroup.group_id, wordKey }));
      }
    }
    for (const wordKey of currentKeys) {
      if (official.wordKeys.has(wordKey) && !expectedKeys.has(wordKey)) {
        errors.push(problem("ADDED_OFFICIAL_RELATION", `官方词条关系 ${officialGroup.group_id} → ${wordKey} 不属于 baseline。`, { groupId: officialGroup.group_id, wordKey }));
      }
    }
    const currentOfficialWords = Array.isArray(currentGroup.words)
      ? currentGroup.words.filter((displayText) => official.wordKeys.has(normalizeWordKey(displayText)))
      : [];
    if (!deepEqual(currentOfficialWords, officialGroup.words)) {
      errors.push(problem("OFFICIAL_WORD_REPRESENTATION_CHANGED", `官方分类 ${officialGroup.group_id} 的词条文本或顺序被修改。`, { groupId: officialGroup.group_id }));
    }
  }
  for (const group of fullVocabulary.vocabulary_list) {
    if (official.groupIds.has(group?.group_id)) {
      continue;
    }
    for (const displayText of Array.isArray(group?.words) ? group.words : []) {
      const wordKey = normalizeWordKey(displayText);
      if (official.wordKeys.has(wordKey)) {
        errors.push(problem("SYSTEM_WORD_CUSTOM_CATEGORY_UNSUPPORTED", `官方词条“${wordKey}”不能加入自定义分类（schema v1）。`, { wordKey, groupId: group.group_id }));
      }
    }
  }
  const baselineDetails = officialBaseline.word_details ?? {};
  const fullDetails = fullVocabulary.word_details ?? {};
  for (const wordKey of official.wordKeys) {
    if (!deepEqual(fullDetails[wordKey], baselineDetails[wordKey])) {
      errors.push(problem("OFFICIAL_DETAILS_OVERRIDE", `官方词条“${wordKey}”的详情与 baseline 不一致。`, { wordKey }));
    }
  }
  return { isValid: errors.length === 0, errors };
}

export const CUSTOM_VOCABULARY_LOAD_ORDER = Object.freeze([
  "auth",
  "custom-vocabulary",
  "compose-vocabulary-index",
  "cloud-learning-state",
  "normalize-learning-state"
]);

function validateMemberships(candidate, wordIndex, categoryIds, officialGroupIds, errors) {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    errors.push(problem("EMPTY_MEMBERSHIPS", `words[${wordIndex}].memberships 必须是非空数组。`, { wordIndex }));
    return [];
  }
  const seen = new Set();
  const memberships = [];
  candidate.forEach((membership, membershipIndex) => {
    if (!isPlainObject(membership)) {
      errors.push(problem("INVALID_MEMBERSHIP", `words[${wordIndex}].memberships[${membershipIndex}] 必须是普通对象。`));
      return;
    }
    let key = "";
    let normalized;
    if (membership.kind === "system") {
      if (!Number.isInteger(membership.groupId) || !officialGroupIds.has(membership.groupId)) {
        errors.push(problem("UNKNOWN_SYSTEM_GROUP", `未知的官方 groupId：${membership.groupId}。`, { groupId: membership.groupId }));
        return;
      }
      key = `system:${membership.groupId}`;
      normalized = { kind: "system", groupId: membership.groupId };
    } else if (membership.kind === "custom") {
      const categoryId = typeof membership.categoryId === "string" ? membership.categoryId.toLowerCase() : "";
      if (!categoryIds.has(categoryId)) {
        errors.push(problem("UNKNOWN_CUSTOM_CATEGORY", `未知的自定义 categoryId：${membership.categoryId}。`, { categoryId: membership.categoryId }));
        return;
      }
      key = `custom:${categoryId}`;
      normalized = { kind: "custom", categoryId };
    } else {
      errors.push(problem("INVALID_MEMBERSHIP_KIND", `membership.kind 必须是 system 或 custom。`, { kind: membership.kind }));
      return;
    }
    if (seen.has(key)) {
      errors.push(problem("DUPLICATE_MEMBERSHIP", `词条存在重复 membership：${key}。`, { membership: key }));
      return;
    }
    seen.add(key);
    memberships.push(normalized);
  });
  return memberships;
}

function createOfficialIdentity(baseline, errors = []) {
  if (!isPlainObject(baseline) || !Array.isArray(baseline.vocabulary_list)) {
    errors.push(problem("INVALID_OFFICIAL_BASELINE", "Official baseline 必须包含 vocabulary_list。"));
    return { wordKeys: new Set(), groupIds: new Set(), categoryNames: new Set() };
  }
  return {
    wordKeys: new Set(collectOfficialWordKeys(baseline)),
    groupIds: new Set(baseline.vocabulary_list.map(({ group_id: id }) => id)),
    categoryNames: new Set(baseline.vocabulary_list.map(({ category }) => normalizeCategoryName(category)))
  };
}

function collectOfficialWordKeys(baseline) {
  return [...new Set(
    baseline.vocabulary_list.flatMap((group) => group.words.map(normalizeWordKey)).filter(Boolean)
  )];
}

function normalizeIdentityMetadata(metadata) {
  if (!metadata) {
    return new Map();
  }
  const source = metadata.customCategoryIdByGroupId ?? metadata;
  return new Map(Object.entries(source).map(([groupId, categoryId]) => [Number(groupId), categoryId]));
}

function omitWords(group) {
  if (!isPlainObject(group)) {
    return group;
  }
  const { words: _words, ...metadata } = group;
  return metadata;
}

function canonicalizeSnapshot(snapshot) {
  return {
    schemaVersion: CUSTOM_VOCABULARY_SCHEMA_VERSION,
    categories: [...snapshot.categories]
      .map((category) => ({ ...category }))
      .sort((left, right) => left.categoryId.localeCompare(right.categoryId)),
    words: [...snapshot.words]
      .map((word) => ({
        ...word,
        memberships: [...word.memberships].sort(compareMemberships),
        details: clonePlain(word.details)
      }))
      .sort((left, right) => left.wordKey.localeCompare(right.wordKey))
  };
}

function compareMemberships(left, right) {
  const leftKey = left.kind === "system" ? `0:${left.groupId}` : `1:${left.categoryId}`;
  const rightKey = right.kind === "system" ? `0:${right.groupId}` : `1:${right.categoryId}`;
  return leftKey.localeCompare(rightKey, "en", { numeric: true });
}

function isValidCategoryId(value) {
  return typeof value === "string" && CATEGORY_ID_PATTERN.test(value);
}

function hasDangerousStructure(value, seen = new Set()) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return true;
  }
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return true;
  }
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key) || hasDangerousStructure(value[key], seen)) {
      return true;
    }
  }
  seen.delete(value);
  return false;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function problem(code, message, context = {}) {
  return { code, message, context };
}

function invalid(errors) {
  return { isValid: false, errors, snapshot: null };
}

function failure(errors) {
  return { ok: false, snapshot: null, vocabulary: null, identityMetadata: null, errors };
}
