import { getSupabaseClient } from "./supabase-client.js?v=10.9e2";

export const AUTH_STATUSES = Object.freeze({
  LOADING: "loading",
  GUEST: "guest",
  AUTHENTICATED: "authenticated",
  UNAVAILABLE: "unavailable"
});

export const AUTH_SESSION_KINDS = Object.freeze({
  ORDINARY: "ordinary",
  PASSWORD_RECOVERY: "password-recovery"
});

const ENUMERATION_SAFE_AUTH_ERROR_CODES = new Set([
  "email_exists",
  "user_already_exists",
  "user_not_found"
]);

const AUTH_RATE_LIMIT_ERROR_CODES = new Set([
  "over_email_send_rate_limit",
  "over_request_rate_limit"
]);

export function validateAuthCredentials({ email, password, confirmPassword, mode }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = typeof password === "string" ? password : "";

  if (!normalizedEmail) {
    return invalidCredentials("请输入邮箱。", "email");
  }
  if (!isValidEmail(normalizedEmail)) {
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

      // Register first: Supabase may emit PASSWORD_RECOVERY while getSession()
      // is still resolving the callback-created session.
      registerAuthStateListener();
      const { data, error } = await client.auth.getSession();
      if (error) {
        if (state.sessionKind === AUTH_SESSION_KINDS.PASSWORD_RECOVERY) return getState();
        updateState(createAuthState(AUTH_STATUSES.UNAVAILABLE, null, "service-unavailable"));
        return getState();
      }

      const session = data?.session ?? null;
      const preserveRecoveryKind = state.status === AUTH_STATUSES.AUTHENTICATED &&
        state.sessionKind === AUTH_SESSION_KINDS.PASSWORD_RECOVERY &&
        state.user?.id === session?.user?.id;
      applySession(session, {
        authEvent: "INITIAL_SESSION",
        sessionKind: preserveRecoveryKind
          ? AUTH_SESSION_KINDS.PASSWORD_RECOVERY
          : AUTH_SESSION_KINDS.ORDINARY
      });
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
      applySession(data?.session ?? null, { authEvent: "SIGNED_IN" });
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
      applySession(data?.session ?? null, { authEvent: "SIGNED_IN" });
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

  async function requestPasswordRecovery(email, redirectTo) {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) return authFailure("invalid-email");
    const normalizedRedirectTo = normalizeRedirectTo(redirectTo);
    if (!normalizedRedirectTo) return authFailure("invalid-redirect");

    const activeClient = await ensureClient();
    if (!activeClient) return authFailure("service-unavailable");

    try {
      const { error } = await activeClient.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: normalizedRedirectTo
      });
      return enumerationSafeRequestResult(error, "recovery-requested", "recovery-request-failed");
    } catch {
      return authFailure("service-unavailable");
    }
  }

  async function updateRecoveryPassword(newPassword) {
    const normalizedPassword = typeof newPassword === "string" ? newPassword : "";
    if (!normalizedPassword) return authFailure("invalid-password");

    // Supabase authorizes updateUser with the active session. D-3 orchestration
    // must expose this wrapper only after recovery callback classification.
    const activeClient = await ensureClient();
    if (!activeClient) return authFailure("service-unavailable");

    try {
      const { error } = await activeClient.auth.updateUser({ password: normalizedPassword });
      if (error) return authFailure("password-update-failed");
      return { ok: true, status: "password-updated" };
    } catch {
      return authFailure("service-unavailable");
    }
  }

  async function resendSignupConfirmation(email, redirectTo) {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) return authFailure("invalid-email");
    const normalizedRedirectTo = normalizeRedirectTo(redirectTo);
    if (!normalizedRedirectTo) return authFailure("invalid-redirect");

    const activeClient = await ensureClient();
    if (!activeClient) return authFailure("service-unavailable");

    try {
      const { error } = await activeClient.auth.resend({
        type: "signup",
        email: normalizedEmail,
        options: { emailRedirectTo: normalizedRedirectTo }
      });
      return enumerationSafeRequestResult(
        error,
        "confirmation-resent",
        "confirmation-resend-failed"
      );
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
      applySession(null, { authEvent: "SIGNED_OUT" });
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
      if (event === "PASSWORD_RECOVERY") {
        applySession(session ?? null, {
          authEvent: event,
          sessionKind: AUTH_SESSION_KINDS.PASSWORD_RECOVERY
        });
        return;
      }
      if (["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED"].includes(event)) {
        const preserveRecoveryKind = ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"].includes(event) &&
          state.status === AUTH_STATUSES.AUTHENTICATED &&
          state.sessionKind === AUTH_SESSION_KINDS.PASSWORD_RECOVERY &&
          state.user?.id === session?.user?.id;
        applySession(session ?? null, {
          authEvent: event,
          sessionKind: preserveRecoveryKind
            ? AUTH_SESSION_KINDS.PASSWORD_RECOVERY
            : AUTH_SESSION_KINDS.ORDINARY
        });
      }
    });
    authSubscription = listenerResult?.data?.subscription ?? null;
  }

  function applySession(session, {
    authEvent = null,
    sessionKind = AUTH_SESSION_KINDS.ORDINARY
  } = {}) {
    const user = normalizeAuthUser(session?.user);
    updateState(user
      ? createAuthState(AUTH_STATUSES.AUTHENTICATED, user, null, { authEvent, sessionKind })
      : createAuthState(AUTH_STATUSES.GUEST, null, null, { authEvent }));
  }

  function updateState(nextState) {
    state = nextState;
    for (const listener of subscribers) listener(getState());
  }

  return Object.freeze({
    destroy,
    getState,
    initialize,
    requestPasswordRecovery,
    resendSignupConfirmation,
    signIn,
    signOut,
    signUp,
    subscribe,
    updateRecoveryPassword
  });
}

function normalizeAuthUser(user) {
  if (!user || typeof user !== "object") return null;
  return {
    id: typeof user.id === "string" ? user.id : "",
    email: typeof user.email === "string" ? user.email : ""
  };
}

function createAuthState(status, user = null, reason = null, {
  authEvent = null,
  sessionKind = null
} = {}) {
  return { status, user, reason, authEvent, sessionKind };
}

function invalidCredentials(message, field) {
  return { valid: false, email: "", password: "", message, field };
}

function authFailure(code) {
  return { ok: false, code };
}

function enumerationSafeRequestResult(error, successStatus, operationalFailureCode) {
  if (!error) return { ok: true, status: successStatus };
  const code = typeof error.code === "string" ? error.code : "";
  const status = Number(error.status);
  if (status === 429 || AUTH_RATE_LIMIT_ERROR_CODES.has(code)) {
    return authFailure("rate-limited");
  }
  if (ENUMERATION_SAFE_AUTH_ERROR_CODES.has(code)) {
    return { ok: true, status: successStatus };
  }
  return authFailure(operationalFailureCode);
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim() : "";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeRedirectTo(redirectTo) {
  if (typeof redirectTo !== "string") return "";
  try {
    const url = new URL(redirectTo);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
