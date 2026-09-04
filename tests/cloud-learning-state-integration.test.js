import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("application routes its single persistence boundary through the learning runtime", async () => {
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /function persistStateCandidate\(candidate, options\)[\s\S]*learningStateRuntime\.persistState\(candidate, options\)/);
  assert.match(app, /guestState:\s*appState/);
  assert.match(app, /saveGuestState:\s*\(state\)\s*=>\s*saveAppState\(state\)/);
  assert.match(app, /saveRelatedState:\s*persistStateCandidate/);
  assert.doesNotMatch(app, /createCloudLearningState\s*\(/);
});

test("only unsubmitted option selection uses cloud-deferred persistence", async () => {
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  const toggle = app.match(/function toggleOption\([\s\S]*?\n\}/)?.[0] ?? "";
  const submit = app.match(/function submitAnswer\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(toggle, /persistState\(\{ intent: PERSISTENCE_INTENTS\.CLOUD_DEFERRED \}\)/);
  assert.doesNotMatch(submit, /CLOUD_DEFERRED/);
  assert.equal((app.match(/PERSISTENCE_INTENTS\.CLOUD_DEFERRED/g) ?? []).length, 1);
});

test("account panel exposes only the lightweight cloud connection status", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="account-cloud-status"/);
  assert.match(html, /id="account-cloud-reload"[^>]*hidden/);
  assert.match(html, /app\.js\?v=10\.7b/);
  assert.match(html, /当前学习进度保存在此设备/);

  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /学习进度已连接到账号/);
  assert.match(app, /此账号尚未建立云端学习进度/);
  assert.match(app, /暂时无法连接云端学习进度/);
  assert.match(app, /此账号的学习进度已在另一台设备更新/);
  assert.match(app, /reloadCloudLearningStateAfterConflict/);
  assert.match(app, /accountCloudReload\.hidden\s*=\s*status\.syncStatus\s*!==\s*CLOUD_SYNC_STATUSES\.CONFLICT/);
});

test("cloud switching refreshes state consumers without rebuilding vocabulary", async () => {
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  const handler = app.match(/function applyRuntimeLearningState\(nextState\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(handler, /appState = normalizeStateForCurrentVocabulary\(nextState\)/);
  assert.match(handler, /renderActiveQuestion\(\)/);
  assert.match(handler, /renderViewFromLocation\(\)/);
  assert.doesNotMatch(handler, /vocabularyRepository\.(load|save)/);
  assert.doesNotMatch(handler, /validateVocabularyData|createVocabularyRepository/);
});
