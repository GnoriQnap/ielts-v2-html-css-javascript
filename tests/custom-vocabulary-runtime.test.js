import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { defaultVocabularyData } from "../js/data/default-vocabulary.js";
import {
  CUSTOM_VOCABULARY_IDENTITY_STORAGE_KEY,
  CUSTOM_VOCABULARY_MIGRATION_KINDS,
  CUSTOM_VOCABULARY_SOURCES,
  CUSTOM_VOCABULARY_SYNC_STATUSES,
  createCustomVocabularyRuntime,
  createGuestCustomVocabularySnapshot,
  hasMeaningfulCustomVocabulary
} from "../js/core/custom-vocabulary-runtime.js";
import { createEmptyCustomVocabularySnapshot } from "../js/core/custom-vocabulary-snapshot.js";

const CATEGORY_A = "11111111-1111-4111-8111-111111111111";
const CATEGORY_B = "22222222-2222-4222-8222-222222222222";
const CATEGORY_C = "33333333-3333-4333-8333-333333333333";
const GUEST_VOCABULARY_KEY = "ielts_synonym_trainer_vocabulary";
const LEARNING_KEY = "ielts_synonym_trainer_state";

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.writes = [];
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.writes.push({ key, value });
    this.values.set(key, value);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function customDetails(label = "自定义") {
  return {
    phonetics: { uk: "", us: "" },
    meanings: [{ partOfSpeech: "n.", definitionZh: label }],
    collocations: [],
    examples: [],
    notes: "",
    source: "user",
    updatedAt: "2026-09-13T00:00:00Z"
  };
}

function customSnapshot(wordKey = "cloud word") {
  return {
    schemaVersion: 1,
    categories: [],
    words: [{
      wordKey,
      displayText: wordKey,
      memberships: [{ kind: "system", groupId: 1 }],
      details: customDetails(wordKey)
    }]
  };
}

function guestVocabulary({ categories = 1, word = "Guest Word" } = {}) {
  const vocabulary = clone(defaultVocabularyData);
  for (let index = 0; index < categories; index += 1) {
    vocabulary.vocabulary_list.push({
      group_id: 99 + index,
      category: `自定义分类 ${index + 1}`,
      words: index === 0 && word ? [word] : []
    });
  }
  if (word) vocabulary.word_details[word.toLowerCase()] = customDetails(word);
  return vocabulary;
}

function createGuestRepository(vocabulary = defaultVocabularyData, compatibility = { status: "clean", errors: [] }) {
  return {
    getCurrentVocabulary: () => clone(vocabulary),
    getOfficialCompatibility: () => clone(compatibility)
  };
}

function createCloudRepository(overrides = {}) {
  const calls = { load: 0, create: [], update: [] };
  return {
    calls,
    async loadCustomVocabulary() {
      calls.load += 1;
      return overrides.load?.(calls.load) ?? { ok: true, status: "not-found", userId: "user-a" };
    },
    async createCustomVocabulary(snapshot, guard) {
      calls.create.push({ snapshot: clone(snapshot), guard: clone(guard) });
      return overrides.create?.(snapshot, guard) ?? {
        ok: true,
        status: "created",
        userId: guard.expectedUserId,
        snapshot: clone(snapshot),
        revision: 1,
        updatedAt: null
      };
    },
    async updateCustomVocabulary(snapshot, guard) {
      calls.update.push({ snapshot: clone(snapshot), guard: clone(guard) });
      return overrides.update?.(snapshot, guard) ?? {
        ok: true,
        status: "updated",
        userId: guard.expectedUserId,
        snapshot: clone(snapshot),
        revision: guard.expectedRevision + 1,
        updatedAt: null
      };
    }
  };
}

function createRuntime({
  vocabulary = defaultVocabularyData,
  compatibility,
  cloud = createCloudRepository(),
  storage = new MemoryStorage(),
  uuids = [CATEGORY_A, CATEGORY_B, CATEGORY_C],
  onStatusChange
} = {}) {
  let uuidIndex = 0;
  const runtime = createCustomVocabularyRuntime({
    guestVocabularyRepository: createGuestRepository(vocabulary, compatibility),
    cloudRepository: cloud,
    identityStorage: storage,
    randomUUID: () => uuids[uuidIndex++],
    onStatusChange
  });
  return { runtime, cloud, storage };
}

function found(userId, snapshot = customSnapshot(), revision = 3) {
  return { ok: true, status: "found", userId, snapshot, revision, updatedAt: null };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("Guest initializes guest-local and official-only data produces an empty, non-meaningful snapshot", () => {
  const { runtime, storage } = createRuntime();
  const result = runtime.initializeForGuest();
  assert.equal(result.source, CUSTOM_VOCABULARY_SOURCES.GUEST_LOCAL);
  assert.equal(result.syncStatus, CUSTOM_VOCABULARY_SYNC_STATUSES.GUEST);
  assert.deepEqual(runtime.getSnapshot(), createEmptyCustomVocabularySnapshot());
  assert.equal(hasMeaningfulCustomVocabulary(runtime.getSnapshot()), false);
  assert.deepEqual(storage.writes, []);
});

test("Guest custom words/categories are meaningful and a stable UUID is reused across reload and rename", () => {
  const storage = new MemoryStorage();
  const firstVocabulary = guestVocabulary();
  const first = createGuestCustomVocabularySnapshot({
    fullVocabulary: firstVocabulary,
    officialBaseline: defaultVocabularyData,
    storage,
    randomUUID: () => CATEGORY_A
  });
  assert.equal(first.ok, true);
  assert.equal(first.meaningful, true);
  assert.equal(first.metadataStatus, "initialized");
  assert.equal(first.snapshot.categories[0].categoryId, CATEGORY_A);

  const renamed = clone(firstVocabulary);
  renamed.vocabulary_list.at(-1).category = "重命名分类";
  const second = createGuestCustomVocabularySnapshot({
    fullVocabulary: renamed,
    officialBaseline: defaultVocabularyData,
    storage,
    randomUUID: () => CATEGORY_B
  });
  assert.equal(second.snapshot.categories[0].categoryId, CATEGORY_A);
  assert.equal(second.snapshot.categories[0].category, "重命名分类");
  assert.equal(second.metadataStatus, "unchanged");
});

test("identity metadata cleans deleted categories without retaining orphan group IDs", () => {
  const storage = new MemoryStorage({
    [CUSTOM_VOCABULARY_IDENTITY_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      customCategoryIdByGroupId: { 99: CATEGORY_A, 100: CATEGORY_B }
    })
  });
  const result = createGuestCustomVocabularySnapshot({
    fullVocabulary: guestVocabulary({ categories: 1 }),
    officialBaseline: defaultVocabularyData,
    storage,
    randomUUID: () => CATEGORY_C
  });
  assert.equal(result.ok, true);
  assert.equal(result.metadataStatus, "cleaned");
  assert.deepEqual(result.identityMetadata.customCategoryIdByGroupId, { 99: CATEGORY_A });
});

test("malformed, duplicate, dangerous, and official-group metadata is rebuilt safely", () => {
  const cases = [
    "{broken",
    JSON.stringify({ schemaVersion: 9, customCategoryIdByGroupId: {} }),
    JSON.stringify({ schemaVersion: 1, customCategoryIdByGroupId: { 1: CATEGORY_A, 99: CATEGORY_A, 100: CATEGORY_A } }),
    '{"schemaVersion":1,"customCategoryIdByGroupId":{"__proto__":"11111111-1111-4111-8111-111111111111"}}'
  ];
  for (const serialized of cases) {
    const storage = new MemoryStorage({ [CUSTOM_VOCABULARY_IDENTITY_STORAGE_KEY]: serialized });
    const ids = [CATEGORY_B, CATEGORY_C];
    const result = createGuestCustomVocabularySnapshot({
      fullVocabulary: guestVocabulary({ categories: 2 }),
      officialBaseline: defaultVocabularyData,
      storage,
      randomUUID: () => ids.shift()
    });
    assert.equal(result.ok, true);
    assert.equal(result.metadataStatus, "identity-rebuilt");
    assert.equal(new Set(Object.values(result.identityMetadata.customCategoryIdByGroupId)).size, 2);
    assert.equal("1" in result.identityMetadata.customCategoryIdByGroupId, false);
  }
});

test("identity generator/storage failures are structured and never crash Guest initialization", () => {
  const noGenerator = createGuestCustomVocabularySnapshot({
    fullVocabulary: guestVocabulary(),
    officialBaseline: defaultVocabularyData,
    storage: new MemoryStorage(),
    randomUUID: null
  });
  assert.equal(noGenerator.status, "identity-generation-unavailable");

  const unavailableStorage = {
    getItem: () => null,
    setItem: () => { throw new Error("quota detail"); }
  };
  const noStorage = createGuestCustomVocabularySnapshot({
    fullVocabulary: guestVocabulary(),
    officialBaseline: defaultVocabularyData,
    storage: unavailableStorage,
    randomUUID: () => CATEGORY_A
  });
  assert.equal(noStorage.status, "identity-storage-unavailable");
});

test("legacy-incompatible Guest vocabulary is reported unavailable and never rewritten", () => {
  const vocabulary = clone(defaultVocabularyData);
  vocabulary.vocabulary_list[0].category = "非法改名";
  const storage = new MemoryStorage();
  const { runtime } = createRuntime({
    vocabulary,
    compatibility: { status: "legacy-incompatible", errors: [{ code: "RENAMED_OFFICIAL_GROUP" }] },
    storage
  });
  const result = runtime.initializeForGuest();
  assert.equal(result.source, CUSTOM_VOCABULARY_SOURCES.GUEST_LOCAL);
  assert.equal(result.syncStatus, CUSTOM_VOCABULARY_SYNC_STATUSES.GUEST_SNAPSHOT_UNAVAILABLE);
  assert.equal(runtime.getSnapshot(), null);
  assert.equal(storage.writes.length, 0);
});

test("Cloud found activates authenticated ownership; not-found produces explicit meaningful/empty migration kinds", async () => {
  for (const [vocabulary, expectedKind] of [
    [guestVocabulary(), CUSTOM_VOCABULARY_MIGRATION_KINDS.MEANINGFUL_GUEST],
    [defaultVocabularyData, CUSTOM_VOCABULARY_MIGRATION_KINDS.EMPTY_GUEST]
  ]) {
    const cloud = createCloudRepository();
    const { runtime } = createRuntime({ vocabulary, cloud });
    const pending = await runtime.initializeForAuthenticatedUser("user-a");
    assert.equal(pending.source, CUSTOM_VOCABULARY_SOURCES.PENDING_MIGRATION);
    assert.equal(pending.migrationKind, expectedKind);
    assert.equal(cloud.calls.create.length, 0);
    assert.equal(cloud.calls.update.length, 0);
  }

  const cloud = createCloudRepository({ load: () => found("user-a", customSnapshot("a cloud"), 7) });
  const { runtime } = createRuntime({ vocabulary: guestVocabulary(), cloud });
  await runtime.initializeForAuthenticatedUser("user-a");
  assert.equal(runtime.getStatus().source, CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD);
  assert.equal(runtime.getStatus().cloudRevision, 7);
  assert.equal(runtime.getSnapshot().words[0].wordKey, "a cloud");
});

test("invalid Cloud data becomes unavailable without replacing or uploading Guest", async () => {
  const cloud = createCloudRepository({
    load: () => ({ ok: false, status: "invalid-remote-data", userId: "user-a" })
  });
  const { runtime } = createRuntime({ vocabulary: guestVocabulary(), cloud });
  await runtime.initializeForAuthenticatedUser("user-a");
  assert.equal(runtime.getStatus().source, CUSTOM_VOCABULARY_SOURCES.UNAVAILABLE);
  assert.equal(runtime.getSnapshot(), null);
  assert.equal(cloud.calls.create.length, 0);
  assert.equal(cloud.calls.update.length, 0);
});

test("A snapshot cannot leak while B loads and stale A completion is ignored", async () => {
  const loadA = deferred();
  const loadB = deferred();
  const cloud = createCloudRepository({ load: (count) => count === 1 ? loadA.promise : loadB.promise });
  const { runtime } = createRuntime({ cloud });
  const aInitialization = runtime.initializeForAuthenticatedUser("user-a");
  const bInitialization = runtime.initializeForAuthenticatedUser("user-b");
  assert.equal(runtime.getSnapshot(), null);
  loadA.resolve(found("user-a", customSnapshot("a word"), 2));
  assert.equal((await aInitialization).status, "stale");
  assert.equal(runtime.getSnapshot(), null);
  loadB.resolve(found("user-b", customSnapshot("b word"), 5));
  await bInitialization;
  assert.equal(runtime.getStatus().userId, "user-b");
  assert.equal(runtime.getSnapshot().words[0].wordKey, "b word");
});

test("logout invalidates delayed auth work and restores Guest ownership without cache writes", async () => {
  const pending = deferred();
  const storage = new MemoryStorage({ [GUEST_VOCABULARY_KEY]: "guest-cache" });
  const cloud = createCloudRepository({ load: () => pending.promise });
  const { runtime } = createRuntime({ vocabulary: guestVocabulary(), cloud, storage });
  const initialization = runtime.initializeForAuthenticatedUser("user-a");
  runtime.switchToGuest();
  pending.resolve(found("user-a", customSnapshot("late a"), 2));
  assert.equal((await initialization).status, "stale");
  assert.equal(runtime.getStatus().source, CUSTOM_VOCABULARY_SOURCES.GUEST_LOCAL);
  assert.equal(runtime.getStatus().userId, null);
  assert.equal(storage.getItem(GUEST_VOCABULARY_KEY), "guest-cache");
  assert.equal(runtime.getSnapshot().words[0].wordKey, "guest word");
});

test("explicit Save Guest creates exactly the Guest snapshot at revision 1", async () => {
  const cloud = createCloudRepository();
  const storage = new MemoryStorage({ [GUEST_VOCABULARY_KEY]: "keep" });
  const { runtime } = createRuntime({ vocabulary: guestVocabulary(), cloud, storage });
  await runtime.initializeForAuthenticatedUser("user-a");
  const result = await runtime.saveGuestToAccount();
  assert.equal(result.status, "created");
  assert.equal(runtime.getStatus().source, CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD);
  assert.equal(runtime.getStatus().cloudRevision, 1);
  assert.equal(cloud.calls.create.length, 1);
  assert.equal(cloud.calls.create[0].snapshot.words[0].wordKey, "guest word");
  assert.equal(storage.getItem(GUEST_VOCABULARY_KEY), "keep");
});

test("explicit Start Empty creates an empty row and never uploads meaningful Guest data", async () => {
  const cloud = createCloudRepository();
  const { runtime } = createRuntime({ vocabulary: guestVocabulary(), cloud });
  await runtime.initializeForAuthenticatedUser("user-a");
  await runtime.startEmptyCloudVocabulary();
  assert.deepEqual(cloud.calls.create[0].snapshot, createEmptyCustomVocabularySnapshot());
  assert.deepEqual(runtime.getSnapshot(), createEmptyCustomVocabularySnapshot());
});

test("double create is deduplicated and logout invalidates its delayed result", async () => {
  const create = deferred();
  const cloud = createCloudRepository({ create: () => create.promise });
  const { runtime } = createRuntime({ vocabulary: guestVocabulary(), cloud });
  await runtime.initializeForAuthenticatedUser("user-a");
  const first = runtime.saveGuestToAccount();
  const second = runtime.saveGuestToAccount();
  assert.equal(first, second);
  assert.equal(cloud.calls.create.length, 1);
  runtime.switchToGuest();
  create.resolve(found("user-a", customSnapshot("late create"), 1));
  assert.equal((await first).status, "stale");
  assert.equal(runtime.getStatus().source, CUSTOM_VOCABULARY_SOURCES.GUEST_LOCAL);
  assert.equal(runtime.getSnapshot().words[0].wordKey, "guest word");
});

test("already-exists reloads remote without merge or overwrite", async () => {
  const cloud = createCloudRepository({
    load: (count) => count === 1
      ? { ok: true, status: "not-found", userId: "user-a" }
      : found("user-a", customSnapshot("remote winner"), 9),
    create: () => ({ ok: false, status: "already-exists", userId: "user-a" })
  });
  const { runtime } = createRuntime({ vocabulary: guestVocabulary(), cloud });
  await runtime.initializeForAuthenticatedUser("user-a");
  await runtime.saveGuestToAccount();
  assert.equal(runtime.getSnapshot().words[0].wordKey, "remote winner");
  assert.equal(runtime.getStatus().cloudRevision, 9);
  assert.equal(cloud.calls.create.length, 1);
  assert.equal(cloud.calls.update.length, 0);
});

test("already-exists reload failure becomes unavailable rather than overwriting remote", async () => {
  const cloud = createCloudRepository({
    load: (count) => count === 1
      ? { ok: true, status: "not-found", userId: "user-a" }
      : { ok: false, status: "error", userId: "user-a" },
    create: () => ({ ok: false, status: "already-exists", userId: "user-a" })
  });
  const { runtime } = createRuntime({ cloud });
  await runtime.initializeForAuthenticatedUser("user-a");
  await runtime.startEmptyCloudVocabulary();
  assert.equal(runtime.getStatus().source, CUSTOM_VOCABULARY_SOURCES.UNAVAILABLE);
  assert.equal(cloud.calls.update.length, 0);
});

test("authenticated update owns revision and passes identity/OCC guards", async () => {
  const cloud = createCloudRepository({ load: () => found("user-a", customSnapshot(), 4) });
  const { runtime } = createRuntime({ cloud });
  await runtime.initializeForAuthenticatedUser("user-a");
  await runtime.updateCloudSnapshot(customSnapshot("updated word"));
  assert.deepEqual(cloud.calls.update[0].guard, { expectedUserId: "user-a", expectedRevision: 4 });
  assert.equal(runtime.getStatus().cloudRevision, 5);
  assert.equal(runtime.getSnapshot().words[0].wordKey, "updated word");
});

test("an A update resolving after account switch cannot alter B ownership", async () => {
  const update = deferred();
  let loadingUser = "user-a";
  const cloud = createCloudRepository({
    load: () => found(loadingUser, customSnapshot(`${loadingUser} word`), 1),
    update: () => update.promise
  });
  const { runtime } = createRuntime({ cloud });
  await runtime.initializeForAuthenticatedUser("user-a");
  const oldUpdate = runtime.updateCloudSnapshot(customSnapshot("a pending"));
  loadingUser = "user-b";
  await runtime.initializeForAuthenticatedUser("user-b");
  update.resolve({
    ok: true,
    status: "updated",
    userId: "user-a",
    snapshot: customSnapshot("late a result"),
    revision: 2,
    updatedAt: null
  });
  assert.equal((await oldUpdate).status, "stale");
  assert.equal(runtime.getStatus().userId, "user-b");
  assert.equal(runtime.getSnapshot().words[0].wordKey, "user-b word");
});

test("OCC conflict preserves local candidate, records remote, and blocks subsequent writes", async () => {
  const remote = customSnapshot("remote word");
  const cloud = createCloudRepository({
    load: () => found("user-a", customSnapshot(), 4),
    update: () => ({
      ok: false,
      status: "conflict",
      userId: "user-a",
      snapshot: remote,
      revision: 5,
      updatedAt: "2026-09-13T01:00:00Z"
    })
  });
  const { runtime } = createRuntime({ cloud });
  await runtime.initializeForAuthenticatedUser("user-a");
  await runtime.updateCloudSnapshot(customSnapshot("local pending"));
  assert.equal(runtime.getStatus().source, CUSTOM_VOCABULARY_SOURCES.CONFLICT);
  assert.equal(runtime.getStatus().syncStatus, CUSTOM_VOCABULARY_SYNC_STATUSES.CONFLICT);
  assert.equal(runtime.getSnapshot().words[0].wordKey, "local pending");
  assert.equal(runtime.getRemoteConflict().snapshot.words[0].wordKey, "remote word");
  assert.equal((await runtime.updateCloudSnapshot(customSnapshot("blocked"))).status, "conflict-blocked");
  assert.equal(cloud.calls.update.length, 1);
});

test("explicit conflict reload accepts current remote snapshot and revision", async () => {
  let loadCount = 0;
  const cloud = createCloudRepository({
    load: () => {
      loadCount += 1;
      return found("user-a", customSnapshot(loadCount === 1 ? "initial custom" : "latest remote"), loadCount === 1 ? 2 : 7);
    },
    update: () => ({
      ok: false,
      status: "conflict",
      userId: "user-a",
      snapshot: customSnapshot("remote conflict"),
      revision: 6,
      updatedAt: null
    })
  });
  const { runtime } = createRuntime({ cloud });
  await runtime.initializeForAuthenticatedUser("user-a");
  await runtime.updateCloudSnapshot(customSnapshot("local"));
  await runtime.reloadCloudCustomVocabularyAfterConflict();
  assert.equal(runtime.getStatus().source, CUSTOM_VOCABULARY_SOURCES.AUTHENTICATED_CLOUD);
  assert.equal(runtime.getStatus().syncStatus, CUSTOM_VOCABULARY_SYNC_STATUSES.CONNECTED);
  assert.equal(runtime.getStatus().cloudRevision, 7);
  assert.equal(runtime.getSnapshot().words[0].wordKey, "latest remote");
});

test("Cloud operations never write Guest vocabulary or Learning storage", async () => {
  const storage = new MemoryStorage({
    [GUEST_VOCABULARY_KEY]: "guest-stays",
    [LEARNING_KEY]: "learning-stays"
  });
  const cloud = createCloudRepository({ load: () => found("user-a", customSnapshot(), 1) });
  const { runtime } = createRuntime({ cloud, storage });
  await runtime.initializeForAuthenticatedUser("user-a");
  storage.writes.length = 0;
  await runtime.updateCloudSnapshot(customSnapshot("changed"));
  assert.equal(storage.getItem(GUEST_VOCABULARY_KEY), "guest-stays");
  assert.equal(storage.getItem(LEARNING_KEY), "learning-stays");
  assert.deepEqual(storage.writes, []);
});

test("status and snapshots are clone-safe read-only views", async () => {
  const { runtime } = createRuntime({
    cloud: createCloudRepository({ load: () => found("user-a", customSnapshot(), 1) })
  });
  await runtime.initializeForAuthenticatedUser("user-a");
  const snapshot = runtime.getSnapshot();
  snapshot.words.push({ wordKey: "injected" });
  assert.equal(runtime.getSnapshot().words.length, 1);
  assert.throws(() => { runtime.getStatus().source = "changed"; }, TypeError);
});

test("runtime remains infrastructure-only: app and migrations do not import or define it", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const migrationSource = readFileSync(new URL(
    "../supabase/migrations/003_user_custom_vocabularies.sql",
    import.meta.url
  ), "utf8");
  assert.equal(appSource.includes("custom-vocabulary-runtime"), false);
  assert.equal(migrationSource.includes("custom-vocabulary-runtime"), false);
});
