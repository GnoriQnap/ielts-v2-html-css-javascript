import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CLOUD_CUSTOM_VOCABULARY_STATUSES,
  CLOUD_CUSTOM_VOCABULARY_TABLE,
  createCloudCustomVocabularyRepository
} from "../js/core/cloud-custom-vocabulary-repository.js";
import { createEmptyCustomVocabularySnapshot } from "../js/core/custom-vocabulary-snapshot.js";
import { vocabularyData } from "../js/data/vocabulary.js";

const CATEGORY_A = "11111111-1111-4111-8111-111111111111";
const CATEGORY_B = "22222222-2222-4222-8222-222222222222";
const SYSTEM_GROUP_ID = vocabularyData.vocabulary_list[0].group_id;
const OFFICIAL_WORD = vocabularyData.vocabulary_list[0].words[0];
const repositorySource = readFileSync(new URL(
  "../js/core/cloud-custom-vocabulary-repository.js",
  import.meta.url
), "utf8");

test("unauthenticated load/create/update never access the custom vocabulary table", async () => {
  const mock = createMockSupabase({ userId: null });
  const repository = createRepository(mock.client);
  assert.equal((await repository.loadCustomVocabulary()).status, "unauthenticated");
  assert.equal((await repository.createCustomVocabulary(emptySnapshot())).status, "unauthenticated");
  assert.equal((await repository.updateCustomVocabulary(emptySnapshot(), {
    expectedRevision: 1
  })).status, "unauthenticated");
  assert.equal(mock.calls.from.length, 0);
});

test("load distinguishes not-found and returns canonical found data with owner metadata", async () => {
  const missing = createMockSupabase({ userId: "user-a", loadRow: null });
  assert.deepEqual(await createRepository(missing.client).loadCustomVocabulary(), {
    ok: true,
    status: "not-found",
    userId: "user-a"
  });

  const mock = createMockSupabase({
    userId: "user-a",
    loadRow: {
      vocabulary: unorderedSnapshot(),
      updated_at: "2026-09-13T10:00:00.000Z",
      revision: 3
    }
  });
  const result = await createRepository(mock.client).loadCustomVocabulary();
  assert.equal(result.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.FOUND);
  assert.equal(result.userId, "user-a");
  assert.equal(result.revision, 3);
  assert.equal(result.updatedAt, "2026-09-13T10:00:00.000Z");
  assert.deepEqual(result.snapshot.categories.map(({ categoryId }) => categoryId), [CATEGORY_A, CATEGORY_B]);
  assert.deepEqual(result.snapshot.words.map(({ wordKey }) => wordKey), ["alpha-custom", "zeta-custom"]);
});

test("load rejects malformed and official-contaminated remote snapshots", async () => {
  for (const vocabulary of [
    { schemaVersion: 99, categories: [], words: [] },
    {
      schemaVersion: 1,
      categories: [],
      words: [{
        wordKey: OFFICIAL_WORD.toLowerCase(),
        displayText: OFFICIAL_WORD,
        memberships: [{ kind: "system", groupId: SYSTEM_GROUP_ID }],
        details: emptyDetails()
      }]
    }
  ]) {
    const mock = createMockSupabase({
      userId: "user-a",
      loadRow: { vocabulary, updated_at: null, revision: 1 }
    });
    const result = await createRepository(mock.client).loadCustomVocabulary();
    assert.equal(result.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.INVALID_REMOTE_DATA);
    assert.equal(result.error.code, "invalid_remote_snapshot");
  }
});

test("auth, network, and invalid remote revision failures remain structured and safe", async () => {
  const authFailure = createMockSupabase({
    userId: null,
    authError: { code: "network_error", message: "private endpoint detail" }
  });
  const authResult = await createRepository(authFailure.client).loadCustomVocabulary();
  assert.equal(authResult.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.ERROR);
  assert.deepEqual(authResult.error, { operation: "load", code: "network_error" });
  assert.equal(JSON.stringify(authResult).includes("private endpoint detail"), false);

  const invalidRevision = createMockSupabase({
    userId: "user-a",
    loadRow: { vocabulary: emptySnapshot(), updated_at: null, revision: 0 }
  });
  const revisionResult = await createRepository(invalidRevision.client).loadCustomVocabulary();
  assert.equal(revisionResult.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.ERROR);
  assert.equal(revisionResult.error.code, "invalid_revision");
});

test("create uses authenticated INSERT only, supports empty, and returns revision one", async () => {
  for (const snapshot of [emptySnapshot(), unorderedSnapshot()]) {
    const mock = createMockSupabase({ userId: "user-a" });
    const result = await createRepository(mock.client).createCustomVocabulary(snapshot, {
      expectedUserId: "user-a"
    });
    assert.equal(result.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.CREATED);
    assert.equal(result.userId, "user-a");
    assert.equal(result.revision, 1);
    assert.equal(mock.calls.insert[0].user_id, "user-a");
    assert.equal(mock.calls.insert[0].revision, 1);
    assert.equal(mock.calls.upsert, 0);
    assert.equal(mock.calls.update.length, 0);
  }
});

test("create validates and canonicalizes before writing without official baseline contamination", async () => {
  const invalid = createMockSupabase({ userId: "user-a" });
  const result = await createRepository(invalid.client).createCustomVocabulary({
    schemaVersion: 1,
    categories: [],
    words: [{ wordKey: "broken" }]
  });
  assert.equal(result.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.INVALID_SNAPSHOT);
  assert.equal(invalid.calls.from.length, 0);

  const valid = createMockSupabase({ userId: "user-a" });
  await createRepository(valid.client).createCustomVocabulary(unorderedSnapshot());
  const payload = valid.calls.insert[0].vocabulary;
  assert.deepEqual(payload.categories.map(({ categoryId }) => categoryId), [CATEGORY_A, CATEGORY_B]);
  assert.deepEqual(payload.words.map(({ wordKey }) => wordKey), ["alpha-custom", "zeta-custom"]);
  assert.deepEqual(Object.keys(payload), ["schemaVersion", "categories", "words"]);
  assert.equal(JSON.stringify(payload).includes(OFFICIAL_WORD), false);
});

test("create reports already-exists without update, retry, or upsert", async () => {
  const mock = createMockSupabase({
    userId: "user-a",
    createError: { code: "23505", message: "raw duplicate detail" }
  });
  const result = await createRepository(mock.client).createCustomVocabulary(emptySnapshot());
  assert.equal(result.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.ALREADY_EXISTS);
  assert.equal(mock.calls.insert.length, 1);
  assert.equal(mock.calls.update.length, 0);
  assert.equal(mock.calls.upsert, 0);
});

test("update matches authenticated user and expected revision, then increments exactly once", async () => {
  const mock = createMockSupabase({ userId: "user-a" });
  const result = await createRepository(mock.client).updateCustomVocabulary(
    unorderedSnapshot(),
    { expectedUserId: "user-a", expectedRevision: 4 }
  );
  assert.equal(result.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.UPDATED);
  assert.equal(result.revision, 5);
  assert.deepEqual(mock.calls.eq, [["user_id", "user-a"], ["revision", 4]]);
  assert.equal(mock.calls.update[0].revision, 5);
  assert.equal(mock.calls.insert.length, 0);
  assert.equal(mock.calls.upsert, 0);
});

test("update accepts an empty snapshot and rejects invalid snapshot/revision before table access", async () => {
  const empty = createMockSupabase({ userId: "user-a" });
  assert.equal((await createRepository(empty.client).updateCustomVocabulary(
    emptySnapshot(),
    { expectedUserId: "user-a", expectedRevision: 1 }
  )).status, CLOUD_CUSTOM_VOCABULARY_STATUSES.UPDATED);

  for (const guard of [
    { expectedRevision: 0 },
    { expectedRevision: -1 },
    { expectedRevision: 1.5 },
    { expectedRevision: "1" }
  ]) {
    const mock = createMockSupabase({ userId: "user-a" });
    const result = await createRepository(mock.client).updateCustomVocabulary(emptySnapshot(), guard);
    assert.equal(result.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.ERROR);
    assert.equal(result.error.code, "invalid_revision");
    assert.equal(mock.calls.from.length, 0);
  }

  const invalid = createMockSupabase({ userId: "user-a" });
  const invalidResult = await createRepository(invalid.client).updateCustomVocabulary(
    { schemaVersion: 0, categories: [], words: [] },
    { expectedRevision: 1 }
  );
  assert.equal(invalidResult.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.INVALID_SNAPSHOT);
  assert.equal(invalid.calls.from.length, 0);
});

test("expected user mismatch and identity changes reject stale results without redirecting writes", async () => {
  const mismatch = createMockSupabase({ userId: "user-b" });
  const mismatchResult = await createRepository(mismatch.client).updateCustomVocabulary(
    emptySnapshot(),
    { expectedUserId: "user-a", expectedRevision: 1 }
  );
  assert.equal(mismatchResult.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.IDENTITY_CHANGED);
  assert.equal(mismatch.calls.from.length, 0);

  const changed = createMockSupabase({ userIds: ["user-a", "user-b"] });
  const changedResult = await createRepository(changed.client).updateCustomVocabulary(
    emptySnapshot(),
    { expectedUserId: "user-a", expectedRevision: 1 }
  );
  assert.equal(changedResult.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.IDENTITY_CHANGED);
  assert.deepEqual(changed.calls.eq, [["user_id", "user-a"], ["revision", 1]]);

  const changedCreate = createMockSupabase({ userIds: ["user-a", "user-b"] });
  const changedCreateResult = await createRepository(changedCreate.client)
    .createCustomVocabulary(emptySnapshot(), { expectedUserId: "user-a" });
  assert.equal(changedCreateResult.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.IDENTITY_CHANGED);
  assert.equal(changedCreate.calls.insert[0].user_id, "user-a");

  const changedLoad = createMockSupabase({
    userIds: ["user-a", "user-b"],
    loadRow: { vocabulary: emptySnapshot(), updated_at: null, revision: 1 }
  });
  const changedLoadResult = await createRepository(changedLoad.client).loadCustomVocabulary();
  assert.equal(changedLoadResult.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.IDENTITY_CHANGED);
});

test("Supabase data=[] is diagnosed as conflict with validated remote data", async () => {
  const remote = unorderedSnapshot();
  remote.words[0].displayText = "Zeta-Custom";
  const mock = createMockSupabase({
    userId: "user-a",
    updateRow: [],
    loadRow: {
      vocabulary: remote,
      updated_at: "2026-09-13T12:00:00.000Z",
      revision: 5
    }
  });
  const result = await createRepository(mock.client).updateCustomVocabulary(
    emptySnapshot(),
    { expectedUserId: "user-a", expectedRevision: 4 }
  );
  assert.equal(result.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.CONFLICT);
  assert.equal(result.expectedRevision, 4);
  assert.equal(result.revision, 5);
  assert.equal(result.snapshot.words[1].displayText, "Zeta-Custom");
  assert.equal(mock.calls.update.length, 1);
  assert.equal(mock.calls.insert.length, 0);
  assert.equal(mock.calls.upsert, 0);
});

test("zero-row update distinguishes missing row and invalid remote conflict data", async () => {
  const missing = createMockSupabase({ userId: "user-a", updateRow: [], loadRow: null });
  const missingResult = await createRepository(missing.client).updateCustomVocabulary(
    emptySnapshot(),
    { expectedRevision: 1 }
  );
  assert.equal(missingResult.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.NOT_FOUND);

  const invalid = createMockSupabase({
    userId: "user-a",
    updateRow: [],
    loadRow: { vocabulary: { schemaVersion: 9 }, updated_at: null, revision: 2 }
  });
  const invalidResult = await createRepository(invalid.client).updateCustomVocabulary(
    emptySnapshot(),
    { expectedRevision: 1 }
  );
  assert.equal(invalidResult.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.INVALID_REMOTE_DATA);
});

test("two devices use revision OCC so the stale device cannot overwrite the winner", async () => {
  const cloud = createSharedCloud(emptySnapshot(), 4);
  const deviceOne = createRepository(cloud.client("user-a"));
  const deviceTwo = createRepository(cloud.client("user-a"));
  assert.equal((await deviceOne.loadCustomVocabulary()).revision, 4);
  assert.equal((await deviceTwo.loadCustomVocabulary()).revision, 4);

  const winner = await deviceOne.updateCustomVocabulary(unorderedSnapshot(), {
    expectedUserId: "user-a",
    expectedRevision: 4
  });
  const loser = await deviceTwo.updateCustomVocabulary(emptySnapshot(), {
    expectedUserId: "user-a",
    expectedRevision: 4
  });

  assert.equal(winner.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.UPDATED);
  assert.equal(winner.revision, 5);
  assert.equal(loser.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.CONFLICT);
  assert.equal(cloud.remote.revision, 5);
  assert.deepEqual(cloud.remote.vocabulary, winner.snapshot);
});

test("A guard cannot write B and the repository exposes no delete or local persistence surface", async () => {
  const cloud = createSharedCloud(emptySnapshot(), 5);
  const accountB = createRepository(cloud.client("user-b"));
  const result = await accountB.updateCustomVocabulary(unorderedSnapshot(), {
    expectedUserId: "user-a",
    expectedRevision: 5
  });
  assert.equal(result.status, CLOUD_CUSTOM_VOCABULARY_STATUSES.IDENTITY_CHANGED);
  assert.deepEqual(cloud.remote.vocabulary, emptySnapshot());

  const repository = createRepository(createMockSupabase().client);
  assert.equal("deleteCustomVocabulary" in repository, false);
  assert.doesNotMatch(repositorySource, /localStorage|ielts_synonym_trainer_vocabulary|learningStateRuntime|composeVocabulary|\.upsert\s*\(/);
  assert.equal(CLOUD_CUSTOM_VOCABULARY_TABLE, "user_custom_vocabularies");
});

function createRepository(client) {
  return createCloudCustomVocabularyRepository({
    getClient: async () => client,
    officialBaseline: vocabularyData
  });
}

function emptySnapshot() {
  return createEmptyCustomVocabularySnapshot();
}

function unorderedSnapshot() {
  return {
    schemaVersion: 1,
    user_id: "user-b",
    categories: [
      { categoryId: CATEGORY_B, category: "第二分类", ignored: true },
      { categoryId: CATEGORY_A, category: "第一分类" }
    ],
    words: [
      customWord("zeta-custom", "zeta-custom", [
        { kind: "custom", categoryId: CATEGORY_B },
        { kind: "system", groupId: SYSTEM_GROUP_ID }
      ]),
      customWord("alpha-custom", "alpha-custom", [
        { kind: "custom", categoryId: CATEGORY_A }
      ])
    ],
    ignored: "not persisted"
  };
}

function customWord(wordKey, displayText, memberships) {
  return { wordKey, displayText, memberships, details: emptyDetails(), ignored: true };
}

function emptyDetails() {
  return {
    phonetics: { uk: "", us: "" },
    meanings: [],
    collocations: [],
    examples: [],
    notes: "",
    source: "",
    updatedAt: ""
  };
}

function createMockSupabase(options = {}) {
  const {
    userId = "user-a",
    userIds = null,
    authError = null,
    loadRow = undefined,
    loadError = null,
    createRow = undefined,
    createError = null,
    updateRow = undefined,
    updateError = null
  } = options;
  const calls = { from: [], select: [], insert: [], update: [], eq: [], upsert: 0, delete: 0 };
  let authIndex = 0;
  let operation = "load";
  let payload = null;

  const client = {
    auth: {
      async getUser() {
        const id = userIds
          ? userIds[Math.min(authIndex++, userIds.length - 1)]
          : userId;
        return { data: { user: id ? { id } : null }, error: authError };
      }
    },
    from(table) {
      calls.from.push(table);
      operation = "load";
      payload = null;
      return query;
    }
  };
  const query = {
    select(columns) {
      calls.select.push(columns);
      return query;
    },
    insert(value) {
      operation = "create";
      payload = structuredClone(value);
      calls.insert.push(payload);
      return query;
    },
    update(value) {
      operation = "update";
      payload = structuredClone(value);
      calls.update.push(payload);
      return query;
    },
    upsert() {
      calls.upsert += 1;
      throw new Error("upsert must not be called");
    },
    delete() {
      calls.delete += 1;
      throw new Error("delete must not be called");
    },
    eq(column, value) {
      calls.eq.push([column, value]);
      return query;
    },
    async maybeSingle() {
      return { data: loadRow === undefined ? null : structuredClone(loadRow), error: loadError };
    },
    then(onFulfilled, onRejected) {
      const configured = updateRow === undefined
        ? [{
            vocabulary: payload.vocabulary,
            updated_at: "2026-09-13T11:00:00.000Z",
            revision: payload.revision
          }]
        : updateRow;
      return Promise.resolve({
        data: configured === null ? [] : structuredClone(configured),
        error: updateError
      }).then(onFulfilled, onRejected);
    },
    async single() {
      const row = createRow === undefined
        ? {
            vocabulary: payload.vocabulary,
            updated_at: "2026-09-13T10:30:00.000Z",
            revision: payload.revision
          }
        : createRow;
      return { data: structuredClone(row), error: createError };
    }
  };
  return { client, calls };
}

function createSharedCloud(initialVocabulary, initialRevision) {
  const remote = {
    userId: "user-a",
    vocabulary: structuredClone(initialVocabulary),
    revision: initialRevision,
    updated_at: "2026-09-13T09:00:00.000Z"
  };

  function client(userId) {
    return {
      auth: {
        async getUser() {
          return { data: { user: { id: userId } }, error: null };
        }
      },
      from() {
        let operation = "load";
        let payload = null;
        const filters = new Map();
        const query = {
          select() { return query; },
          update(value) {
            operation = "update";
            payload = structuredClone(value);
            return query;
          },
          eq(column, value) {
            filters.set(column, value);
            return query;
          },
          async maybeSingle() {
            return {
              data: userId === remote.userId
                ? {
                    vocabulary: structuredClone(remote.vocabulary),
                    updated_at: remote.updated_at,
                    revision: remote.revision
                  }
                : null,
              error: null
            };
          },
          then(onFulfilled, onRejected) {
            let data = [];
            if (
              operation === "update" &&
              userId === remote.userId &&
              filters.get("user_id") === remote.userId &&
              filters.get("revision") === remote.revision
            ) {
              remote.vocabulary = structuredClone(payload.vocabulary);
              remote.revision = payload.revision;
              remote.updated_at = "2026-09-13T12:00:00.000Z";
              data = [{
                vocabulary: structuredClone(remote.vocabulary),
                updated_at: remote.updated_at,
                revision: remote.revision
              }];
            }
            return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
          }
        };
        return query;
      }
    };
  }

  return { remote, client };
}
