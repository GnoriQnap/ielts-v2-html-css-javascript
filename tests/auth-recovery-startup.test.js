import assert from "node:assert/strict";
import test from "node:test";

import { AUTH_CALLBACK_CLASSIFICATIONS } from "../js/core/auth-confirmation.js";
import { createAuthRecoveryStartupCoordinator } from "../js/core/auth-recovery-startup.js";

test("recovery URL intent alone establishes failure before cleanup, never password update", () => {
  const order = [];
  const observed = [];
  const coordinator = createAuthRecoveryStartupCoordinator({
    callbackUrl: "https://example.test/?auth=recovery&type=recovery&code=attacker-controlled",
    establishRecoveryUi(callback, state) {
      order.push("ui");
      observed.push({ callback, state });
    },
    cleanCallbackUrl() { order.push("cleanup"); }
  });

  const result = coordinator.handleAuthState({
    status: "authenticated",
    user: { id: "ordinary-user" },
    authEvent: "SIGNED_IN",
    sessionKind: "ordinary"
  });
  assert.equal(result.classification, AUTH_CALLBACK_CLASSIFICATIONS.INVALID_PASSWORD_RECOVERY);
  assert.equal(observed[0].callback.classification, AUTH_CALLBACK_CLASSIFICATIONS.INVALID_PASSWORD_RECOVERY);
  assert.deepEqual(order, ["ui", "cleanup"]);
});

test("SDK PASSWORD_RECOVERY can upgrade an earlier ordinary startup classification", () => {
  const classifications = [];
  let cleanCount = 0;
  const coordinator = createAuthRecoveryStartupCoordinator({
    callbackUrl: "https://example.test/?auth=recovery&code=sensitive",
    establishRecoveryUi(callback) { classifications.push(callback.classification); },
    cleanCallbackUrl() { cleanCount += 1; }
  });

  coordinator.handleAuthState({
    status: "authenticated",
    user: { id: "same-user" },
    authEvent: "INITIAL_SESSION",
    sessionKind: "ordinary"
  });
  coordinator.handleAuthState({
    status: "authenticated",
    user: { id: "same-user" },
    authEvent: "PASSWORD_RECOVERY",
    sessionKind: "password-recovery"
  });

  assert.deepEqual(classifications, [
    AUTH_CALLBACK_CLASSIFICATIONS.INVALID_PASSWORD_RECOVERY,
    AUTH_CALLBACK_CLASSIFICATIONS.PASSWORD_RECOVERY
  ]);
  assert.equal(cleanCount, 1);
});

test("consumed invalid recovery callback is not replayed by later ordinary Auth transitions", () => {
  const classifications = [];
  let failureUiOpen = false;
  const coordinator = createAuthRecoveryStartupCoordinator({
    callbackUrl: "https://example.test/?auth=recovery",
    establishRecoveryUi(callback) {
      classifications.push(callback.classification);
      failureUiOpen = true;
    },
    cleanCallbackUrl() {}
  });

  coordinator.handleAuthState({
    status: "authenticated",
    user: { id: "ordinary-user" },
    authEvent: "SIGNED_IN",
    sessionKind: "ordinary"
  });
  assert.equal(failureUiOpen, true);
  failureUiOpen = false; // User dismisses the already-cleaned one-shot failure UI.
  for (const authState of [
    {
      status: "authenticated",
      user: { id: "ordinary-user" },
      authEvent: "TOKEN_REFRESHED",
      sessionKind: "ordinary"
    },
    {
      status: "authenticated",
      user: { id: "ordinary-user" },
      authEvent: "SIGNED_IN",
      sessionKind: "ordinary"
    },
    { status: "guest", user: null, authEvent: "SIGNED_OUT", sessionKind: "ordinary" }
  ]) {
    const replay = coordinator.handleAuthState(authState);
    assert.equal(replay.handled, false);
    assert.equal(replay.duplicate, true);
  }

  assert.deepEqual(classifications, [
    AUTH_CALLBACK_CLASSIFICATIONS.INVALID_PASSWORD_RECOVERY
  ]);
  assert.equal(failureUiOpen, false);
});

test("fresh page coordinator processes a genuinely new invalid recovery callback", () => {
  let uiCount = 0;
  const createCoordinator = () => createAuthRecoveryStartupCoordinator({
    callbackUrl: "https://example.test/?auth=recovery",
    establishRecoveryUi() { uiCount += 1; },
    cleanCallbackUrl() {}
  });
  const ordinaryState = {
    status: "authenticated",
    user: { id: "ordinary-user" },
    authEvent: "SIGNED_IN",
    sessionKind: "ordinary"
  };

  createCoordinator().handleAuthState(ordinaryState);
  createCoordinator().handleAuthState(ordinaryState);

  assert.equal(uiCount, 2);
});

test("same Auth state is deduplicated and ordinary reload has no recovery authority", () => {
  let uiCount = 0;
  const coordinator = createAuthRecoveryStartupCoordinator({
    callbackUrl: "https://example.test/?auth=recovery&code=sensitive",
    establishRecoveryUi() { uiCount += 1; },
    cleanCallbackUrl() {}
  });
  const recoveryState = {
    status: "authenticated",
    user: { id: "same-user" },
    authEvent: "PASSWORD_RECOVERY",
    sessionKind: "password-recovery"
  };
  coordinator.handleAuthState(recoveryState);
  const duplicate = coordinator.handleAuthState({
    ...recoveryState,
    authEvent: "TOKEN_REFRESHED"
  });
  assert.equal(uiCount, 1);
  assert.equal(duplicate.duplicate, true);

  const reloaded = createAuthRecoveryStartupCoordinator({
    callbackUrl: "https://example.test/",
    establishRecoveryUi() { uiCount += 1; },
    cleanCallbackUrl() {}
  });
  assert.equal(reloaded.handleAuthState(recoveryState).handled, false);
  assert.equal(uiCount, 1);
});

test("signup callbacks are outside the recovery startup coordinator", () => {
  let called = false;
  const coordinator = createAuthRecoveryStartupCoordinator({
    callbackUrl: "https://example.test/?auth=confirmed&code=signup",
    establishRecoveryUi() { called = true; },
    cleanCallbackUrl() {}
  });
  assert.equal(coordinator.handleAuthState({
    status: "authenticated",
    authEvent: "SIGNED_IN",
    sessionKind: "ordinary"
  }).handled, false);
  assert.equal(called, false);
});
