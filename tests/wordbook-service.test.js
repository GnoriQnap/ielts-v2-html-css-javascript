import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultAppState } from "../js/core/storage.js";
import { createVocabularyIndex } from "../js/core/vocabulary-index.js";
import { createDefaultRoundProgress } from "../js/core/round-service.js";
import {
  applyWordbookStatusChange,
  createWordbookCategoryTree,
  createWordbookEntries,
  filterWordbookEntries,
  hasWordDetails
} from "../js/core/wordbook-service.js";

const vocabulary = {
  vocabulary_list: [
    { group_id: 1, category: "保持、维持", words: ["sustain", "keep"] },
    { group_id: 2, category: "支持、支撑", words: ["sustain", "support"] },
    { group_id: 3, category: "调查、研究", words: ["study", "research"] }
  ]
};

test("wordbook shows review state and every category membership", () => {
  const index = createVocabularyIndex(vocabulary.vocabulary_list);
  const state = createDefaultAppState(vocabulary);
  state.learning.byWordKey.sustain = { status: "review" };

  const sustain = createWordbookEntries(index, state.learning)
    .find((entry) => entry.wordKey === "sustain");
  assert.equal(sustain.status, "review");
  assert.deepEqual(sustain.categories.map((item) => item.category), ["保持、维持", "支持、支撑"]);
});

test("all mode builds a category tree and repeats multi-category words under each source category", () => {
  const index = createVocabularyIndex(vocabulary.vocabulary_list);
  const tree = createWordbookCategoryTree(index, { byWordKey: {} });

  assert.equal(tree.length, 3);
  assert.deepEqual(tree.map((group) => group.category), ["保持、维持", "支持、支撑", "调查、研究"]);
  assert.deepEqual(tree[0].words.map((entry) => entry.wordKey), ["sustain", "keep"]);
  assert.deepEqual(tree[1].words.map((entry) => entry.wordKey), ["sustain", "support"]);
});

test("wordbook search matches English case-insensitively and any Chinese category", () => {
  const index = createVocabularyIndex(vocabulary.vocabulary_list);
  const entries = createWordbookEntries(index, { byWordKey: {} });

  assert.deepEqual(
    filterWordbookEntries(entries, { query: "SUSTAIN" }).map((entry) => entry.wordKey),
    ["sustain"]
  );
  assert.deepEqual(
    filterWordbookEntries(entries, { query: "支撑" }).map((entry) => entry.wordKey),
    ["sustain", "support"]
  );
  assert.deepEqual(
    filterWordbookEntries(entries, { filter: "new" }).map((entry) => entry.wordKey),
    entries.map((entry) => entry.wordKey)
  );
});

test("remembered removes review scheduling and review does not schedule an error retry", () => {
  const state = createDefaultAppState(vocabulary);
  state.learning.byWordKey.sustain = { status: "review" };
  state.practice.reviewQueue = [{ wordKey: "sustain" }];

  const remembered = applyWordbookStatusChange({
    state,
    wordKey: "sustain",
    status: "remembered",
    changedAt: "2026-07-17T01:00:00.000Z"
  });
  assert.equal(remembered.applied, true);
  assert.equal(remembered.state.learning.byWordKey.sustain.status, "remembered");
  assert.deepEqual(remembered.state.practice.reviewQueue, []);

  const review = applyWordbookStatusChange({
    state: remembered.state,
    wordKey: "sustain",
    status: "review",
    changedAt: "2026-07-17T02:00:00.000Z"
  });
  assert.equal(review.state.learning.byWordKey.sustain.status, "review");
  assert.deepEqual(review.state.practice.reviewQueue, []);
});

test("manual status change is blocked for the active question", () => {
  const state = createDefaultAppState(vocabulary);
  state.practice.activeQuestion = { wordKey: "sustain" };

  const result = applyWordbookStatusChange({
    state,
    wordKey: "sustain",
    status: "remembered"
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "active-question");
  assert.equal(result.state, state);
});

test("manual status changes synchronize and can complete an active round", () => {
  const state = createDefaultAppState(vocabulary);
  const wordKeys = ["sustain", "keep", "support", "study", "research"];
  state.rounds.current = {
    id: "round-wordbook",
    createdAt: "2026-07-17T00:00:00.000Z",
    requestedSize: 5,
    wordKeys,
    attemptCount: 4,
    correctAttemptCount: 4,
    progressByWord: Object.fromEntries(wordKeys.map((wordKey, index) => [
      wordKey,
      {
        ...createDefaultRoundProgress(),
        mastered: index > 0
      }
    ]))
  };

  const completed = applyWordbookStatusChange({
    state,
    wordKey: "sustain",
    status: "remembered",
    changedAt: "2026-07-17T03:00:00.000Z"
  });
  assert.equal(completed.state.rounds.current, null);
  assert.equal(completed.state.rounds.lastCompletedSummary.masteredCount, 5);

  const reopenedState = createDefaultAppState(vocabulary);
  reopenedState.learning.byWordKey.sustain = { status: "remembered" };
  reopenedState.rounds.current = {
    ...state.rounds.current,
    progressByWord: {
      ...state.rounds.current.progressByWord,
      sustain: {
        ...state.rounds.current.progressByWord.sustain,
        mastered: true,
        masteredViaExternalChange: true
      }
    }
  };
  const reopened = applyWordbookStatusChange({
    state: reopenedState,
    wordKey: "sustain",
    status: "review",
    changedAt: "2026-07-17T04:00:00.000Z"
  });
  assert.equal(reopened.state.rounds.current.progressByWord.sustain.mastered, false);
  assert.equal(reopened.state.learning.byWordKey.sustain.status, "review");
});

test("empty and populated static details are detected", () => {
  const index = createVocabularyIndex(vocabulary.vocabulary_list);
  const entries = createWordbookEntries(index, { byWordKey: {} }, {
    sustain: { phonetic: "/səˈsteɪn/", examples: ["We must sustain progress."] }
  });

  assert.equal(hasWordDetails(entries.find((entry) => entry.wordKey === "keep").details), false);
  assert.equal(hasWordDetails(entries.find((entry) => entry.wordKey === "sustain").details), true);
});
