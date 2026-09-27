import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PRACTICE_MODES } from "../js/core/review-scheduler.js";
import {
  createMainNavigationState,
  MAIN_VIEWS
} from "../js/ui/main-navigation-state.js";

test("each main page derives exactly one active navigation item", () => {
  const cases = [
    [MAIN_VIEWS.PRACTICE, PRACTICE_MODES.RANDOM, "random"],
    [MAIN_VIEWS.PRACTICE, PRACTICE_MODES.INTENSIVE, "intensive"],
    [MAIN_VIEWS.WORDBOOK, PRACTICE_MODES.INTENSIVE, "wordbook"],
    [MAIN_VIEWS.VOCABULARY_MANAGER, PRACTICE_MODES.RANDOM, "vocabularyManager"]
  ];

  for (const [view, mode, expected] of cases) {
    const state = createMainNavigationState(view, mode);
    assert.deepEqual(
      Object.entries(state).filter(([, active]) => active).map(([key]) => key),
      [expected]
    );
    assert.equal("account" in state, false);
  }
});

test("startup preloads the large default details module and contains no artificial loading timer", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  const customIntegration = await readFile(new URL("../js/core/custom-vocabulary-integration.js", import.meta.url), "utf8");

  assert.match(html, /rel="modulepreload" href="\.\/js\/data\/default-vocabulary\.js"/);
  assert.match(html, /rel="modulepreload" href="\.\/js\/data\/vocabulary-details\.js"/);
  assert.match(app, /const shouldHoldInitialLearningState = hasPersistedSupabaseSession\(\) \|\|/);
  assert.match(app, /if \(!shouldHoldInitialLearningState\) \{\s*renderInitialLearningState\(\)/);
  assert.match(app, /if \(shouldHoldInitialLearningState\) \{[\s\S]*practiceMain\.inert = true/);
  assert.match(app, /function markLearningSurfaceReady\(\)[\s\S]*practiceMain\.inert = false/);
  assert.match(
    app,
    /dispatchOwnershipState:\s*\(authState\)\s*=>\s*customVocabularyIntegration\.handleAuthState\(authState\)/
  );
  const authInitialization = app.match(/async function initializeAuthentication\(\)[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(authInitialization, /signupConfirmationStartupCoordinator\.initialize\(\)/);
  assert.doesNotMatch(authInitialization, /customVocabularyIntegration\.handleAuthState/);
  assert.doesNotMatch(
    app,
    /if \(!hasRenderedLearningState && learningStateRuntime\)[\s\S]*?applyRuntimeLearningState/
  );
  assert.match(customIntegration, /Vocabulary\/index must be active before the Learning Repository/);
  assert.doesNotMatch(app, /setTimeout\([^)]*3000|setTimeout\([^)]*3_000/);
});

test("Wordbook active-word changes replace the invalidated question and remain immediate persistence", async () => {
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  const handler = app.match(/function handleWordbookStatusChange\([\s\S]*?\n\}/)?.[0] ?? "";

  assert.doesNotMatch(app, /当前题完成前不可修改|reason === "active-question"/);
  assert.match(handler, /if \(result\.activeQuestionInvalidated\) \{\s*replaceActiveQuestion\(wordKey\)/);
  assert.match(handler, /else \{\s*persistState\(\)/);
  assert.doesNotMatch(handler, /CLOUD_DEFERRED/);
});
