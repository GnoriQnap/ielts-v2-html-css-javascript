import assert from "node:assert/strict";
import test from "node:test";

import { createSignupConfirmationStartupCoordinator } from "../js/core/auth-signup-confirmation-startup.js";

const validSignupCallback = Object.freeze({
  isCallback: true,
  hasConfirmationEvidence: true,
  hasError: false
});

test("signup confirmation holds authenticated startup until signout releases Guest ownership", async () => {
  const events = [];
  const service = createStartupAuthService(authenticatedState("confirmed@example.com"), events);
  const ownershipStates = [];
  const accountStartup = { customCloudLoads: 0, learningCloudStarts: 0, setupDialogs: 0 };
  const coordinator = createSignupConfirmationStartupCoordinator({
    authService: service,
    signupCallback: validSignupCallback,
    async handleSignupConfirmation() {
      events.push("confirmation:start");
      const result = await service.signOut();
      events.push("confirmation:signed-out");
      return { handled: true, success: result.ok };
    },
    cleanSignupCallback() { events.push("callback:clean"); },
    handleRecoveryAuthState() {},
    dispatchOwnershipState(state) {
      ownershipStates.push(state);
      if (state.status === "authenticated") {
        accountStartup.customCloudLoads += 1;
        accountStartup.learningCloudStarts += 1;
        accountStartup.setupDialogs += 1;
      }
      events.push(`ownership:${state.status}`);
    }
  });
  service.subscribe((state) => void coordinator.handleAuthState(state));

  const result = await coordinator.initialize();

  assert.equal(result.gated, false);
  assert.deepEqual(ownershipStates.map((state) => state.status), ["guest"]);
  assert.equal(ownershipStates.some((state) => state.status === "authenticated"), false);
  assert.deepEqual(accountStartup, {
    customCloudLoads: 0,
    learningCloudStarts: 0,
    setupDialogs: 0
  });
  assert.ok(events.indexOf("confirmation:signed-out") < events.indexOf("ownership:guest"));
  assert.equal(service.calls.signOut, 1);
});

test("confirmation signout failure keeps all ownership startup gated until Guest retry release", async () => {
  const events = [];
  const service = createStartupAuthService(authenticatedState("confirmed@example.com"), events);
  const ownershipStates = [];
  let guestStartupCount = 0;
  const coordinator = createSignupConfirmationStartupCoordinator({
    authService: service,
    signupCallback: validSignupCallback,
    async handleSignupConfirmation() {
      events.push("confirmation:sign-out-failed");
      return { handled: true, success: false, reason: "sign-out-failed" };
    },
    cleanSignupCallback() {},
    dispatchOwnershipState(state) {
      ownershipStates.push(state);
      if (state.status === "guest") guestStartupCount += 1;
    }
  });
  service.subscribe((state) => void coordinator.handleAuthState(state));

  const result = await coordinator.initialize();
  assert.equal(result.gated, true);
  assert.equal(coordinator.isOwnershipGated(), true);
  assert.deepEqual(ownershipStates, []);
  assert.equal(guestStartupCount, 0);

  const rejectedRelease = await coordinator.releaseAfterConfirmationSignOut(service.getState());
  assert.equal(rejectedRelease.released, false);
  assert.deepEqual(ownershipStates, []);

  const guest = service.publish(guestState());
  await coordinator.releaseAfterConfirmationSignOut(guest);
  assert.equal(coordinator.isOwnershipGated(), false);
  assert.deepEqual(ownershipStates.map((state) => state.status), ["guest"]);
});

test("gated generic confirmation failure retains authenticated events until actual Guest release", async () => {
  const service = createStartupAuthService(authenticatedState("callback@example.com"), []);
  const ownershipStates = [];
  const accountStartup = { customCloudLoads: 0, learningCloudStarts: 0, setupDialogs: 0 };
  const coordinator = createSignupConfirmationStartupCoordinator({
    authService: service,
    signupCallback: validSignupCallback,
    handleSignupConfirmation() {
      return { handled: true, success: false };
    },
    cleanSignupCallback() {},
    dispatchOwnershipState(state) {
      ownershipStates.push(state);
      if (state.status === "authenticated") {
        accountStartup.customCloudLoads += 1;
        accountStartup.learningCloudStarts += 1;
        accountStartup.setupDialogs += 1;
      }
    }
  });
  service.subscribe((state) => void coordinator.handleAuthState(state));

  const result = await coordinator.initialize();
  assert.equal(result.gated, true);
  assert.equal(coordinator.isOwnershipGated(), true);
  assert.deepEqual(ownershipStates, []);
  assert.deepEqual(accountStartup, {
    customCloudLoads: 0,
    learningCloudStarts: 0,
    setupDialogs: 0
  });

  for (const authEvent of ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"]) {
    service.publish({
      ...authenticatedState("callback@example.com"),
      authEvent
    });
  }
  await Promise.resolve();
  assert.deepEqual(ownershipStates, []);

  const guest = service.publish(guestState());
  await coordinator.releaseAfterConfirmationSignOut(guest);
  assert.deepEqual(ownershipStates.map((state) => state.status), ["guest"]);
});

test("ordinary persisted account and Guest startup dispatch exactly once", async () => {
  for (const initialState of [authenticatedState("saved@example.com"), guestState()]) {
    const service = createStartupAuthService(initialState, []);
    const ownershipStates = [];
    const coordinator = createSignupConfirmationStartupCoordinator({
      authService: service,
      signupCallback: { isCallback: false },
      handleSignupConfirmation() { throw new Error("unexpected confirmation"); },
      dispatchOwnershipState(state) { ownershipStates.push(state); }
    });
    service.subscribe((state) => void coordinator.handleAuthState(state));

    await coordinator.initialize();
    assert.deepEqual(ownershipStates.map((state) => state.status), [initialState.status]);
  }
});

test("password recovery is not routed through the signup gate", async () => {
  const recovery = {
    ...authenticatedState("recover@example.com"),
    authEvent: "PASSWORD_RECOVERY",
    sessionKind: "password-recovery"
  };
  const service = createStartupAuthService(recovery, []);
  const recoveryStates = [];
  const ownershipStates = [];
  const coordinator = createSignupConfirmationStartupCoordinator({
    authService: service,
    signupCallback: { isCallback: false },
    handleSignupConfirmation() { throw new Error("unexpected confirmation"); },
    handleRecoveryAuthState(state) { recoveryStates.push(state); },
    dispatchOwnershipState(state) { ownershipStates.push(state); }
  });
  service.subscribe((state) => void coordinator.handleAuthState(state));

  await coordinator.initialize();
  assert.equal(coordinator.isOwnershipGated(), false);
  assert.equal(recoveryStates.some((state) => state.authEvent === "PASSWORD_RECOVERY"), true);
  assert.deepEqual(ownershipStates.map((state) => state.status), ["authenticated"]);
});

test("untrusted signup marker does not complete confirmation or suppress ordinary ownership startup", async () => {
  const state = authenticatedState("ordinary@example.com");
  const service = createStartupAuthService(state, []);
  const ownershipStates = [];
  let confirmationCalls = 0;
  const coordinator = createSignupConfirmationStartupCoordinator({
    authService: service,
    signupCallback: {
      isCallback: true,
      hasConfirmationEvidence: false,
      hasError: false
    },
    handleSignupConfirmation() {
      confirmationCalls += 1;
      return { handled: true, success: false };
    },
    cleanSignupCallback() {},
    dispatchOwnershipState(nextState) { ownershipStates.push(nextState); }
  });
  service.subscribe((nextState) => void coordinator.handleAuthState(nextState));

  const result = await coordinator.initialize();
  assert.equal(result.gated, false);
  assert.equal(confirmationCalls, 1);
  assert.deepEqual(ownershipStates.map((nextState) => nextState.status), ["authenticated"]);
});

function createStartupAuthService(initialState, events) {
  let state = { status: "loading", user: null };
  const listeners = new Set();
  const calls = { signOut: 0 };
  function publish(nextState) {
    state = nextState;
    for (const listener of listeners) listener(state);
    return state;
  }
  return {
    calls,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    async initialize() {
      events.push("auth:authenticated");
      return publish(initialState);
    },
    async signOut() {
      calls.signOut += 1;
      events.push("auth:sign-out");
      return { ok: true, state: publish(guestState()) };
    },
    publish
  };
}

function authenticatedState(email) {
  return { status: "authenticated", user: { id: "user-id", email } };
}

function guestState() {
  return { status: "guest", user: null };
}
