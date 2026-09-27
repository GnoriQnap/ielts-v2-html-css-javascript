import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_SESSION_KINDS,
  AUTH_STATUSES,
  createAuthService,
  validateAuthCredentials
} from "../js/core/auth-service.js";

test("a missing session initializes as a guest without blocking learning state", async () => {
  const learningState = Object.freeze({ learning: { byWordKey: { idea: { status: "review" } } } });
  const client = createMockClient({ session: null });
  const service = createAuthService({ getClient: async () => client });

  assert.equal((await service.initialize()).status, AUTH_STATUSES.GUEST);
  assert.equal(service.getState().user, null);
  assert.equal(learningState.learning.byWordKey.idea.status, "review");
});

test("an existing session restores the authenticated user", async () => {
  const client = createMockClient({ session: createSession("user@example.com") });
  const service = createAuthService({ getClient: async () => client });

  const state = await service.initialize();
  assert.equal(state.status, AUTH_STATUSES.AUTHENTICATED);
  assert.equal(state.user.email, "user@example.com");
});

test("signUp forwards the confirmation redirect and applies an immediate session", async () => {
  const session = createSession("new@example.com");
  const client = createMockClient({ session: null, signUpSession: session });
  const service = createAuthService({ getClient: async () => client });

  const result = await service.signUp({
    email: "new@example.com",
    password: "private-value",
    emailRedirectTo: "http://localhost:8000/?auth=confirmed"
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "authenticated");
  assert.equal(service.getState().status, AUTH_STATUSES.AUTHENTICATED);
  assert.deepEqual(client.calls.signUp, [{
    email: "new@example.com",
    password: "private-value",
    options: { emailRedirectTo: "http://localhost:8000/?auth=confirmed" }
  }]);
});

test("confirmed-email signup returns a confirmation-required outcome for user plus null session", async () => {
  const client = createMockClient({
    session: null,
    signUpSession: null,
    signUpUser: { id: "pending-id", email: "pending@example.com" }
  });
  const service = createAuthService({ getClient: async () => client });

  const result = await service.signUp({
    email: "pending@example.com",
    password: "private-value",
    emailRedirectTo: "http://localhost:8000/?auth=confirmed"
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "confirmation-required");
  assert.equal(result.email, "pending@example.com");
  assert.equal(service.getState().status, AUTH_STATUSES.GUEST);
});

test("signInWithPassword updates authenticated UI state without a reload", async () => {
  const session = createSession("member@example.com");
  const client = createMockClient({ session: null, signInSession: session });
  const service = createAuthService({ getClient: async () => client });

  const result = await service.signIn({ email: "member@example.com", password: "private-value" });
  assert.equal(result.ok, true);
  assert.equal(service.getState().user.email, "member@example.com");
  assert.equal(client.calls.signIn.length, 1);
});

test("signOut returns to guest without clearing unrelated local learning data", async () => {
  const localLearning = {
    learning: { byWordKey: { idea: { status: "remembered" } } },
    reviewQueue: [{ wordKey: "view" }],
    rounds: { lastCompletedSummary: { roundId: "round-1" } }
  };
  const before = structuredClone(localLearning);
  const client = createMockClient({ session: createSession("member@example.com") });
  const service = createAuthService({ getClient: async () => client });
  await service.initialize();

  assert.equal((await service.signOut()).ok, true);
  assert.equal(service.getState().status, AUTH_STATUSES.GUEST);
  assert.deepEqual(localLearning, before);
  assert.equal(client.calls.signOut, 1);
});

test("auth state listener handles session events and is registered only once", async () => {
  const client = createMockClient({ session: null });
  const service = createAuthService({ getClient: async () => client });

  await Promise.all([service.initialize(), service.initialize(), service.initialize()]);
  assert.equal(client.calls.listenerRegistrations, 1);

  client.emit("SIGNED_IN", createSession("restored@example.com"));
  assert.equal(service.getState().status, AUTH_STATUSES.AUTHENTICATED);
  client.emit("TOKEN_REFRESHED", createSession("restored@example.com"));
  assert.equal(service.getState().user.email, "restored@example.com");
  client.emit("SIGNED_OUT", null);
  assert.equal(service.getState().status, AUTH_STATUSES.GUEST);
});

test("PASSWORD_RECOVERY remains a distinct authenticated session event", async () => {
  const client = createMockClient({ session: null });
  const service = createAuthService({ getClient: async () => client });
  const observed = [];
  service.subscribe((state) => observed.push(state));
  await service.initialize();

  client.emit("PASSWORD_RECOVERY", createSession("recover@example.com"));
  assert.equal(service.getState().status, AUTH_STATUSES.AUTHENTICATED);
  assert.equal(service.getState().authEvent, "PASSWORD_RECOVERY");
  assert.equal(service.getState().sessionKind, AUTH_SESSION_KINDS.PASSWORD_RECOVERY);
  assert.equal(observed.at(-1).sessionKind, AUTH_SESSION_KINDS.PASSWORD_RECOVERY);

  client.emit("INITIAL_SESSION", createSession("recover@example.com"));
  assert.equal(service.getState().sessionKind, AUTH_SESSION_KINDS.PASSWORD_RECOVERY);
  client.emit("SIGNED_IN", createSession("recover@example.com"));
  assert.equal(service.getState().sessionKind, AUTH_SESSION_KINDS.PASSWORD_RECOVERY);
  client.emit("TOKEN_REFRESHED", createSession("recover@example.com"));
  assert.equal(service.getState().authEvent, "TOKEN_REFRESHED");
  assert.equal(service.getState().sessionKind, AUTH_SESSION_KINDS.PASSWORD_RECOVERY);

  client.emit("SIGNED_OUT", null);
  assert.equal(service.getState().status, AUTH_STATUSES.GUEST);
  assert.equal(service.getState().sessionKind, null);
});

test("PASSWORD_RECOVERY emitted while getSession resolves survives INITIAL_SESSION", async () => {
  const session = createSession("recover@example.com");
  const client = createMockClient({ session, eventDuringGetSession: "PASSWORD_RECOVERY" });
  const service = createAuthService({ getClient: async () => client });

  const state = await service.initialize();
  assert.equal(state.status, AUTH_STATUSES.AUTHENTICATED);
  assert.equal(state.user.email, "recover@example.com");
  assert.equal(state.sessionKind, AUTH_SESSION_KINDS.PASSWORD_RECOVERY);
  assert.equal(state.authEvent, "INITIAL_SESSION");
});

test("recovery session kind never transfers to another user or a fresh service", async () => {
  const client = createMockClient({ session: null });
  const service = createAuthService({ getClient: async () => client });
  await service.initialize();

  client.emit("PASSWORD_RECOVERY", createSession("recover@example.com"));
  client.emit("SIGNED_IN", createSession("other@example.com"));
  assert.equal(service.getState().user.email, "other@example.com");
  assert.equal(service.getState().sessionKind, AUTH_SESSION_KINDS.ORDINARY);

  const freshClient = createMockClient({ session: createSession("recover@example.com") });
  const freshService = createAuthService({ getClient: async () => freshClient });
  await freshService.initialize();
  assert.equal(freshService.getState().sessionKind, AUTH_SESSION_KINDS.ORDINARY);
});

test("password recovery request is normalized, enumeration-safe, and stores no secrets", async () => {
  const client = createMockClient({ session: null });
  const service = createAuthService({ getClient: async () => client });

  const result = await service.requestPasswordRecovery(
    " recover@example.com ",
    "https://example.test/trainer/?auth=recovery"
  );

  assert.deepEqual(result, { ok: true, status: "recovery-requested" });
  assert.deepEqual(client.calls.resetPasswordForEmail, [{
    email: "recover@example.com",
    options: { redirectTo: "https://example.test/trainer/?auth=recovery" }
  }]);
  assert.equal(JSON.stringify(result).includes("recover@example.com"), false);
  assert.equal(JSON.stringify(service.getState()).includes("password"), false);
  assert.equal(JSON.stringify(service.getState()).includes("token"), false);
});

test("recovery password update calls updateUser and leaves signout explicit", async () => {
  const client = createMockClient({ session: createSession("recover@example.com") });
  const service = createAuthService({ getClient: async () => client });

  const result = await service.updateRecoveryPassword("new-private-value");

  assert.deepEqual(result, { ok: true, status: "password-updated" });
  assert.deepEqual(client.calls.updateUser, [{ password: "new-private-value" }]);
  assert.equal(client.calls.signOut, 0);
  assert.equal(JSON.stringify(result).includes("new-private-value"), false);
  assert.equal(JSON.stringify(service.getState()).includes("new-private-value"), false);
});

test("recovery password update failures remain observable without changing ownership", async () => {
  const client = createMockClient({
    session: createSession("recover@example.com"),
    updateUserError: { message: "rejected" }
  });
  const service = createAuthService({ getClient: async () => client });

  assert.deepEqual(
    await service.updateRecoveryPassword("new-private-value"),
    { ok: false, code: "password-update-failed" }
  );
  assert.equal(service.getState().status, AUTH_STATUSES.AUTHENTICATED);
});

test("signup confirmation resend uses email only and returns a stable result", async () => {
  const client = createMockClient({ session: null });
  const service = createAuthService({ getClient: async () => client });

  const result = await service.resendSignupConfirmation(
    " pending@example.com ",
    "https://example.test/?auth=confirmed"
  );

  assert.deepEqual(result, { ok: true, status: "confirmation-resent" });
  assert.deepEqual(client.calls.resend, [{
    type: "signup",
    email: "pending@example.com",
    options: { emailRedirectTo: "https://example.test/?auth=confirmed" }
  }]);
  assert.equal(JSON.stringify(client.calls.resend).includes("password"), false);
  assert.equal(JSON.stringify(client.calls.resend).includes("token"), false);
});

test("recovery and resend allowlist enumeration outcomes and retain generic rate limits", async () => {
  const domainClient = createMockClient({
    session: null,
    resetPasswordError: { status: 404, code: "user_not_found", message: "account-specific" },
    resendError: { status: 400, code: "user_already_exists", message: "account-specific" }
  });
  const domainService = createAuthService({ getClient: async () => domainClient });
  assert.deepEqual(
    await domainService.requestPasswordRecovery("unknown@example.com", "https://example.test/?auth=recovery"),
    { ok: true, status: "recovery-requested" }
  );
  assert.deepEqual(
    await domainService.resendSignupConfirmation("confirmed@example.com", "https://example.test/?auth=confirmed"),
    { ok: true, status: "confirmation-resent" }
  );

  const limitedClient = createMockClient({
    session: null,
    resetPasswordError: { status: 429 },
    resendError: { status: 429 }
  });
  const limitedService = createAuthService({ getClient: async () => limitedClient });
  assert.equal(
    (await limitedService.requestPasswordRecovery("a@b.com", "https://example.test/?auth=recovery")).code,
    "rate-limited"
  );
  assert.equal(
    (await limitedService.resendSignupConfirmation("a@b.com", "https://example.test/?auth=confirmed")).code,
    "rate-limited"
  );
});

test("unexpected 4xx and 5xx Auth errors remain operational failures", async () => {
  const client = createMockClient({
    session: null,
    resetPasswordError: { status: 400, code: "validation_failed", message: "details hidden" },
    resendError: { status: 503, code: "unexpected_failure", message: "details hidden" }
  });
  const service = createAuthService({ getClient: async () => client });

  assert.deepEqual(
    await service.requestPasswordRecovery("a@b.com", "https://example.test/?auth=recovery"),
    { ok: false, code: "recovery-request-failed" }
  );
  assert.deepEqual(
    await service.resendSignupConfirmation("a@b.com", "https://example.test/?auth=confirmed"),
    { ok: false, code: "confirmation-resend-failed" }
  );
});

test("thrown recovery and resend transport failures remain service-unavailable", async () => {
  const client = createMockClient({
    session: null,
    resetPasswordThrows: true,
    resendThrows: true
  });
  const service = createAuthService({ getClient: async () => client });

  assert.equal(
    (await service.requestPasswordRecovery("a@b.com", "https://example.test/?auth=recovery")).code,
    "service-unavailable"
  );
  assert.equal(
    (await service.resendSignupConfirmation("a@b.com", "https://example.test/?auth=confirmed")).code,
    "service-unavailable"
  );
});

test("recovery and resend reject invalid arguments before Supabase access", async () => {
  const client = createMockClient({ session: null });
  const service = createAuthService({ getClient: async () => client });

  assert.equal((await service.requestPasswordRecovery("bad", "https://example.test/")).code, "invalid-email");
  assert.equal((await service.requestPasswordRecovery("a@b.com", "javascript:bad")).code, "invalid-redirect");
  assert.equal((await service.resendSignupConfirmation("", "https://example.test/")).code, "invalid-email");
  assert.equal((await service.updateRecoveryPassword("")).code, "invalid-password");
  assert.deepEqual(client.calls.resetPasswordForEmail, []);
  assert.deepEqual(client.calls.resend, []);
  assert.deepEqual(client.calls.updateUser, []);
});

test("network failures become an unavailable state without throwing", async () => {
  const service = createAuthService({
    getClient: async () => { throw new Error("offline"); }
  });

  await assert.doesNotReject(() => service.initialize());
  assert.equal(service.getState().status, AUTH_STATUSES.UNAVAILABLE);
  assert.equal((await service.signIn({ email: "a@b.com", password: "x" })).code, "service-unavailable");
});

test("registration confirmation mismatch is rejected before Supabase", () => {
  assert.deepEqual(
    validateAuthCredentials({
      email: "user@example.com",
      password: "first-value",
      confirmPassword: "second-value",
      mode: "sign-up"
    }),
    {
      valid: false,
      email: "",
      password: "",
      message: "两次输入的密码不一致。",
      field: "confirm-password"
    }
  );
});

function createSession(email) {
  return { user: { id: `id-${email}`, email } };
}

function createMockClient({
  session,
  signUpSession = session,
  signUpUser = signUpSession?.user ?? null,
  signInSession = session,
  updateUserError = null,
  resetPasswordError = null,
  resendError = null,
  resetPasswordThrows = false,
  resendThrows = false,
  eventDuringGetSession = null
}) {
  let authListener = null;
  const calls = {
    signUp: [],
    signIn: [],
    signOut: 0,
    resetPasswordForEmail: [],
    resend: [],
    updateUser: [],
    listenerRegistrations: 0
  };
  return {
    calls,
    emit(event, nextSession) { authListener?.(event, nextSession); },
    auth: {
      async getSession() {
        if (eventDuringGetSession) authListener?.(eventDuringGetSession, session);
        return { data: { session }, error: null };
      },
      onAuthStateChange(listener) {
        calls.listenerRegistrations += 1;
        authListener = listener;
        return { data: { subscription: { unsubscribe() { authListener = null; } } } };
      },
      async signUp(credentials) {
        calls.signUp.push(credentials);
        return { data: { user: signUpUser, session: signUpSession }, error: null };
      },
      async signInWithPassword(credentials) {
        calls.signIn.push(credentials);
        return { data: { session: signInSession }, error: null };
      },
      async signOut() {
        calls.signOut += 1;
        return { error: null };
      },
      async resetPasswordForEmail(email, options) {
        if (resetPasswordThrows) throw new Error("offline");
        calls.resetPasswordForEmail.push({ email, options });
        return { data: {}, error: resetPasswordError };
      },
      async updateUser(attributes) {
        calls.updateUser.push(attributes);
        return { data: {}, error: updateUserError };
      },
      async resend(input) {
        if (resendThrows) throw new Error("offline");
        calls.resend.push(input);
        return { data: {}, error: resendError };
      }
    }
  };
}
