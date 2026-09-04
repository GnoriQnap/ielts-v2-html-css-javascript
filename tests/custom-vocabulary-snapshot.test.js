import test from "node:test";
import assert from "node:assert/strict";

import { defaultVocabularyData } from "../js/data/default-vocabulary.js";
import {
  CUSTOM_VOCABULARY_LOAD_ORDER,
  composeVocabulary,
  createCustomVocabularySnapshot,
  createEmptyCustomVocabularySnapshot,
  createStableCustomCategoryId,
  detectOfficialVocabularyMutations,
  officialSystemGroupIds,
  officialSystemWordKeys,
  validateCustomVocabularySnapshot
} from "../js/core/custom-vocabulary-snapshot.js";
import { validateVocabularyData } from "../js/core/vocabulary-validator.js";

const CATEGORY_A = "123e4567-e89b-42d3-a456-426614174000";
const CATEGORY_B = "123e4567-e89b-42d3-a456-426614174001";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function details(label = "自定义") {
  return {
    phonetics: { uk: "/uk/", us: "/us/" },
    meanings: [{ partOfSpeech: "n.", definitionZh: label }],
    collocations: ["custom phrase —— 自定义搭配"],
    examples: [{ en: "A custom example.", zh: "一个自定义例句。" }],
    notes: "note",
    source: "user",
    updatedAt: "2026-09-04T00:00:00Z"
  };
}

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    categories: [{ categoryId: CATEGORY_A, category: "我的分类" }],
    words: [{
      wordKey: "custom word",
      displayText: "Custom Word",
      memberships: [{ kind: "custom", categoryId: CATEGORY_A }],
      details: details()
    }],
    ...overrides
  };
}

test("empty custom snapshot composes to an independent official baseline clone", () => {
  const result = composeVocabulary(defaultVocabularyData, createEmptyCustomVocabularySnapshot());
  assert.equal(result.ok, true);
  assert.deepEqual(result.vocabulary, defaultVocabularyData);
  assert.notEqual(result.vocabulary, defaultVocabularyData);
});

test("custom word supports system, custom, and mixed memberships", () => {
  for (const memberships of [
    [{ kind: "system", groupId: 1 }],
    [{ kind: "custom", categoryId: CATEGORY_A }],
    [{ kind: "system", groupId: 1 }, { kind: "custom", categoryId: CATEGORY_A }]
  ]) {
    const result = composeVocabulary(defaultVocabularyData, snapshot({
      categories: memberships.some(({ kind }) => kind === "custom")
        ? [{ categoryId: CATEGORY_A, category: "我的分类" }]
        : [],
      words: [{ ...snapshot().words[0], memberships }]
    }));
    assert.equal(result.ok, true);
    const containingGroups = result.vocabulary.vocabulary_list.filter(({ words }) => words.includes("Custom Word"));
    assert.equal(containingGroups.length, memberships.length);
  }
});

test("custom details, memberships, display text, and category identity round-trip", () => {
  const source = snapshot({
    categories: [
      { categoryId: CATEGORY_B, category: "第二分类" },
      { categoryId: CATEGORY_A, category: "重命名后的分类" }
    ],
    words: [{
      ...snapshot().words[0],
      memberships: [
        { kind: "custom", categoryId: CATEGORY_B },
        { kind: "system", groupId: 2 },
        { kind: "custom", categoryId: CATEGORY_A }
      ]
    }]
  });
  const composed = composeVocabulary(defaultVocabularyData, source);
  assert.equal(composed.ok, true);
  const extracted = createCustomVocabularySnapshot(composed.vocabulary, defaultVocabularyData, {
    identityMetadata: composed.identityMetadata
  });
  assert.equal(extracted.ok, true);
  assert.deepEqual(extracted.snapshot, validateCustomVocabularySnapshot(source, defaultVocabularyData).snapshot);
});

test("custom category rename preserves categoryId", () => {
  const before = validateCustomVocabularySnapshot(snapshot(), defaultVocabularyData).snapshot;
  const after = validateCustomVocabularySnapshot(snapshot({
    categories: [{ categoryId: CATEGORY_A, category: "新名称" }]
  }), defaultVocabularyData).snapshot;
  assert.equal(before.categories[0].categoryId, after.categories[0].categoryId);
});

test("stable category ID uses injected UUID generator and rejects weak output", () => {
  assert.equal(createStableCustomCategoryId({ randomUUID: () => CATEGORY_A.toUpperCase() }), CATEGORY_A);
  assert.throws(() => createStableCustomCategoryId({ randomUUID: () => "category-1" }), /UUID/);
  assert.throws(() => createStableCustomCategoryId({ randomUUID: null }), /randomUUID/);
});

test("official identity helpers come from the formal baseline", () => {
  assert.equal(officialSystemWordKeys.length, 1119);
  assert.equal(officialSystemGroupIds.length, 98);
  assert.deepEqual(officialSystemGroupIds, Array.from({ length: 98 }, (_, index) => index + 1));
});

test("official words and details are never copied into a snapshot", () => {
  const result = createCustomVocabularySnapshot(defaultVocabularyData, defaultVocabularyData);
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot, createEmptyCustomVocabularySnapshot());
});

test("snapshot validator rejects collisions, unknown memberships, duplicates, and identity mismatch", () => {
  const cases = [
    [snapshot({ words: [{ ...snapshot().words[0], wordKey: "idea", displayText: "idea" }] }), "SYSTEM_WORD_COLLISION"],
    [snapshot({ words: [{ ...snapshot().words[0], memberships: [{ kind: "system", groupId: 999 }] }] }), "UNKNOWN_SYSTEM_GROUP"],
    [snapshot({ words: [{ ...snapshot().words[0], memberships: [{ kind: "custom", categoryId: CATEGORY_B }] }] }), "UNKNOWN_CUSTOM_CATEGORY"],
    [snapshot({ categories: [{ categoryId: CATEGORY_A, category: "一" }, { categoryId: CATEGORY_A, category: "二" }] }), "DUPLICATE_CATEGORY_ID"],
    [snapshot({ words: [snapshot().words[0], clone(snapshot().words[0])] }), "DUPLICATE_WORD_KEY"],
    [snapshot({ words: [{ ...snapshot().words[0], memberships: [{ kind: "system", groupId: 1 }, { kind: "system", groupId: 1 }] }] }), "DUPLICATE_MEMBERSHIP"],
    [snapshot({ words: [{ ...snapshot().words[0], displayText: "different" }] }), "WORD_IDENTITY_MISMATCH"]
  ];
  for (const [candidate, code] of cases) {
    const result = validateCustomVocabularySnapshot(candidate, defaultVocabularyData);
    assert.equal(result.isValid, false, code);
    assert.equal(result.errors.some((error) => error.code === code), true, code);
  }
});

test("snapshot validator rejects schema, category, memberships, and details shape errors", () => {
  const cases = [
    [{ ...snapshot(), schemaVersion: 2 }, "INVALID_SCHEMA_VERSION"],
    [snapshot({ categories: [{ categoryId: "weak", category: "我的分类" }] }), "INVALID_CATEGORY_ID"],
    [snapshot({ categories: [{ categoryId: CATEGORY_A, category: "表明观点" }] }), "CATEGORY_NAME_COLLISION"],
    [snapshot({ words: [{ ...snapshot().words[0], memberships: [] }] }), "EMPTY_MEMBERSHIPS"],
    [snapshot({ words: [{ ...snapshot().words[0], details: { phonetics: 7 } }] }), "INVALID_DETAILS_PHONETICS"]
  ];
  for (const [candidate, code] of cases) {
    const result = validateCustomVocabularySnapshot(candidate, defaultVocabularyData);
    assert.equal(result.errors.some((error) => error.code === code), true, code);
  }
});

test("malformed and prototype-dangerous snapshots fail safely", () => {
  const polluted = JSON.parse('{"schemaVersion":1,"categories":[],"words":[],"__proto__":{}}');
  assert.equal(validateCustomVocabularySnapshot(null, defaultVocabularyData).isValid, false);
  assert.equal(validateCustomVocabularySnapshot(polluted, defaultVocabularyData).errors[0].code, "UNSAFE_SNAPSHOT_OBJECT");
  assert.equal(validateCustomVocabularySnapshot({ ...snapshot(), words: [new Date()] }, defaultVocabularyData).errors[0].code, "UNSAFE_SNAPSHOT_OBJECT");
});

test("compose group ID mapping is deterministic, non-colliding, and not snapshot identity", () => {
  const source = snapshot({
    categories: [
      { categoryId: CATEGORY_B, category: "B 分类" },
      { categoryId: CATEGORY_A, category: "A 分类" }
    ]
  });
  const first = composeVocabulary(defaultVocabularyData, source);
  const second = composeVocabulary(defaultVocabularyData, source);
  assert.deepEqual(first.identityMetadata, second.identityMetadata);
  assert.deepEqual(first.identityMetadata.customCategoryIdByGroupId, {
    99: CATEGORY_A,
    100: CATEGORY_B
  });
  assert.equal("groupId" in first.vocabulary.vocabulary_list.at(-1), false);
  assert.equal(source.categories.some((category) => "groupId" in category), false);
});

test("compose does not mutate official baseline and passes the existing validator", () => {
  const baseline = clone(defaultVocabularyData);
  const result = composeVocabulary(baseline, snapshot());
  assert.equal(result.ok, true);
  assert.deepEqual(baseline, defaultVocabularyData);
  assert.equal(validateVocabularyData(result.vocabulary).isValid, true);
});

test("extract requires identity metadata for custom categories but can create it at an injected boundary", () => {
  const full = clone(defaultVocabularyData);
  full.vocabulary_list.push({ group_id: 99, category: "我的分类", words: ["Custom Word"] });
  full.word_details["custom word"] = details();
  const missing = createCustomVocabularySnapshot(full, defaultVocabularyData);
  assert.equal(missing.errors[0].code, "MISSING_CUSTOM_CATEGORY_IDENTITY");
  const generated = createCustomVocabularySnapshot(full, defaultVocabularyData, {
    generateCategoryId: () => CATEGORY_A
  });
  assert.equal(generated.ok, true);
  assert.equal(generated.snapshot.categories[0].categoryId, CATEGORY_A);
});

test("official mutation detector rejects missing/renamed groups, missing/added relations, and details overrides", () => {
  const cases = [];
  const missingGroup = clone(defaultVocabularyData);
  missingGroup.vocabulary_list.shift();
  cases.push([missingGroup, "MISSING_OFFICIAL_GROUP"]);
  const renamed = clone(defaultVocabularyData);
  renamed.vocabulary_list[0].category = "被重命名";
  cases.push([renamed, "RENAMED_OFFICIAL_GROUP"]);
  const missingRelation = clone(defaultVocabularyData);
  missingRelation.vocabulary_list[0].words.shift();
  cases.push([missingRelation, "MISSING_OFFICIAL_RELATION"]);
  const addedRelation = clone(defaultVocabularyData);
  const officialFromOtherGroup = addedRelation.vocabulary_list[1].words[0];
  addedRelation.vocabulary_list[0].words.push(officialFromOtherGroup);
  cases.push([addedRelation, "ADDED_OFFICIAL_RELATION"]);
  const detailsOverride = clone(defaultVocabularyData);
  detailsOverride.word_details.idea.notes = "override";
  cases.push([detailsOverride, "OFFICIAL_DETAILS_OVERRIDE"]);
  const displayOverride = clone(defaultVocabularyData);
  displayOverride.vocabulary_list[0].words[0] = displayOverride.vocabulary_list[0].words[0].toUpperCase();
  cases.push([displayOverride, "OFFICIAL_WORD_REPRESENTATION_CHANGED"]);
  const metadataOverride = clone(defaultVocabularyData);
  metadataOverride.vocabulary_list[0].antonyms = ["changed"];
  cases.push([metadataOverride, "OFFICIAL_GROUP_METADATA_OVERRIDE"]);
  for (const [candidate, code] of cases) {
    const result = detectOfficialVocabularyMutations(candidate, defaultVocabularyData);
    assert.equal(result.errors.some((error) => error.code === code), true, code);
  }
});

test("custom additions to official groups are allowed and extracted", () => {
  const full = clone(defaultVocabularyData);
  full.vocabulary_list[0].words.push("Custom Word");
  full.word_details["custom word"] = details();
  assert.equal(detectOfficialVocabularyMutations(full, defaultVocabularyData).isValid, true);
  const result = createCustomVocabularySnapshot(full, defaultVocabularyData);
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.words[0].memberships, [{ kind: "system", groupId: 1 }]);
});

test("official word to custom category is explicitly rejected in schema v1", () => {
  const full = clone(defaultVocabularyData);
  full.vocabulary_list.push({ group_id: 99, category: "我的分类", words: ["idea"] });
  const result = createCustomVocabularySnapshot(full, defaultVocabularyData, {
    generateCategoryId: () => CATEGORY_A
  });
  assert.equal(result.errors.some(({ code }) => code === "SYSTEM_WORD_CUSTOM_CATEGORY_UNSUPPORTED"), true);
});

test("full official vocabulary is not accepted as a custom snapshot", () => {
  const result = validateCustomVocabularySnapshot(defaultVocabularyData, defaultVocabularyData);
  assert.equal(result.isValid, false);
});

test("learning load-order contract composes vocabulary before cloud learning normalization", () => {
  assert.deepEqual(CUSTOM_VOCABULARY_LOAD_ORDER, [
    "auth",
    "custom-vocabulary",
    "compose-vocabulary-index",
    "cloud-learning-state",
    "normalize-learning-state"
  ]);
});
