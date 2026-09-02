import assert from "node:assert/strict";
import test from "node:test";

import {
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
  signInSession = session
}) {
  let authListener = null;
  const calls = {
    signUp: [],
    signIn: [],
    signOut: 0,
    listenerRegistrations: 0
  };
  return {
    calls,
    emit(event, nextSession) { authListener?.(event, nextSession); },
    auth: {
      async getSession() { return { data: { session }, error: null }; },
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
      }
    }
  };
}
