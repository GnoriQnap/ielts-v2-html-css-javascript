import { vocabularyData } from "../data/vocabulary.js";
import { normalizeWordKey } from "./normalization.js";

const OFFICIAL_WORD_KEY_SET = new Set(
  vocabularyData.vocabulary_list
    .flatMap((group) => group.words)
    .map(normalizeWordKey)
    .filter(Boolean)
);
const OFFICIAL_GROUP_ID_SET = new Set(
  vocabularyData.vocabulary_list.map(({ group_id: groupId }) => groupId)
);

export const officialSystemWordKeys = Object.freeze([...OFFICIAL_WORD_KEY_SET]);
export const officialSystemGroupIds = Object.freeze([...OFFICIAL_GROUP_ID_SET]);

export function isOfficialWordKey(value) {
  return OFFICIAL_WORD_KEY_SET.has(normalizeWordKey(value));
}

export function isOfficialGroupId(value) {
  return OFFICIAL_GROUP_ID_SET.has(value);
}

export const OFFICIAL_VOCABULARY_ERROR_CODES = Object.freeze({
  CATEGORY_READ_ONLY: "OFFICIAL_CATEGORY_READ_ONLY",
  WORD_READ_ONLY: "OFFICIAL_WORD_READ_ONLY",
  RELATION_READ_ONLY: "OFFICIAL_WORD_RELATION_READ_ONLY",
  CUSTOM_CATEGORY_UNSUPPORTED: "OFFICIAL_WORD_CUSTOM_CATEGORY_UNSUPPORTED",
  DETAILS_READ_ONLY: "OFFICIAL_WORD_DETAILS_READ_ONLY",
  BASELINE_MUTATION: "OFFICIAL_BASELINE_MUTATION"
});

export class OfficialVocabularyMutationError extends RangeError {
  constructor(code, message, context = {}) {
    super(message);
    this.name = "OfficialVocabularyMutationError";
    this.code = code;
    this.context = context;
  }
}

export function officialVocabularyError(code, message, context = {}) {
  return new OfficialVocabularyMutationError(code, message, context);
}
