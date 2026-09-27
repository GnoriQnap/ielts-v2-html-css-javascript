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

test("account panel exposes independent lightweight Learning and Custom Vocabulary status", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="account-cloud-status"/);
  assert.match(html, /id="account-cloud-reload"[^>]*hidden/);
  assert.match(html, /app\.js\?v=10\.9d3c/);
  assert.match(html, /当前学习进度保存在此设备/);
  assert.match(html, /id="account-custom-vocabulary-status"/);
  assert.match(html, /id="account-custom-vocabulary-reload"[^>]*hidden/);

  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /学习进度已连接到账号/);
  assert.match(app, /此账号尚未建立云端学习进度/);
  assert.match(app, /暂时无法连接云端学习进度/);
  assert.match(app, /此账号的学习进度已在另一台设备更新/);
  assert.match(app, /reloadCloudLearningStateAfterConflict/);
  assert.match(app, /reloadCustomVocabularyAfterConflict/);
  assert.match(app, /accountCloudReload\.hidden\s*=\s*status\.syncStatus\s*!==\s*CLOUD_SYNC_STATUSES\.CONFLICT/);
});

test("Stage 10.9D module graph loads D-3C setup deferral through fresh importer identities", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  const authDialog = await readFile(new URL("../js/ui/auth-dialog.js", import.meta.url), "utf8");
  const authRecoveryStartup = await readFile(
    new URL("../js/core/auth-recovery-startup.js", import.meta.url),
    "utf8"
  );
  const authSignupConfirmationStartup = await readFile(
    new URL("../js/core/auth-signup-confirmation-startup.js", import.meta.url),
    "utf8"
  );
  const learningRuntime = await readFile(
    new URL("../js/core/learning-state-runtime.js", import.meta.url),
    "utf8"
  );
  const customIntegration = await readFile(
    new URL("../js/core/custom-vocabulary-integration.js", import.meta.url),
    "utf8"
  );
  const learningSetupDialog = await readFile(
    new URL("../js/ui/cloud-learning-setup-dialog.js", import.meta.url),
    "utf8"
  );
  const version = "10.9d3";
  const recoveryPatchVersion = "10.9d3a";
  const patchVersion = "10.9d3b1";
  const setupDeferralVersion = "10.9d3c";
  const changedAppImports = [
    "./core/auth-service.js",
    "./core/auth-confirmation.js",
    "./core/learning-state-runtime.js",
    "./core/custom-vocabulary-integration.js"
  ];

  assert.match(html, new RegExp(`src="\\./js/app\\.js\\?v=${setupDeferralVersion}"`));
  for (const modulePath of changedAppImports) {
    const escapedPath = modulePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(app, new RegExp(`${escapedPath}\\?v=${version}`));
  }
  assert.match(app, new RegExp(`\\./core/auth-recovery-startup\\.js\\?v=${recoveryPatchVersion}`));
  assert.match(app, new RegExp(`\\./core/auth-signup-confirmation-startup\\.js\\?v=${patchVersion}`));
  assert.match(app, new RegExp(`\\./ui/auth-dialog\\.js\\?v=${patchVersion}`));
  assert.match(app, new RegExp(`\\./ui/cloud-learning-setup-dialog\\.js\\?v=${setupDeferralVersion}`));
  assert.match(app, new RegExp(`\\./ui/custom-vocabulary-setup-dialog\\.js\\?v=${setupDeferralVersion}`));
  assert.match(app, /shouldDeferAutoOpen:\s*\(\)\s*=>\s*authDialogController\.isRecoveryBlocking\(\)/);
  assert.match(app, /function reevaluateSetupDialogsForRecovery\(\)/);
  const recoveryUiEstablishment = app.match(
    /establishRecoveryUi:\s*\(callback\)\s*=>\s*\{[\s\S]*?\n\s*\}/
  )?.[0] ?? "";
  assert.match(recoveryUiEstablishment, /handlePasswordRecoveryCallback\(callback\)/);
  assert.match(recoveryUiEstablishment, /isRecoveryBlocking\(\)/);
  assert.match(recoveryUiEstablishment, /reevaluateSetupDialogsForRecovery\(\)/);
  assert.equal(
    recoveryUiEstablishment.indexOf("handlePasswordRecoveryCallback") <
      recoveryUiEstablishment.indexOf("reevaluateSetupDialogsForRecovery"),
    true
  );
  assert.doesNotMatch(app, /cloud-learning-setup-dialog\.js\?v=10\.9d3["']/);
  assert.doesNotMatch(app, /custom-vocabulary-setup-dialog\.js\?v=10\.8d2/);
  assert.match(
    learningSetupDialog,
    new RegExp(`\\.\\./core/learning-state-runtime\\.js\\?v=${version}`)
  );
  assert.match(authDialog, new RegExp(`\\.\\./core/auth-service\\.js\\?v=${version}`));
  assert.match(authDialog, new RegExp(`\\.\\./core/auth-confirmation\\.js\\?v=${version}`));
  assert.match(authRecoveryStartup, new RegExp(`\\./auth-confirmation\\.js\\?v=${version}`));
  assert.match(authSignupConfirmationStartup, new RegExp(`\\./auth-service\\.js\\?v=${version}`));
  assert.match(learningRuntime, new RegExp(`\\./auth-service\\.js\\?v=${version}`));
  assert.match(customIntegration, new RegExp(`\\./auth-service\\.js\\?v=${version}`));

  assert.doesNotMatch(html, /app\.js\?v=10\.8d2/);
  assert.doesNotMatch(html, /app\.js\?v=10\.9b5/);
  assert.doesNotMatch(app, /learning-state-runtime\.js\?v=10\.7b/);
  assert.doesNotMatch(app, /auth-dialog\.js\?v=10\.2a/);
  assert.doesNotMatch(app, /cloud-learning-setup-dialog\.js\?v=10\.7b/);
  assert.doesNotMatch(app, /vocabulary-card-overlay\.js\?v=8\.3\.1/);
  assert.doesNotMatch(app, /learning-surface-interactivity\.js\?v=10\.9b4/);
  assert.doesNotMatch(learningSetupDialog, /learning-state-runtime\.js\?v=10\.7b/);
  assert.match(app, /vocabulary-card-overlay\.js\?v=10\.9b5/);
  assert.match(app, /learning-surface-interactivity\.js\?v=10\.9b5/);
});

test("cloud switching refreshes state consumers without rebuilding vocabulary", async () => {
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  const handler = app.match(/function applyRuntimeLearningState\(nextState, status\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(handler, /isAuthenticatedLearningBlocked\(status\)[\s\S]*renderBlockedLearningState\(status\);[\s\S]*return;/);
  assert.match(handler, /appState = normalizeStateForCurrentVocabulary\(nextState\)/);
  assert.match(handler, /renderActiveQuestion\(\)/);
  assert.match(handler, /renderViewFromLocation\(\)/);
  assert.doesNotMatch(handler, /vocabularyRepository\.(load|save)/);
  assert.doesNotMatch(handler, /validateVocabularyData|createVocabularyRepository/);
});

test("authenticated unresolved Learning renders a non-persistable blocked surface", async () => {
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(
    app,
    /CLOUD_SYNC_STATUSES,\s*createLearningStateRuntime,\s*LEARNING_STATE_SOURCES,\s*PERSISTENCE_INTENTS\s*}\s*from "\.\/core\/learning-state-runtime\.js/
  );
  const blocked = app.match(/function renderBlockedLearningState\(status\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(blocked, /practiceMain\.inert = true/);
  assert.match(blocked, /wordbookMain\.inert = true/);
  assert.match(blocked, /账号学习进度暂时无法连接，请刷新页面重试或退出账号/);
  assert.doesNotMatch(blocked, /normalizeStateForCurrentVocabulary|replaceActiveQuestion|persistState/);

  const persist = app.match(/function persistStateCandidate\(candidate, options\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(persist, /learningStateRuntime\.persistState\(candidate, options\)/);
});
