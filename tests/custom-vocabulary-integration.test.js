import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AUTH_STATUSES } from "../js/core/auth-service.js";
import {
  createCustomVocabularyIntegration,
  isActiveQuestionRenderable
} from "../js/core/custom-vocabulary-integration.js";
import {
  createCustomVocabularyRuntime,
  CUSTOM_VOCABULARY_CREATE_ACTIONS,
  CUSTOM_VOCABULARY_IDENTITY_STORAGE_KEY,
  CUSTOM_VOCABULARY_SOURCES,
  CUSTOM_VOCABULARY_SYNC_STATUSES
} from "../js/core/custom-vocabulary-runtime.js";
import {
  composeVocabulary,
  createEmptyCustomVocabularySnapshot
} from "../js/core/custom-vocabulary-snapshot.js";
import { createDefaultAppState, normalizeAppState } from "../js/core/storage.js";
import { addCategory } from "../js/core/vocabulary-category-service.js";
import { addVocabularyWord } from "../js/core/vocabulary-word-service.js";
import { validateVocabularyData } from "../js/core/vocabulary-validator.js";
import { defaultVocabularyData } from "../js/data/default-vocabulary.js";

const CATEGORY_A = "11111111-1111-4111-8111-111111111111";
const CATEGORY_B = "22222222-2222-4222-8222-222222222222";
const GUEST_KEY = "ielts_synonym_trainer_vocabulary";

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.writes = [];
  }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    this.values.set(key, value);
    this.writes.push({ key, value });
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function details(label) {
  return {
    phonetics: { uk: "", us: "" },
    meanings: [{ partOfSpeech: "n.", definitionZh: label }],
    collocations: [],
    examples: [],
    notes: "",
    source: "user",
    updatedAt: "2026-09-14T00:00:00Z"
  };
}

function snapshot(wordKey, { categoryId = null, category = "云端分类" } = {}) {
  return {
    schemaVersion: 1,
    categories: categoryId ? [{ categoryId, category }] : [],
    words: wordKey ? [{
      wordKey,
      displayText: wordKey,
      memberships: categoryId
        ? [{ kind: "custom", categoryId }]
        : [{ kind: "system", groupId: 1 }],
      details: details(wordKey)
    }] : []
  };
}

function fullVocabulary(customWord = null) {
  if (!customWord) return clone(defaultVocabularyData);
  return composeVocabulary(defaultVocabularyData, snapshot(customWord, {
    categoryId: CATEGORY_A,
    category: "访客分类"
  })).vocabulary;
}

function authenticated(userId) {
  return { status: AUTH_STATUSES.AUTHENTICATED, user: { id: userId, email: "hidden" } };
}

function guest() {
  return { status: AUTH_STATUSES.GUEST, user: null };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createCloud(rows = {}) {
  let activeUserId = null;
  const calls = { load: [], create: [], update: [] };
  let nextUpdateResult = null;
  let nextCreateResult = null;
  return {
    calls,
    rows,
    setActiveUser(userId) { activeUserId = userId; },
    setNextUpdate(result) { nextUpdateResult = result; },
    setNextCreate(result) { nextCreateResult = result; },
    async loadCustomVocabulary() {
      calls.load.push(activeUserId);
      const row = rows[activeUserId];
      return row
        ? { ok: true, status: "found", userId: activeUserId, ...clone(row) }
        : { ok: true, status: "not-found", userId: activeUserId };
    },
    async createCustomVocabulary(candidate, guard) {
      calls.create.push({ candidate: clone(candidate), guard: clone(guard), activeUserId });
      if (nextCreateResult) {
        const result = nextCreateResult;
        nextCreateResult = null;
        return result;
      }
      if (rows[activeUserId]) return { ok: false, status: "already-exists", userId: activeUserId };
      rows[activeUserId] = { snapshot: clone(candidate), revision: 1, updatedAt: null };
      return { ok: true, status: "created", userId: activeUserId, ...clone(rows[activeUserId]) };
    },
    async updateCustomVocabulary(candidate, guard) {
      calls.update.push({ candidate: clone(candidate), guard: clone(guard), activeUserId });
      if (nextUpdateResult) {
        const result = nextUpdateResult;
        nextUpdateResult = null;
        return result;
      }
      const row = rows[activeUserId];
      if (!row) return { ok: false, status: "not-found", userId: activeUserId };
      if (row.revision !== guard.expectedRevision) {
        return { ok: false, status: "conflict", userId: activeUserId, ...clone(row) };
      }
      rows[activeUserId] = {
        snapshot: clone(candidate),
        revision: row.revision + 1,
        updatedAt: null
      };
      return { ok: true, status: "updated", userId: activeUserId, ...clone(rows[activeUserId]) };
    }
  };
}

function createFixture({ guestWord = null, rows = {}, cloud = createCloud(rows), compatibility } = {}) {
  const storage = new MemoryStorage();
  let guestVocabulary = fullVocabulary(guestWord);
  let liveVocabulary = clone(guestVocabulary);
  let liveValidation = validateVocabularyData(liveVocabulary);
  const events = [];
  const learning = {
    calls: [],
    stateByUser: {},
    async handleAuthState(authState) {
      events.push("learning");
      this.calls.push(clone(authState));
      if (authState.status === AUTH_STATUSES.AUTHENTICATED) {
        const candidate = this.stateByUser[authState.user.id] ?? createDefaultAppState();
        this.normalized = normalizeAppState(candidate, {
          defaultState: createDefaultAppState(),
          validWordKeys: new Set(liveValidation.index.allWordKeys),
          validGroupIds: new Set(liveValidation.index.groupById.keys()),
          correctGroupIdsByWordKey: liveValidation.index.groupIdsByWordKey
        });
      }
      return {};
    }
  };
  const guestRepository = {
    getCurrentVocabulary: () => clone(guestVocabulary),
    getOfficialCompatibility: () => compatibility ?? { status: "clean", errors: [] }
  };
  const runtime = createCustomVocabularyRuntime({
    guestVocabularyRepository: guestRepository,
    cloudRepository: cloud,
    identityStorage: storage,
    officialBaseline: defaultVocabularyData,
    randomUUID: () => CATEGORY_A
  });
  const integration = createCustomVocabularyIntegration({
    customRuntime: runtime,
    learningRuntime: learning,
    officialBaseline: defaultVocabularyData,
    getGuestVocabulary: () => clone(guestVocabulary),
    saveGuestVocabulary(candidate) {
      guestVocabulary = clone(candidate);
      storage.setItem(GUEST_KEY, JSON.stringify(candidate));
      return clone(guestVocabulary);
    },
    activateVocabulary(vocabulary, context) {
      events.push(`vocabulary:${context.reason}`);
      liveVocabulary = clone(vocabulary);
      liveValidation = validateVocabularyData(liveVocabulary);
    },
    holdLearningSurface: () => events.push("hold"),
    onVocabularyReady: ({ reason }) => events.push(`ready:${reason ?? "guest"}`),
    randomUUID: () => CATEGORY_B
  });
  return {
    cloud,
    events,
    integration,
    learning,
    runtime,
    storage,
    getGuestVocabulary: () => clone(guestVocabulary),
    getLiveVocabulary: () => clone(liveVocabulary),
    getLiveIndex: () => liveValidation.index
  };
}

test("no-session startup stays Guest and does not touch Cloud", async () => {
  const fixture = createFixture({ guestWord: "guest phrase" });
  await fixture.integration.handleAuthState(guest());
  assert.equal(fixture.runtime.getStatus().source, CUSTOM_VOCABULARY_SOURCES.GUEST_LOCAL);
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("guest phrase"), true);
  assert.equal(fixture.cloud.calls.load.length, 0);
  assert.deepEqual(fixture.events.slice(-2), ["learning", "ready:guest"]);
});

test("persisted account resolves Custom vocabulary before Learning normalization", async () => {
  const cloudWord = "my custom phrase";
  const fixture = createFixture({
    guestWord: "guest only",
    rows: { a: { snapshot: snapshot(cloudWord), revision: 4, updatedAt: null } }
  });
  fixture.cloud.setActiveUser("a");
  const learningState = createDefaultAppState();
  learningState.learning.byWordKey[cloudWord] = { status: "remembered", answerCount: 2 };
  learningState.learning.byWordKey["definitely-not-in-vocabulary"] = { status: "review", answerCount: 1 };
  fixture.learning.stateByUser.a = learningState;

  await fixture.integration.handleAuthState(authenticated("a"));
  const cloudActivation = fixture.events.indexOf("vocabulary:cloud-load");
  const learningLoad = fixture.events.indexOf("learning");
  assert.equal(cloudActivation < learningLoad, true);
  assert.equal(fixture.getLiveIndex().displayByWordKey.has(cloudWord), true);
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("guest only"), false);
  assert.equal(cloudWord in fixture.learning.normalized.learning.byWordKey, true);
  assert.equal("definitely-not-in-vocabulary" in fixture.learning.normalized.learning.byWordKey, false);
});

test("Custom load error without userId blocks Learning and leaves unavailable status", async () => {
  const cloud = createCloud();
  cloud.loadCustomVocabulary = async () => ({ ok: false, status: "error" });
  const fixture = createFixture({ cloud });
  cloud.setActiveUser("a");

  const result = await fixture.integration.handleAuthState(authenticated("a"));

  assert.equal(result.status, "blocked");
  assert.equal(fixture.runtime.getStatus().source, CUSTOM_VOCABULARY_SOURCES.UNAVAILABLE);
  assert.equal(fixture.runtime.getStatus().syncStatus, CUSTOM_VOCABULARY_SYNC_STATUSES.UNAVAILABLE);
  assert.equal(fixture.learning.calls.length, 0);
  assert.equal(fixture.events.includes("learning"), false);
});

test("meaningful Guest pauses Learning until explicit Save to Account", async () => {
  const fixture = createFixture({ guestWord: "guest phrase" });
  fixture.cloud.setActiveUser("a");
  const pending = await fixture.integration.handleAuthState(authenticated("a"));
  assert.equal(pending.status, "pending-migration");
  assert.equal(fixture.learning.calls.length, 0);
  assert.equal(fixture.cloud.calls.create.length, 0);

  await fixture.integration.completeMigration(CUSTOM_VOCABULARY_CREATE_ACTIONS.SAVE_GUEST);
  assert.equal(fixture.runtime.getStatus().source, CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD);
  assert.equal(fixture.cloud.calls.create[0].candidate.words[0].wordKey, "guest phrase");
  assert.equal(fixture.learning.calls.length, 1);
  assert.equal(fixture.getGuestVocabulary().word_details["guest phrase"].source, "user");
});

test("Start Empty creates Official-only account vocabulary while preserving Guest", async () => {
  const fixture = createFixture({ guestWord: "guest phrase" });
  fixture.cloud.setActiveUser("a");
  await fixture.integration.handleAuthState(authenticated("a"));
  await fixture.integration.completeMigration(CUSTOM_VOCABULARY_CREATE_ACTIONS.START_EMPTY);
  assert.deepEqual(fixture.cloud.calls.create[0].candidate, createEmptyCustomVocabularySnapshot());
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("guest phrase"), false);
  assert.equal(fixture.getGuestVocabulary().word_details["guest phrase"].source, "user");
});

test("empty Guest auto-creates an empty Cloud row without showing a choice", async () => {
  const fixture = createFixture();
  fixture.cloud.setActiveUser("a");
  const result = await fixture.integration.handleAuthState(authenticated("a"));
  assert.equal(result.status, "ready");
  assert.equal(fixture.cloud.calls.create.length, 1);
  assert.deepEqual(fixture.cloud.calls.create[0].candidate, createEmptyCustomVocabularySnapshot());
  assert.equal(fixture.learning.calls.length, 1);
});

test("legacy-incompatible Guest blocks upload but still permits Start Empty", async () => {
  const guestVocabulary = fullVocabulary("guest phrase");
  guestVocabulary.vocabulary_list[0].category = "legacy rename";
  const fixture = createFixture({
    guestWord: "guest phrase",
    compatibility: { status: "legacy-incompatible", errors: [{ code: "RENAMED_OFFICIAL_GROUP" }] }
  });
  fixture.cloud.setActiveUser("a");
  await fixture.integration.handleAuthState(authenticated("a"));
  assert.equal(fixture.runtime.getStatus().migrationKind, "guest-snapshot-unavailable");
  assert.equal((await fixture.integration.completeMigration(CUSTOM_VOCABULARY_CREATE_ACTIONS.SAVE_GUEST)).status, "guest-snapshot-unavailable");
  await fixture.integration.completeMigration(CUSTOM_VOCABULARY_CREATE_ACTIONS.START_EMPTY);
  assert.deepEqual(fixture.cloud.calls.create[0].candidate, createEmptyCustomVocabularySnapshot());
});

test("already-exists race loads the remote winner and never updates it", async () => {
  const cloud = createCloud();
  const fixture = createFixture({ guestWord: "guest phrase", cloud });
  cloud.setActiveUser("a");
  await fixture.integration.handleAuthState(authenticated("a"));
  cloud.rows.a = { snapshot: snapshot("remote winner"), revision: 8, updatedAt: null };
  await fixture.integration.completeMigration(CUSTOM_VOCABULARY_CREATE_ACTIONS.SAVE_GUEST);
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("remote winner"), true);
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("guest phrase"), false);
  assert.equal(cloud.calls.update.length, 0);
});

test("logout restores exact Guest vocabulary and A/B account vocabularies stay isolated", async () => {
  const fixture = createFixture({
    guestWord: "guest local",
    rows: {
      a: { snapshot: snapshot("account a"), revision: 1, updatedAt: null },
      b: { snapshot: snapshot("account b"), revision: 1, updatedAt: null }
    }
  });
  for (const [userId, expected, absent] of [["a", "account a", "account b"], ["b", "account b", "account a"]]) {
    fixture.cloud.setActiveUser(userId);
    await fixture.integration.handleAuthState(authenticated(userId));
    assert.equal(fixture.getLiveIndex().displayByWordKey.has(expected), true);
    assert.equal(fixture.getLiveIndex().displayByWordKey.has(absent), false);
    assert.equal(fixture.getLiveIndex().displayByWordKey.has("guest local"), false);
    fixture.cloud.setActiveUser(null);
    await fixture.integration.handleAuthState(guest());
    assert.equal(fixture.getLiveIndex().displayByWordKey.has("guest local"), true);
    assert.equal(fixture.getLiveIndex().displayByWordKey.has(expected), false);
  }
});

test("Cloud category identities never replace preserved Guest identity metadata", async () => {
  const fixture = createFixture({
    guestWord: "guest local",
    rows: {
      a: {
        snapshot: snapshot("account a", { categoryId: CATEGORY_B, category: "账号分类" }),
        revision: 1,
        updatedAt: null
      }
    }
  });
  fixture.cloud.setActiveUser("a");
  await fixture.integration.handleAuthState(authenticated("a"));
  const guestMetadataBeforeLogout = fixture.storage.getItem(CUSTOM_VOCABULARY_IDENTITY_STORAGE_KEY);
  assert.ok(guestMetadataBeforeLogout);
  assert.doesNotMatch(guestMetadataBeforeLogout, new RegExp(CATEGORY_B));

  fixture.cloud.setActiveUser(null);
  await fixture.integration.handleAuthState(guest());
  assert.equal(
    fixture.storage.getItem(CUSTOM_VOCABULARY_IDENTITY_STORAGE_KEY),
    guestMetadataBeforeLogout
  );
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("guest local"), true);
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("account a"), false);
});

test("stale A Custom response cannot activate after B login", async () => {
  const a = deferred();
  const b = deferred();
  let activeUser = "a";
  const cloud = createCloud();
  cloud.loadCustomVocabulary = async () => activeUser === "a" ? a.promise : b.promise;
  const fixture = createFixture({ cloud });
  cloud.setActiveUser("a");
  const aLogin = fixture.integration.handleAuthState(authenticated("a"));
  activeUser = "b";
  cloud.setActiveUser("b");
  const bLogin = fixture.integration.handleAuthState(authenticated("b"));
  a.resolve({ ok: true, status: "found", userId: "a", snapshot: snapshot("late a"), revision: 1 });
  assert.equal((await aLogin).status, "stale");
  b.resolve({ ok: true, status: "found", userId: "b", snapshot: snapshot("b current"), revision: 1 });
  await bLogin;
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("late a"), false);
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("b current"), true);
});

test("account Manager mutation writes custom-only payload with OCC and never Guest storage", async () => {
  const cloud = createCloud({
    a: { snapshot: snapshot("account word", { categoryId: CATEGORY_A }), revision: 4, updatedAt: null }
  });
  const fixture = createFixture({ guestWord: "guest local", cloud });
  cloud.setActiveUser("a");
  await fixture.integration.handleAuthState(authenticated("a"));
  fixture.storage.writes.length = 0;
  let candidate = addCategory(fixture.getLiveVocabulary(), "新增账号分类").vocabulary;
  const newGroupId = candidate.vocabulary_list.at(-1).group_id;
  candidate = addVocabularyWord(candidate, "new account word", [newGroupId]).vocabulary;
  const saved = fixture.integration.saveVocabularyCandidate(candidate);
  const result = await saved.savePromise;
  assert.equal(result.status, "updated");
  assert.deepEqual(cloud.calls.update[0].guard, { expectedUserId: "a", expectedRevision: 4 });
  assert.equal(fixture.runtime.getStatus().cloudRevision, 5);
  assert.equal(cloud.calls.update[0].candidate.words.some(({ wordKey }) => wordKey === "new account word"), true);
  assert.equal(cloud.calls.update[0].candidate.words.some(({ wordKey }) => wordKey === "idea"), false);
  assert.equal(fixture.storage.writes.some(({ key }) => key === GUEST_KEY), false);
});

test("account mutation conflict keeps memory, blocks writes, and explicit reload uses remote", async () => {
  const cloud = createCloud({
    a: { snapshot: snapshot("initial cloud"), revision: 4, updatedAt: null }
  });
  const fixture = createFixture({ guestWord: "guest local", cloud });
  cloud.setActiveUser("a");
  await fixture.integration.handleAuthState(authenticated("a"));
  cloud.rows.a = { snapshot: snapshot("remote newer"), revision: 5, updatedAt: null };
  const candidate = addVocabularyWord(fixture.getLiveVocabulary(), "local pending", [1]).vocabulary;
  await fixture.integration.saveVocabularyCandidate(candidate).savePromise;
  assert.equal(fixture.runtime.getStatus().source, CUSTOM_VOCABULARY_SOURCES.CONFLICT);
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("local pending"), true);
  assert.equal(fixture.integration.saveVocabularyCandidate(candidate).status, "conflict");
  assert.equal(cloud.calls.update.length, 1);
  await fixture.integration.reloadAfterConflict();
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("remote newer"), true);
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("local pending"), false);
  assert.equal(fixture.storage.writes.some(({ key }) => key === GUEST_KEY), false);
});

test("active-question render safety rejects removed references and preserves valid questions", () => {
  const index = validateVocabularyData(fullVocabulary("custom active")).index;
  const validQuestion = {
    wordKey: "custom active",
    optionGroupIds: [1, 2],
    correctGroupIds: [1],
    selectedGroupIds: [2]
  };
  assert.equal(isActiveQuestionRenderable(validQuestion, index), true);

  const withoutCustom = validateVocabularyData(fullVocabulary()).index;
  assert.equal(isActiveQuestionRenderable(validQuestion, withoutCustom), false);
  assert.equal(isActiveQuestionRenderable({
    ...validQuestion,
    wordKey: "idea",
    optionGroupIds: [1, 999999],
    correctGroupIds: [1],
    selectedGroupIds: []
  }, withoutCustom), false);
});

test("conflict reload repairs only transient activeQuestion without Learning persistence", async () => {
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  const handler = app.match(/function handleVocabularyOwnershipReady\(context\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(handler, /isActiveQuestionRenderable\(activeQuestion, report\.index\)/);
  assert.match(handler, /replaceActiveQuestion\(activeQuestion\?\.wordKey \?\? null, \{\s*persist: false,\s*recordRoundEntry: false/);
  assert.doesNotMatch(handler, /persistState|learningStateRuntime|normalizeAppState/);
});

test("network save failure keeps account memory and never falls back to Guest", async () => {
  const cloud = createCloud({ a: { snapshot: snapshot("cloud word"), revision: 1, updatedAt: null } });
  const fixture = createFixture({ guestWord: "guest word", cloud });
  cloud.setActiveUser("a");
  await fixture.integration.handleAuthState(authenticated("a"));
  cloud.setNextUpdate({ ok: false, status: "error", userId: "a" });
  const candidate = addVocabularyWord(fixture.getLiveVocabulary(), "unsaved word", [1]).vocabulary;
  await fixture.integration.saveVocabularyCandidate(candidate).savePromise;
  assert.equal(fixture.runtime.getStatus().source, CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD);
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("unsaved word"), true);
  assert.equal(fixture.getLiveIndex().displayByWordKey.has("guest word"), false);
});
