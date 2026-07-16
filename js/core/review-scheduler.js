import { LEARNING_STATUSES } from "./learning-service.js";

export const PRACTICE_MODES = Object.freeze({
  RANDOM: "random",
  INTENSIVE: "intensive"
});

export const REVIEW_SCOPE = "free";
export const MIN_REVIEW_DELAY = 5;
export const MAX_REVIEW_DELAY = 7;

export function scheduleReview(reviewQueue, wordKey, attemptCount, options = {}) {
  const { random = Math.random } = options;
  const queue = Array.isArray(reviewQueue) ? reviewQueue : [];

  if (typeof wordKey !== "string" || wordKey.length === 0) {
    throw new TypeError("wordKey 必须是非空字符串。");
  }
  if (!Number.isInteger(attemptCount) || attemptCount < 0) {
    throw new RangeError("attemptCount 必须是非负整数。");
  }

  const delay = randomDelay(random);
  const nextItem = {
    wordKey,
    scope: REVIEW_SCOPE,
    roundId: null,
    scheduledAtAttempt: attemptCount,
    dueAfterAttempt: attemptCount + delay,
    delay
  };
  const existingIndex = queue.findIndex((item) => item?.wordKey === wordKey);

  if (existingIndex === -1) {
    return [...queue, nextItem];
  }

  return queue.map((item, index) => index === existingIndex ? nextItem : item);
}

export function getDueReviewWords(reviewQueue, attemptCount) {
  if (!Number.isInteger(attemptCount) || attemptCount < 0) {
    throw new RangeError("attemptCount 必须是非负整数。");
  }

  return (Array.isArray(reviewQueue) ? reviewQueue : [])
    .filter((item) => item.dueAfterAttempt <= attemptCount)
    .map((item) => item.wordKey);
}

export function removeReviewItem(reviewQueue, wordKey) {
  return (Array.isArray(reviewQueue) ? reviewQueue : [])
    .filter((item) => item?.wordKey !== wordKey);
}

export function normalizeReviewQueue(reviewQueue, options = {}) {
  const {
    validWordKeys = new Set(),
    learning = { byWordKey: {} }
  } = options;

  if (!Array.isArray(reviewQueue)) {
    return [];
  }

  const byWordKey = new Map();
  for (const item of reviewQueue) {
    if (!isValidReviewItem(item) || !validWordKeys.has(item.wordKey)) {
      continue;
    }
    if (learning.byWordKey?.[item.wordKey]?.status === LEARNING_STATUSES.REMEMBERED) {
      continue;
    }
    byWordKey.set(item.wordKey, {
      wordKey: item.wordKey,
      scope: REVIEW_SCOPE,
      roundId: null,
      scheduledAtAttempt: item.scheduledAtAttempt,
      dueAfterAttempt: item.dueAfterAttempt,
      delay: item.delay
    });
  }

  return [...byWordKey.values()];
}

export function selectPracticeWordKey(options) {
  const {
    mode = PRACTICE_MODES.RANDOM,
    eligibleWordKeys = [],
    learning = { byWordKey: {} },
    reviewQueue = [],
    attemptCount = 0,
    excludeWordKey = null,
    random = Math.random
  } = options;
  const eligibleSet = new Set(eligibleWordKeys);

  if (mode === PRACTICE_MODES.INTENSIVE) {
    const reviewWords = eligibleWordKeys.filter(
      (wordKey) => learning.byWordKey?.[wordKey]?.status === LEARNING_STATUSES.REVIEW
    );
    return selectCandidate(reviewWords, excludeWordKey, random);
  }

  const dueWords = getDueReviewWords(reviewQueue, attemptCount)
    .filter((wordKey) => (
      eligibleSet.has(wordKey) &&
      learning.byWordKey?.[wordKey]?.status === LEARNING_STATUSES.REVIEW
    ));
  const dueCandidate = selectCandidate(dueWords, excludeWordKey, random, true);
  if (dueCandidate) {
    return dueCandidate;
  }

  return selectCandidate(eligibleWordKeys, excludeWordKey, random);
}

function selectCandidate(candidates, excludeWordKey, random, requireAlternative = false) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const alternatives = excludeWordKey
    ? candidates.filter((wordKey) => wordKey !== excludeWordKey)
    : candidates;
  if (alternatives.length > 0) {
    return alternatives[randomIndex(alternatives.length, random)];
  }
  if (requireAlternative) {
    return null;
  }
  return candidates[randomIndex(candidates.length, random)];
}

function isValidReviewItem(item) {
  return (
    item &&
    typeof item === "object" &&
    typeof item.wordKey === "string" &&
    item.wordKey.length > 0 &&
    item.scope === REVIEW_SCOPE &&
    item.roundId === null &&
    Number.isInteger(item.scheduledAtAttempt) &&
    item.scheduledAtAttempt >= 0 &&
    Number.isInteger(item.delay) &&
    item.delay >= MIN_REVIEW_DELAY &&
    item.delay <= MAX_REVIEW_DELAY &&
    item.dueAfterAttempt === item.scheduledAtAttempt + item.delay
  );
}

function randomDelay(random) {
  return MIN_REVIEW_DELAY + randomIndex(MAX_REVIEW_DELAY - MIN_REVIEW_DELAY + 1, random);
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
