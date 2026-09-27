export const PENDING_SIGNUP_EMAIL_KEY = "ielts_pending_signup_email";

export const AUTH_CALLBACK_CLASSIFICATIONS = Object.freeze({
  NONE: "none",
  SIGNUP_CONFIRMATION: "signup-confirmation",
  PASSWORD_RECOVERY: "password-recovery",
  INVALID_SIGNUP_CONFIRMATION: "invalid-signup-confirmation",
  INVALID_PASSWORD_RECOVERY: "invalid-password-recovery"
});

const AUTH_QUERY_KEYS = [
  "auth",
  "code",
  "error",
  "error_code",
  "error_description",
  "token_hash",
  "type"
];

export function createEmailConfirmationRedirectUrl(locationRef = globalThis.location) {
  return createAuthRedirectUrl("confirmed", locationRef);
}

export function createPasswordRecoveryRedirectUrl(locationRef = globalThis.location) {
  return createAuthRedirectUrl("recovery", locationRef);
}

function createAuthRedirectUrl(marker, locationRef) {
  const origin = typeof locationRef?.origin === "string" ? locationRef.origin : "";
  if (!/^https?:\/\//i.test(origin)) {
    throw new TypeError("无法生成邮箱确认回跳地址。");
  }
  const pathname = typeof locationRef?.pathname === "string" && locationRef.pathname
    ? locationRef.pathname
    : "/";
  const url = new URL(pathname, origin);
  url.searchParams.set("auth", marker);
  return url.href;
}

export function inspectAuthCallback(urlValue, {
  authEvent = "",
  sessionKind = ""
} = {}) {
  let url;
  try {
    url = new URL(String(urlValue));
  } catch {
    return createAuthCallbackResult(AUTH_CALLBACK_CLASSIFICATIONS.NONE);
  }

  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const read = (key) => url.searchParams.get(key) ?? hashParams.get(key);
  const marker = url.searchParams.get("auth") ?? "";
  const type = read("type") ?? "";
  const errorCode = read("error_code") ?? read("error") ?? "";
  const errorDescription = read("error_description") ?? "";
  const hasCode = Boolean(url.searchParams.get("code"));
  const hasAccessToken = Boolean(hashParams.get("access_token"));
  const hasTokenHash = Boolean(read("token_hash"));
  const hasSignupEvidence = type === "signup" && (hasAccessToken || hasTokenHash);
  const hasRecoveryEvent = authEvent === "PASSWORD_RECOVERY" ||
    sessionKind === "password-recovery";

  if (marker === "confirmed" || (!marker && type === "signup" && Boolean(errorCode))) {
    const validSignupEvidence = marker === "confirmed" && !errorCode && !hasRecoveryEvent &&
      (hasSignupEvidence || (hasCode && type !== "recovery"));
    return createAuthCallbackResult(
      validSignupEvidence
        ? AUTH_CALLBACK_CLASSIFICATIONS.SIGNUP_CONFIRMATION
        : AUTH_CALLBACK_CLASSIFICATIONS.INVALID_SIGNUP_CONFIRMATION,
      { errorCode, errorDescription }
    );
  }

  if (marker === "recovery" || (!marker && type === "recovery" && Boolean(errorCode))) {
    const validRecoveryEvidence = marker === "recovery" && !errorCode &&
      type !== "signup" && hasRecoveryEvent;
    return createAuthCallbackResult(
      validRecoveryEvidence
        ? AUTH_CALLBACK_CLASSIFICATIONS.PASSWORD_RECOVERY
        : AUTH_CALLBACK_CLASSIFICATIONS.INVALID_PASSWORD_RECOVERY,
      { errorCode, errorDescription }
    );
  }

  return createAuthCallbackResult(AUTH_CALLBACK_CLASSIFICATIONS.NONE);
}

export function inspectEmailConfirmationCallback(urlValue) {
  const callback = inspectAuthCallback(urlValue);
  const isSignupCallback = [
    AUTH_CALLBACK_CLASSIFICATIONS.SIGNUP_CONFIRMATION,
    AUTH_CALLBACK_CLASSIFICATIONS.INVALID_SIGNUP_CONFIRMATION
  ].includes(callback.classification);

  return Object.freeze({
    isCallback: isSignupCallback,
    hasConfirmationEvidence:
      callback.classification === AUTH_CALLBACK_CLASSIFICATIONS.SIGNUP_CONFIRMATION,
    hasError: callback.hasError,
    errorCode: callback.errorCode,
    errorDescription: callback.errorDescription
  });
}

export function cleanEmailConfirmationCallbackUrl({
  locationRef = globalThis.location,
  historyRef = globalThis.history
} = {}) {
  return cleanAuthCallbackUrl({ locationRef, historyRef });
}

export function cleanAuthCallbackUrl({
  locationRef = globalThis.location,
  historyRef = globalThis.history
} = {}) {
  if (!locationRef?.href || typeof historyRef?.replaceState !== "function") return false;
  const url = new URL(locationRef.href);
  for (const key of AUTH_QUERY_KEYS) url.searchParams.delete(key);
  url.hash = "";
  const cleanPath = `${url.pathname}${url.search}` || "/";
  historyRef.replaceState(historyRef.state ?? null, "", cleanPath);
  return true;
}

export function createPendingSignupEmailStore({ storage = globalThis.localStorage } = {}) {
  return Object.freeze({
    load() {
      try {
        const value = storage?.getItem?.(PENDING_SIGNUP_EMAIL_KEY);
        return typeof value === "string" ? value.trim() : "";
      } catch {
        return "";
      }
    },
    save(email) {
      const normalizedEmail = typeof email === "string" ? email.trim() : "";
      if (!normalizedEmail) return false;
      try {
        storage?.setItem?.(PENDING_SIGNUP_EMAIL_KEY, normalizedEmail);
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storage?.removeItem?.(PENDING_SIGNUP_EMAIL_KEY);
        return true;
      } catch {
        return false;
      }
    }
  });
}

function createAuthCallbackResult(classification, {
  errorCode = "",
  errorDescription = ""
} = {}) {
  return Object.freeze({
    classification,
    isCallback: classification !== AUTH_CALLBACK_CLASSIFICATIONS.NONE,
    hasError: Boolean(errorCode),
    errorCode,
    errorDescription
  });
}
