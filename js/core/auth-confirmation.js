export const PENDING_SIGNUP_EMAIL_KEY = "ielts_pending_signup_email";

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
  const origin = typeof locationRef?.origin === "string" ? locationRef.origin : "";
  if (!/^https?:\/\//i.test(origin)) {
    throw new TypeError("无法生成邮箱确认回跳地址。");
  }
  const pathname = typeof locationRef?.pathname === "string" && locationRef.pathname
    ? locationRef.pathname
    : "/";
  const url = new URL(pathname, origin);
  url.searchParams.set("auth", "confirmed");
  return url.href;
}

export function inspectEmailConfirmationCallback(urlValue) {
  let url;
  try {
    url = new URL(String(urlValue));
  } catch {
    return createEmptyCallback();
  }

  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const read = (key) => url.searchParams.get(key) ?? hashParams.get(key);
  const hasMarker = url.searchParams.get("auth") === "confirmed";
  const type = read("type") ?? "";
  const errorCode = read("error_code") ?? read("error") ?? "";
  const errorDescription = read("error_description") ?? "";
  const hasConfirmationEvidence = hasMarker && (
    (type === "signup" && Boolean(hashParams.get("access_token"))) ||
    Boolean(url.searchParams.get("code")) ||
    (type === "signup" && Boolean(url.searchParams.get("token_hash")))
  );
  const isCallback = hasMarker || (type === "signup" && Boolean(errorCode));

  return Object.freeze({
    isCallback,
    hasConfirmationEvidence,
    hasError: Boolean(errorCode),
    errorCode,
    errorDescription
  });
}

export function cleanEmailConfirmationCallbackUrl({
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

function createEmptyCallback() {
  return Object.freeze({
    isCallback: false,
    hasConfirmationEvidence: false,
    hasError: false,
    errorCode: "",
    errorDescription: ""
  });
}
