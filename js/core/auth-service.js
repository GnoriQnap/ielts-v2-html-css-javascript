import { getSupabaseClient } from "./supabase-client.js?v=10.1";

export const AUTH_STATUSES = Object.freeze({
  LOADING: "loading",
  GUEST: "guest",
  AUTHENTICATED: "authenticated",
  UNAVAILABLE: "unavailable"
});

export function validateAuthCredentials({ email, password, confirmPassword, mode }) {
  const normalizedEmail = typeof email === "string" ? email.trim() : "";
  const normalizedPassword = typeof password === "string" ? password : "";

  if (!normalizedEmail) {
    return invalidCredentials("请输入邮箱。", "email");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return invalidCredentials("请输入有效的邮箱地址。", "email");
  }
  if (!normalizedPassword) {
    return invalidCredentials("请输入密码。", "password");
  }
  if (mode === "sign-up" && normalizedPassword !== confirmPassword) {
    return invalidCredentials("两次输入的密码不一致。", "confirm-password");
  }

  return {
    valid: true,
    email: normalizedEmail,
    password: normalizedPassword,
    message: "",
    field: null
  };
}

export function createAuthService({ getClient = getSupabaseClient } = {}) {
  let client = null;
  let initializationPromise = null;
  let authSubscription = null;
  let state = createAuthState(AUTH_STATUSES.LOADING);
  const subscribers = new Set();

  function getState() {
    return { ...state, user: state.user ? { ...state.user } : null };
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Auth listener 必须是函数。");
    }
    subscribers.add(listener);
    listener(getState());
    return () => subscribers.delete(listener);
  }

  function initialize() {
    if (!initializationPromise) {
      initializationPromise = initializeOnce();
    }
    return initializationPromise;
  }

  async function initializeOnce() {
    try {
      client = await getClient();
      if (!client?.auth) {
        updateState(createAuthState(AUTH_STATUSES.UNAVAILABLE, null, "service-unavailable"));
        return getState();
      }

      const { data, error } = await client.auth.getSession();
      if (error) {
        updateState(createAuthState(AUTH_STATUSES.UNAVAILABLE, null, "service-unavailable"));
        return getState();
      }

      applySession(data?.session ?? null);
      registerAuthStateListener();
      return getState();
    } catch {
      updateState(createAuthState(AUTH_STATUSES.UNAVAILABLE, null, "service-unavailable"));
      return getState();
    }
  }

  async function signIn({ email, password }) {
    const activeClient = await ensureClient();
    if (!activeClient) return authFailure("service-unavailable");

    try {
      const { data, error } = await activeClient.auth.signInWithPassword({ email, password });
      if (error) return authFailure("invalid-credentials");
      applySession(data?.session ?? null);
      return { ok: true, state: getState() };
    } catch {
      return authFailure("service-unavailable");
    }
  }

  async function signUp({ email, password, emailRedirectTo }) {
    const activeClient = await ensureClient();
    if (!activeClient) return authFailure("service-unavailable");

    try {
      const { data, error } = await activeClient.auth.signUp({
        email,
        password,
        options: { emailRedirectTo }
      });
      if (error) return authFailure("sign-up-failed");
      applySession(data?.session ?? null);
      if (data?.user && !data?.session) {
        return {
          ok: true,
          status: "confirmation-required",
          email: typeof data.user.email === "string" ? data.user.email : email,
          state: getState()
        };
      }
      return { ok: true, status: "authenticated", state: getState() };
    } catch {
      return authFailure("service-unavailable");
    }
  }

  async function signOut() {
    const activeClient = await ensureClient();
    if (!activeClient) return authFailure("service-unavailable");

    try {
      const { error } = await activeClient.auth.signOut();
      if (error) return authFailure("sign-out-failed");
      applySession(null);
      return { ok: true, state: getState() };
    } catch {
      return authFailure("service-unavailable");
    }
  }

  function destroy() {
    authSubscription?.unsubscribe?.();
    authSubscription = null;
    subscribers.clear();
  }

  async function ensureClient() {
    await initialize();
    return client?.auth ? client : null;
  }

  function registerAuthStateListener() {
    if (authSubscription || typeof client.auth.onAuthStateChange !== "function") return;
    const listenerResult = client.auth.onAuthStateChange((event, session) => {
      if (["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED"].includes(event)) {
        applySession(session ?? null);
      }
    });
    authSubscription = listenerResult?.data?.subscription ?? null;
  }

  function applySession(session) {
    const user = normalizeAuthUser(session?.user);
    updateState(user
      ? createAuthState(AUTH_STATUSES.AUTHENTICATED, user)
      : createAuthState(AUTH_STATUSES.GUEST));
  }

  function updateState(nextState) {
    state = nextState;
    for (const listener of subscribers) listener(getState());
  }

  return Object.freeze({
    destroy,
    getState,
    initialize,
    signIn,
    signOut,
    signUp,
    subscribe
  });
}

function normalizeAuthUser(user) {
  if (!user || typeof user !== "object") return null;
  return {
    id: typeof user.id === "string" ? user.id : "",
    email: typeof user.email === "string" ? user.email : ""
  };
}

function createAuthState(status, user = null, reason = null) {
  return { status, user, reason };
}

function invalidCredentials(message, field) {
  return { valid: false, email: "", password: "", message, field };
}

function authFailure(code) {
  return { ok: false, code };
}
